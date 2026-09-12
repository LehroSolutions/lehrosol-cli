// Factory for an OpenAI-compatible HTTP agent adapter with real tool calling.
// -----------------------------------------------------------------------------
// Works against ANY OpenAI-compatible /chat/completions endpoint:
//   • Ollama            (http://localhost:11434/v1, no key)
//   • NVIDIA NIM        (https://integrate.api.nvidia.com/v1, NVIDIA_API_KEY)
//   • vLLM / LM Studio / llama.cpp server (local, no key)
//   • Groq / Together / Mistral / Fireworks / OpenRouter (bring your key)
//
// The adapter runs a bounded function-calling loop: it advertises the LehroSol
// tool registry to the model, executes any tool calls (cwd-sandboxed), feeds the
// results back, and repeats until the model returns a final answer or the step
// budget is exhausted. It then derives a policyInput from the git diff for the
// Score Agent — exactly like the CLI adapters do.
import {
  isGitRepo, changedFilesSince, diffText, scanForSecrets, hasTestChanges,
} from './shared.js';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { toolSchemas, executeTool } from '../tools/registry.js';
import { getAdapterConfig } from '../../core/config.js';

// POST JSON, return { status, text }. node:http instead of fetch: undici's
// default 300 s headersTimeout aborts long local-model requests (≈5-minute
// prompt evals are normal on CPU-only boxes) with an opaque "fetch failed",
// and its dispatcher cannot be reconfigured without an npm dependency. A raw
// request has no headers deadline, honors the explicit timeoutMs, and uses a
// fresh socket per request (some engines drop reused keep-alive sockets
// mid-generation).
function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { reject(new Error(`invalid endpoint URL: ${url}`)); return; }
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        headers,
      ),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s (set LEHRO_HTTP_TIMEOUT_MS or --timeoutMs to raise it)`)));
    req.on('error', reject);
    req.end(body);
  });
}

function basePolicyInput(ctx) {
  return {
    hasTests: false, secretScanPassed: true,
    reviewCount: ctx.reviewCount != null ? ctx.reviewCount : 0,
    branch: ctx.branch || 'unknown', owaspScope: ctx.owaspScope || [],
  };
}

function buildSystemPrompt(ctx) {
  const parts = [
    'You are a coding agent operating inside the LehroSol agentic-engineering harness.',
    'Use the provided tools to inspect and edit files strictly within the project root.',
    'Prefer minimal, correct, well-tested changes. Never print secrets.',
    'COMPLETION CONTRACT: do not declare the task done until the work actually exists in the workspace. A valid final answer must (1) be preceded by real tool activity (read/edit/write) and (2) list the exact files you changed and how you verified the result. Never claim edits you did not make with tools.',
    'TASK FOCUS: the user message defines the ONLY task. Do not look for a file called fix_plan.md, AGENT.md, or a task list — any such files are optional backlog context, may not exist, and are never the task. If a tool reports a file missing, pick the file the task actually names instead of stopping.',
    'Do not return a final answer merely because a tool-step budget is approaching; keep using tools until the task is complete or a concrete blocker is identified. If you genuinely cannot act, reply with exactly "BLOCKED: <reason>" rather than a pretend completion.',
  ];
  if (ctx.agentMd) parts.push('\n# Project AGENTS.md (project conventions — context only, NOT the task)\n' + String(ctx.agentMd).slice(0, 4000));
  if (ctx.fixPlan) parts.push('\n# fix_plan.md (known-issues backlog — context only, NOT the task; the user message is the task)\n' + String(ctx.fixPlan).slice(0, 2000));
  return parts.join('\n');
}

// Models — especially small local ones — love to announce "Done!" without doing
// anything. Prompts that look like they ask for work get challenged when the
// model quits with zero tool activity; pure questions are answered directly.
const ACTION_HINT_RE = /\b(implement|fix|add|create|write|update|refactor|remove|delete|migrate|harden|test|build|change|modify|extend|port|optimize|document|install|configure|generate|scaffold|rename|split|extract|debug)\b/i;

export function looksLikeActionTask(prompt) {
  return ACTION_HINT_RE.test(String(prompt || ''));
}

// --- Text-form tool-call recovery -------------------------------------------
// Small local models and older llama.cpp templates frequently emit tool calls
// as *text* (fenced ```json blocks, <tool_call> XML, or bare JSON) instead of
// the parsed OpenAI `tool_calls` field — the model clearly wants to act, so
// throwing that away wastes the whole pass. Parse and execute them anyway.
export function parseTextToolCalls(text) {
  const out = [];
  const source = String(text || '');
  if (!source) return out;
  const candidates = [];
  for (const m of source.matchAll(/```(?:json|tool_code)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
  for (const m of source.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) candidates.push(m[1]);
  // Bare objects: extract brace-balanced (and quote-aware) JSON starting at
  // each {"name" — a naive regex stops at the first `}` inside a nested
  // arguments object and produces invalid JSON.
  let idx = source.indexOf('{"name"');
  while (idx >= 0) {
    const balanced = extractBalancedJson(source, idx);
    if (balanced) candidates.push(balanced);
    idx = source.indexOf('{"name"', idx + 1);
  }
  const seenCandidates = new Set();
  for (const raw of candidates) {
    const key = raw.trim();
    if (seenCandidates.has(key)) continue; // fenced + bare scans can both match
    seenCandidates.add(key);
    try {
      const obj = JSON.parse(raw.trim());
      const name = obj && (obj.name || (obj.function && obj.function.name));
      if (!name || typeof name !== 'string') continue;
      let args = obj.arguments ?? (obj.function && obj.function.arguments) ?? {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { /* keep as string */ }
      }
      if (args == null || typeof args !== 'object') args = {};
      out.push({
        id: 'text_' + out.length,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
        recoveredFromText: true,
      });
    } catch { /* not JSON — skip */ }
  }
  return out;
}

const COMPLETION_CHALLENGE =
  'You returned a final answer without performing any tool actions, but this task requires actual work in the workspace. ' +
  'Replying "BLOCKED" without having attempted any tool action is NOT a valid blocker. ' +
  'Do not describe what you would do — use the tools NOW to inspect and edit the files, then verify the result. ' +
  'If, after genuinely attempting with tools, no action is possible, reply with exactly "BLOCKED: <reason>".';

// Step budget: local engines are slow per call but the outer loop should not
// starve them; remote APIs are faster but pricier. LEHRO_TOOL_STEPS sets a
// machine-wide default when the caller doesn't pin one. Ceiling guards a
// runaway model against an unbounded bill/loop.
export function resolveToolStepBudget({ toolSteps, local } = {}) {
  const defaultToolSteps = local ? 64 : 24;
  const envOverride = Number(process.env.LEHRO_TOOL_STEPS);
  let requested = Number(toolSteps);
  if (!Number.isFinite(requested) || requested <= 0) {
    requested = Number.isFinite(envOverride) && envOverride > 0 ? envOverride : defaultToolSteps;
  }
  return Math.max(1, Math.min(requested, 200));
}

// Extract one brace-balanced JSON object starting at `start` (must point at
// '{'), respecting string literals and escapes. Returns null when unbalanced.
function extractBalancedJson(source, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const MAX_COMPLETION_CHALLENGES = 2;

export function createHttpAdapter(options) {
  const meta = {
    id: options.id,
    label: options.label,
    kind: 'http',
    bin: null,
    baseUrl: options.baseUrl,
    model: options.model,
    apiKeyEnv: options.apiKeyEnv || null,
    requiresEnv: options.apiKeyEnv || null,
    local: Boolean(options.local),
    docs: options.docs || null,
  };

  function effectiveConfig() {
    const cfg = getAdapterConfig(meta.id);
    return {
      baseUrl: cfg.baseUrl || meta.baseUrl,
      model: cfg.model || meta.model,
      apiKey: cfg.apiKey || (meta.requiresEnv ? process.env[meta.requiresEnv] : (cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : process.env.OPENAI_API_KEY || null)),
      apiKeyEnv: cfg.apiKeyEnv || meta.requiresEnv || null,
      timeoutMs: cfg.timeoutMs ? Number(cfg.timeoutMs) : null,
    };
  }

  function configured() {
    const eff = effectiveConfig();
    if (meta.requiresEnv || eff.apiKeyEnv) return Boolean(eff.apiKey || process.env[eff.apiKeyEnv]);
    return true; // local endpoints (Ollama, vLLM, LM Studio) need no key
  }

  function notConfiguredResult(ctx) {
    const eff = effectiveConfig();
    const how = (meta.requiresEnv || eff.apiKeyEnv)
      ? `run: lehrosol config set --adapter ${meta.id} --apiKey <key> --model <model>`
      : `start the local server at ${eff.baseUrl}`;
    return {
      adapter: meta.id, available: false,
      summary: `${meta.label} adapter is not configured: ${how}. Then retry, or use \`local\` for a dry run.`,
      changedFiles: [], policyInput: basePolicyInput(ctx),
    };
  }

  async function run(context) {
    const ctx = context || {};
    const cwd = ctx.cwd || process.cwd();
    if (!configured()) return notConfiguredResult(ctx);
    if (typeof fetch !== 'function') {
      return {
        adapter: meta.id, available: true, error: true,
        summary: `${meta.label} adapter requires global fetch (Node >= 18/20).`,
        changedFiles: [], policyInput: basePolicyInput(ctx),
      };
    }

    const beforeRef = isGitRepo(cwd) ? 'HEAD' : null;
    const eff = effectiveConfig();
    const model = ctx.model || eff.model || options.resolveModel?.() || meta.model;
    const apiKey = eff.apiKey || (eff.apiKeyEnv ? process.env[eff.apiKeyEnv] : null);
    const useTools = ctx.tools !== false;
    const maxSteps = resolveToolStepBudget({ toolSteps: ctx.toolSteps, local: meta.local });
    const url = `${String(eff.baseUrl || meta.baseUrl).replace(/\/$/, '')}/chat/completions`;

    // Outer-loop continuation memory: each runLoop pass starts a fresh chat,
    // so without this the model redoes recon from scratch and burns its step
    // budget repeating work the previous pass already finished.
    const userContent = String(ctx.prompt || '');
    const continuation = ctx.iteration > 1 && ctx.lastSummary
      ? `\n\n[OUTER-LOOP CONTINUATION — pass ${ctx.iteration} of this loop. Prior pass summary:\n${String(ctx.lastSummary).slice(0, 2000)}\nThe workspace may already contain partial work from that pass. Do not redo completed steps; inspect the current state first, then finish the remaining work.]`
      : '';

    const messages = [
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: userContent + continuation },
    ];
    const toolTrace = [];
    let finalText = '';
    let completed = false;
    let stepsUsed = 0;
    let toolCallCount = 0;
    let challenges = 0;
    let blocked = false;
    let stallWarnings = 0;
    let lastCallSig = '';
    let lastCallName = '';
    let stallCount = 0;
    const STALL_LIMIT = 3;

    try {
      for (let step = 0; step < maxSteps; step += 1) {
        stepsUsed = step + 1;
        const body = { model, messages, temperature: ctx.temperature != null ? ctx.temperature : 0.2 };
        // Cap generation: without it a rambling model burns the whole context
        // window per step, tripling wall-clock time on slow local hardware.
        body.max_tokens = Number(ctx.maxTokens) || 1024;
        if (useTools) { body.tools = toolSchemas(); body.tool_choice = 'auto'; }
        const timeoutMs = Number(ctx.timeoutMs) || eff.timeoutMs
          || Number(process.env.LEHRO_HTTP_TIMEOUT_MS)
          || (meta.local ? 600000 : 120000);
        const res = await postJson(
          url,
          apiKey ? { authorization: `Bearer ${apiKey}` } : {},
          JSON.stringify(body),
          timeoutMs,
        );
        if (res.status >= 400 || res.status < 200) {
          return {
            adapter: meta.id, available: true, error: true,
            summary: `${meta.label} HTTP ${res.status}: ${res.text.slice(0, 300)}`,
            changedFiles: beforeRef ? changedFilesSince(cwd, beforeRef) : [],
            policyInput: basePolicyInput(ctx),
          };
        }
        let data;
        try {
          data = JSON.parse(res.text);
        } catch {
          return {
            adapter: meta.id, available: true, error: true,
            summary: `${meta.label} returned non-JSON response: ${res.text.slice(0, 200)}`,
            changedFiles: [], policyInput: basePolicyInput(ctx),
          };
        }
        const msg = data.choices && data.choices[0] && data.choices[0].message;
        if (!msg) {
          return {
            adapter: meta.id, available: true, error: true,
            summary: `${meta.label} returned no message/choices.`,
            changedFiles: [], policyInput: basePolicyInput(ctx),
          };
        }
        messages.push(msg);
        let calls = msg.tool_calls || [];
        if (!calls.length && msg.content) {
          const textCalls = parseTextToolCalls(String(msg.content));
          if (textCalls.length) calls = textCalls;
        }
        if (!calls.length) {
          const trimmed = String(msg.content || '').trim();
          const isBlockedReply = /^BLOCKED\b/i.test(trimmed);
          // Quit rights: a model may end the pass via BLOCKED (or a plain
          // answer) only if (a) tools aren't in play, (b) the prompt isn't an
          // action task, (c) it did real tool work, or (d) it was already
          // challenged. Otherwise even "BLOCKED:" counts as a premature quit —
          // otherwise lazy models quit instantly by prefixing BLOCKED.
          const mayQuit = !useTools || !looksLikeActionTask(userContent) || toolCallCount > 0 || challenges > 0;
          if (isBlockedReply && mayQuit) {
            finalText = msg.content || '';
            completed = true;
            blocked = true;
            break;
          }
          // Evidence gate: a "final answer" with zero tool activity on an
          // action-style task is almost always a premature quit. Push back
          // (bounded) so the model does real work instead of vibing done.
          // Models that already used tools may answer freely.
          if (useTools && toolCallCount === 0 && challenges < MAX_COMPLETION_CHALLENGES && looksLikeActionTask(userContent)) {
            challenges += 1;
            messages.push({ role: 'user', content: COMPLETION_CHALLENGE });
            continue;
          }
          finalText = msg.content || '';
          completed = true;
          break;
        }
        toolCallCount += calls.length;
        for (const call of calls) {
          const fnName = call.function && call.function.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse((call.function && call.function.arguments) || '{}'); } catch { /* keep {} */ }
          const callSig = fnName + '|' + JSON.stringify(fnArgs);
          if (callSig === lastCallSig) stallCount += 1;
          else { stallCount = 1; lastCallSig = callSig; lastCallName = fnName; }
          const out = executeTool(fnName, fnArgs, { cwd });
          toolTrace.push({ tool: fnName, ok: out.ok, ...(call.recoveredFromText ? { recovered: true } : {}) });
          if (call.recoveredFromText) {
            // The model never emitted a parsed tool_call, so a `role:'tool'`
            // message may not fit its chat template. Feed the result back as
            // plain text — every model understands that.
            messages.push({
              role: 'user',
              content: `[TOOL RESULT — ${fnName}${out.ok ? '' : ' (error)'}]\n${String(out.output).slice(0, 8000)}\nContinue: use more tools to complete the task, or give the final answer.${out.ok ? '' : ' If a path was not found, call list_dir to discover the actual project layout and retry with a path that exists. Do not give up because one file was missing.'}`,
            });
          } else {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: String(out.output).slice(0, 8000),
            });
          }
        }
        // Stall guard: local models often loop the identical tool call many
        // times, burning the budget without new information. Name the stall
        // and demand a strategy change — cheap, and it visibly un-sticks them.
        if (stallCount >= STALL_LIMIT) {
          stallWarnings += 1;
          messages.push({
            role: 'user',
            content: `[HARNESS STALL WARNING] You just repeated ${lastCallName} ${stallCount} times with identical arguments. Repeating the same call produces no new information. Change strategy now: re-read the task, call list_dir to see what actually exists, open a different file, or make the real edit with edit_file/write_file.`,
          });
          stallCount = 0;
        }
      }

      const changedFiles = beforeRef ? changedFilesSince(cwd, beforeRef) : [];
      const diff = beforeRef ? diffText(cwd, beforeRef) : '';
      const secretScanPassed = scanForSecrets(diff) && scanForSecrets(finalText);
      const traceLine = toolTrace.length
        ? `\n\n[tools: ${toolTrace.map((t) => `${t.tool}${t.ok ? '' : '!'}`).join(', ')}]`
        : '';
      const challengeLine = challenges
        ? `\n\n[harness pushed back on ${challenges} premature completion(s) before work started]`
        : '';
      const blockedLine = blocked ? '\n\n[BLOCKED — model reported a concrete blocker instead of a completion]' : '';
      const completionText = completed
        ? String(finalText).trim()
        : `Tool-step checkpoint reached after ${stepsUsed}/${maxSteps} steps without a final verified answer. The outer loop should continue from the current workspace state.`;
      return {
        adapter: meta.id, available: true,
        toolCalls: toolTrace,
        toolStepsUsed: stepsUsed,
        toolStepBudget: maxSteps,
        incomplete: !completed,
        challenges,
        blocked,
        stallWarnings,
        evidence: { toolCalls: toolCallCount, changedFiles: changedFiles.length },
        summary: (`${meta.label} (${model}):\n${completionText}${traceLine}${challengeLine}${blockedLine}`).slice(0, 4000),
        changedFiles,
        policyInput: {
          hasTests: hasTestChanges(changedFiles),
          secretScanPassed,
          reviewCount: ctx.reviewCount != null ? ctx.reviewCount : 1,
          branch: ctx.branch || 'lehro/loop',
          owaspScope: ctx.owaspScope || [],
        },
      };
    } catch (err) {
      return {
        adapter: meta.id, available: true, error: true,
        summary: `${meta.label} adapter failed: ${String((err && err.message) || err)}`,
        changedFiles: beforeRef ? changedFilesSince(cwd, beforeRef) : [],
        policyInput: basePolicyInput(ctx),
      };
    }
  }

  return { meta, run, configured };
}
