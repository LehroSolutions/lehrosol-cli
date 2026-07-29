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
import { toolSchemas, executeTool } from '../tools/registry.js';
import { getAdapterConfig } from '../../core/config.js';

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
    'Prefer minimal, correct, well-tested changes. Never print secrets. When finished,',
    'reply with a concise summary of exactly what you changed and why.',
  ];
  if (ctx.agentMd) parts.push('\n# Project AGENTS.md\n' + String(ctx.agentMd).slice(0, 4000));
  if (ctx.fixPlan) parts.push('\n# fix_plan.md\n' + String(ctx.fixPlan).slice(0, 2000));
  return parts.join('\n');
}

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
    const maxSteps = Math.max(1, Math.min(Number(ctx.toolSteps || 8), 20));
    const url = `${String(eff.baseUrl || meta.baseUrl).replace(/\/$/, '')}/chat/completions`;

    const messages = [
      { role: 'system', content: buildSystemPrompt(ctx) },
      { role: 'user', content: String(ctx.prompt || '') },
    ];
    const toolTrace = [];
    let finalText = '';

    try {
      for (let step = 0; step < maxSteps; step += 1) {
        const body = { model, messages, temperature: ctx.temperature != null ? ctx.temperature : 0.2 };
        if (useTools) { body.tools = toolSchemas(); body.tool_choice = 'auto'; }
        const res = await fetch(url, {
          method: 'POST',
          headers: Object.assign(
            { 'content-type': 'application/json' },
            apiKey ? { authorization: `Bearer ${apiKey}` } : {},
          ),
          body: JSON.stringify(body),
          // Local engines run at single-digit tokens/sec on modest hardware;
          // a cloud-style 120s ceiling guarantees spurious aborts there.
          signal: AbortSignal.timeout(Number(ctx.timeoutMs) || eff.timeoutMs || (meta.local ? 600000 : 120000)),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          return {
            adapter: meta.id, available: true, error: true,
            summary: `${meta.label} HTTP ${res.status}: ${errText.slice(0, 300)}`,
            changedFiles: beforeRef ? changedFilesSince(cwd, beforeRef) : [],
            policyInput: basePolicyInput(ctx),
          };
        }
        const data = await res.json();
        const msg = data.choices && data.choices[0] && data.choices[0].message;
        if (!msg) {
          return {
            adapter: meta.id, available: true, error: true,
            summary: `${meta.label} returned no message/choices.`,
            changedFiles: [], policyInput: basePolicyInput(ctx),
          };
        }
        messages.push(msg);
        const calls = msg.tool_calls || [];
        if (!calls.length) { finalText = msg.content || ''; break; }
        for (const call of calls) {
          const fnName = call.function && call.function.name;
          let fnArgs = {};
          try { fnArgs = JSON.parse((call.function && call.function.arguments) || '{}'); } catch { /* keep {} */ }
          const out = executeTool(fnName, fnArgs, { cwd });
          toolTrace.push({ tool: fnName, ok: out.ok });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: String(out.output).slice(0, 8000),
          });
        }
      }

      const changedFiles = beforeRef ? changedFilesSince(cwd, beforeRef) : [];
      const diff = beforeRef ? diffText(cwd, beforeRef) : '';
      const secretScanPassed = scanForSecrets(diff) && scanForSecrets(finalText);
      const traceLine = toolTrace.length
        ? `\n\n[tools: ${toolTrace.map((t) => `${t.tool}${t.ok ? '' : '!'}`).join(', ')}]`
        : '';
      return {
        adapter: meta.id, available: true,
        toolCalls: toolTrace,
        summary: (`${meta.label} (${model}):\n${String(finalText).trim()}${traceLine}`).slice(0, 4000),
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
