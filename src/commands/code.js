// LehroSol Code lane — hands-on agentic coding driven by the local model on
// :7000. The model works the CURRENT project folder with one JSON action per
// turn: list / read / write / run / done. Writes are jailed to the project
// root via pathSafety; command execution stays off unless --allowRun.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, basename, relative, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ui } from '../core/ui.js';
import { assertInsideRoot, PathSafetyError } from '../core/pathSafety.js';
import { chatOnce, ensureServing, displayModelName, DEFAULT_PORT, DEFAULT_KEY } from './quick.js';
import { buildSkillGuidance, inferSkillIds, mergeSkillIds, parseSkillRequest } from '../core/skills.js';
import { normalizeResourceProfile, RESOURCE_PROFILES } from '../core/resourcePlanner.js';
import { newMissionId, recordMission, suggestTuning, backupFile, readJournal } from '../core/journal.js';
import { loadRecommendations, recommendationForWorkflow } from '../bench/modelLab.js';

const IGNORED = new Set(['node_modules', '.git', '.lehro', 'dist', 'build', '.next', '__pycache__']);

export function resolveCodeGenerationSettings({ flags = {}, recommendation = null, resourceProfile = 'balanced', contextMode = 'normal' } = {}) {
  const recommended = recommendation?.ready ? (recommendation.recommended?.settings || {}) : {};
  const contextTokenBudget = { compact: 256, normal: 384, expanded: 512 }[contextMode] || 384;
  return {
    maxTokens: Number(flags.maxTokens || Math.min(recommended.maxTokens || Infinity, RESOURCE_PROFILES[resourceProfile].tokenBudget, contextTokenBudget)),
    temperature: flags.temperature != null ? Number(flags.temperature) : (recommended.temperature == null ? undefined : Number(recommended.temperature)),
  };
}
// A 2K-context local model cannot hold a full multi-kilobyte document plus the
// tool contract. Keep each observation deliberately small; large plans are
// read in line ranges instead of crashing the next request.
const MAX_READ_CHARS = 1800;
const MAX_RUN_CHARS = 4000;
// Local models often need more than a dozen tool turns for a real change.
// Treat maxSteps as a per-pass budget and continue through a few checkpoints
// by default, while keeping an upper bound for unattended runs.
export const CODE_DEFAULT_STEPS = 24;
export const CODE_DEFAULT_EXTENSIONS = 3;
export const CODE_HARD_STEP_LIMIT = 160;

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
}

export function resolveCodeBudget(flags = {}) {
  const maxSteps = boundedNumber(flags.maxSteps, CODE_DEFAULT_STEPS, 1, CODE_HARD_STEP_LIMIT);
  const strictBudget = flags.noAutoContinue === true || String(flags.noAutoContinue).toLowerCase() === 'true'
    || flags.autoContinue === false || String(flags.autoContinue).toLowerCase() === 'false';
  const autoContinue = !strictBudget;
  const maxExtensions = autoContinue
    ? boundedNumber(flags.maxExtensions, CODE_DEFAULT_EXTENSIONS, 0, 8)
    : 0;
  return {
    maxSteps,
    autoContinue,
    maxExtensions,
    totalStepBudget: Math.min(CODE_HARD_STEP_LIMIT, maxSteps * (maxExtensions + 1)),
  };
}

function emit(result, flags, logger) {
  if (flags.json) {
    if (logger && logger.json) logger.json(result);
    else console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

function formatKb(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function truncateText(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…(truncated: showing ${max} of ${s.length} chars)`;
}

// Small local models rarely emit ONLY JSON — they wrap it in prose or
// markdown fences. Scan for the first balanced JSON object that parses and
// carries an "action" field, ignoring braces inside strings.
export function extractAction(text) {
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j += 1) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const obj = JSON.parse(s.slice(i, j + 1));
            if (obj && typeof obj === 'object' && typeof obj.action === 'string') return obj;
          } catch { /* not JSON — keep scanning from the next brace */ }
          break;
        }
      }
    }
  }
  return null;
}

// Keep the conversation inside a small model's context window: cap the
// message count and shrink older tool results, preserving recent exchanges.
export function trimHistory(history, maxMessages = 18, maxChars = 3000) {
  const kept = history.slice(-maxMessages);
  return kept.map((m, idx) => (
    idx < kept.length - 4 && m.content.length > maxChars
      ? { ...m, content: truncateText(m.content, maxChars) }
      : m
  ));
}

// Every follow-up turn restates the goal. History is compacted hard to fit
// small context windows, so the prompt itself must carry the task — without
// this, the model forgets what it is doing after the first action and drifts
// into generic "nothing to do" replies.
export function buildFollowUpPrompt(goal, actionKind, observation) {
  return `TASK (unchanged): ${truncateText(String(goal), 300)}\n\nRESULT of ${String(actionKind)}:\n${observation}\n\nNext action?`;
}

export function buildNudgePrompt(goal) {
  return `TASK (unchanged): ${truncateText(String(goal), 300)}\n\nThat reply was not a single valid JSON action object. Reply with EXACTLY one JSON object like {"action":"read","path":"src/index.js"} and NOTHING else.`;
}

export function buildSystemPrompt({ allowRun, dryRun = false, reasoning = 'standard', skills } = {}) {
  const skillGuidance = buildSkillGuidance({ reasoning, skills });
  return [
    'You are LehroSol Code, a careful senior engineer working directly in the user\'s project folder.',
    'Accomplish the TASK by taking ONE action per reply. Reply with EXACTLY one JSON object and nothing else — no prose, no markdown fences.',
    '',
    'Actions:',
    '{"action":"list","path":"<dir>"}                          look inside a directory (paths are relative to the project root)',
    '{"action":"read","path":"<file>","startLine":1,"endLine":80} read a file or a focused line range',
    '{"action":"mkdir","path":"<folder>"}                       create a project folder when needed',
    '{"action":"write","path":"<file>","content":"<FULL new file content>"}   create or completely overwrite a file',
    '{"action":"edit","path":"<file>","find":"<exact text>","replace":"<new text>"}  replace the ONE exact occurrence of find in an existing file — the surgical way to change big files with small diffs',
    allowRun
      ? '{"action":"run","command":"<shell command>"}              run a command in the project root'
      : '(command execution is disabled in this session — never use "run")',
    '{"action":"done","summary":"<what changed and why>"}      finish the task',
    '',
    'Rules:',
    '- ALWAYS read a file before rewriting it; "write" replaces the whole file.',
    '- Prefer "edit" over "write" for changing existing files: the "find" text must be copied EXACTLY from a fresh read (including whitespace) and match exactly one occurrence.',
    '- If a file observation says it was truncated, continue with focused startLine/endLine reads; do not try to load the entire file at once.',
    '- Never invent file contents you have not read.',
    '- Keep changes minimal and complete. Do not touch unrelated files.',
    '- Keep working until the TASK is actually complete. Do not use "done" merely because you reached a step budget or inspected one file.',
    '- Use "done" only after verifying the requested result, or when a concrete blocker makes further progress impossible; include evidence or the blocker in the summary.',
    dryRun
      ? '- This is a DRY RUN: propose concrete mkdir/write actions. Do not claim files exist or changes were made unless you read evidence for that claim.'
      : '- This is a live-write session: create the requested files with write actions; write creates parent folders automatically.',
    '',
    skillGuidance.text,
  ].join('\n');
}

function normalizeProjectPath(value) {
  let path = String(value || '').trim();
  // Small local engines often turn filenames into Markdown links. A link is
  // presentation, not a filesystem path, so recover the visible filename.
  const markdown = path.match(/^\[([^\]]+)\]\([^)]*\)$/);
  if (markdown) path = markdown[1];
  return path.replace(/^`|`$/g, '').replace(/^\.\//, '');
}

function listDir(action, ctx) {
  const dir = assertInsideRoot(normalizeProjectPath(action.path || '.'), ctx.root);
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => !IGNORED.has(e.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 200)
    .map((e) => {
      if (e.isDirectory()) return e.name + '/';
      try { return `${e.name}  (${formatKb(statSync(join(dir, e.name)).size)})`; } catch { return e.name; }
    });
  return {
    ok: true,
    label: `list ${relative(ctx.root, dir) || '.'}`,
    observation: truncateText(entries.join('\n') || '(empty directory)', Number(ctx.maxListChars || 1200)),
  };
}

// Fast context: pre-read up to 3 key project files before the first turn
// so the model can answer simple questions in 1 step and start complex
// tasks with real context already loaded — saves 2-4 round trips.
async function buildFastContext(root, maxChars = 1600) {
  const candidates = [
    'README.md', 'README.txt', 'readme.md',
    'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
    'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
    'index.js', 'main.py', 'app.py', 'main.go', 'index.ts',
  ];
  const found = [];
  let used = 0;
  for (const rel of candidates) {
    try {
      const abs = join(root, rel);
      if (existsSync(abs)) {
        const st = statSync(abs);
        if (st.isFile() && st.size < 30000 && used < maxChars) {
          const content = readFileSync(abs, 'utf8');
          const take = Math.min(700, maxChars - used);
          found.push(`--- ${rel} (${formatKb(content.length)}) ---\n${truncateText(content, take)}`);
          used += take;
          if (found.length >= 2) break;
        }
      }
    } catch { /* skip unreadable */ }
  }
  return found.length
    ? '\n\nKey project files (pre-loaded — use these before listing/reading):\n\n' + found.join('\n\n')
    : '';
}

// Execute one model action against the real filesystem. Returns
// { ok, label, observation, done?, summary? } — observation is what the
// model sees next turn, label is what the human sees in the step log.
export async function applyAction(action, ctx) {
  const kind = String(action.action || '').toLowerCase();
  try {
    if (kind === 'list') return listDir(action, ctx);

    if (kind === 'read') {
      const relPath = normalizeProjectPath(action.path || '');
      const file = assertInsideRoot(relPath, ctx.root);
      if (!existsSync(file)) {
        return { ok: false, label: `read ${relPath} (missing)`, observation: `No such file: ${relPath}. Use {"action":"list","path":"."} to see what exists.` };
      }
      const content = readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/);
      const startLine = Math.max(1, Number(action.startLine || 1));
      const requestedEnd = Number(action.endLine || 0);
      const endLine = requestedEnd > 0 ? Math.min(lines.length, requestedEnd) : lines.length;
      const selected = lines.slice(startLine - 1, endLine).join('\n');
      return {
        ok: true,
        label: `read ${relative(ctx.root, file)} lines ${startLine}-${endLine} (${formatKb(statSync(file).size)})`,
        observation: `File: ${relative(ctx.root, file)} (${lines.length} lines). Showing lines ${startLine}-${endLine}.\n${truncateText(selected, Number(ctx.maxReadChars || MAX_READ_CHARS))}`,
      };
    }

    if (kind === 'write') {
      const file = assertInsideRoot(normalizeProjectPath(action.path || ''), ctx.root, { allowOutside: ctx.allowOutside });
      const content = String(action.content ?? '');
      const before = existsSync(file) ? statSync(file).size : null;
      const rel = relative(ctx.root, file);
      if (ctx.dryRun) {
        return { ok: true, label: `write ${rel} (dry run — held back)`, observation: `DRY RUN: ${rel} was NOT written (${content.length} chars staged). Continue as if it were.` };
      }
      // Snapshot the pre-write state so `lehrosol missions undo` can roll the
      // whole mission back — including deleting files it created.
      if (ctx.missionId) { try { backupFile(ctx.missionId, ctx.root, rel); } catch { /* backups are best-effort */ } }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      if (!ctx.changed.includes(rel)) ctx.changed.push(rel);
      return {
        ok: true,
        label: `write ${rel} (${formatKb(content.length)}${before == null ? ', new file' : `, was ${formatKb(before)}`})`,
        observation: `Wrote ${rel} (${content.length} chars${before == null ? ', new file' : ''}).`,
      };
    }

    if (kind === 'edit') {
      const file = assertInsideRoot(normalizeProjectPath(action.path || ''), ctx.root, { allowOutside: ctx.allowOutside });
      const rel = relative(ctx.root, file);
      const find = String(action.find ?? '');
      const replace = String(action.replace ?? '');
      if (!find) {
        return { ok: false, label: `edit ${rel} (no find)`, observation: 'The edit action needs an exact "find" string. Read the file and copy the text to replace verbatim.' };
      }
      if (!existsSync(file)) {
        return { ok: false, label: `edit ${rel} (missing)`, observation: `No such file: ${rel}. Use "write" to create a new file.` };
      }
      const content = readFileSync(file, 'utf8');
      const occurrences = content.split(find).length - 1;
      if (occurrences === 0) {
        return { ok: false, label: `edit ${rel} (no match)`, observation: `The "find" text was not found in ${rel}. Copy it EXACTLY from a fresh read — including whitespace — or use "write" to replace the whole file.` };
      }
      if (occurrences > 1) {
        return { ok: false, label: `edit ${rel} (ambiguous)`, observation: `The "find" text occurs ${occurrences} times in ${rel}. Extend the find string with surrounding lines until it matches exactly one occurrence, then retry.` };
      }
      const idx = content.indexOf(find);
      if (ctx.dryRun) {
        return { ok: true, label: `edit ${rel} (dry run — held back)`, observation: `DRY RUN: ${rel} was NOT edited (${find.length} → ${replace.length} chars staged). Continue as if it were.` };
      }
      if (ctx.missionId) { try { backupFile(ctx.missionId, ctx.root, rel); } catch { /* backups are best-effort */ } }
      writeFileSync(file, content.slice(0, idx) + replace + content.slice(idx + find.length));
      if (!ctx.changed.includes(rel)) ctx.changed.push(rel);
      return {
        ok: true,
        label: `edit ${rel} (${find.length} → ${replace.length} chars)`,
        observation: `Edited ${rel}: replaced ${find.length} chars with ${replace.length} chars.`,
      };
    }

    if (kind === 'mkdir') {
      const folder = assertInsideRoot(normalizeProjectPath(action.path || ''), ctx.root, { allowOutside: ctx.allowOutside });
      const rel = relative(ctx.root, folder);
      if (ctx.dryRun) return { ok: true, label: `mkdir ${rel} (dry run — held back)`, observation: `DRY RUN: ${rel} was NOT created. Continue with planned write actions.` };
      mkdirSync(folder, { recursive: true });
      return { ok: true, label: `mkdir ${rel}`, observation: `Created directory ${rel}.` };
    }

    if (kind === 'run') {
      if (!ctx.allowRun) {
        return { ok: false, label: 'run (blocked)', observation: 'Command execution is disabled for this session. Do not use "run" again — verify by reading files, or finish with "done" and tell the user what to run.' };
      }
      const command = String(action.command || '');
      const res = spawnSync(command, { shell: true, cwd: ctx.root, encoding: 'utf8', timeout: Number(ctx.runTimeoutMs || 120000), maxBuffer: 8 * 1024 * 1024 });
      const output = [res.stdout, res.stderr].filter(Boolean).join('\n');
      return {
        ok: true,
        label: `run ${command.slice(0, 48)} (exit ${res.status})`,
        observation: `exit code: ${res.status}\n${truncateText(output, MAX_RUN_CHARS) || '(no output)'}`,
      };
    }

    if (kind === 'done') {
      return { ok: true, done: true, label: 'done', summary: String(action.summary || '(no summary given)') };
    }

    return { ok: false, label: `${kind}?`, observation: `Unknown action "${kind}". Valid actions: list, read, edit, mkdir, write, run, done.` };
  } catch (e) {
    if (e instanceof PathSafetyError) {
      return { ok: false, label: `${kind} ${action.path} (blocked)`, observation: e.message };
    }
    return { ok: false, label: `${kind} failed`, observation: String(e.message || e) };
  }
}

export async function runCodeCommand(task, flags = {}, logger = console) {
  const parsedRequest = parseSkillRequest(task || flags.task || flags.prompt || '');
  let goal = parsedRequest.task;
  // `lehrosol code --continue` re-runs the most recent journal task — handy
  // after fixing the environment or undoing a bad mission.
  if (!goal && (flags.continue === true || String(flags.continue) === 'true')) {
    const last = readJournal().missions[0];
    if (last && last.task) goal = String(last.task);
  }
  if (!goal) {
    if (!flags.json) ui.error('lehrosol code needs a task', 'Example: lehrosol code "add input validation to src/server.js"');
    process.exitCode = 1;
    return emit({ ok: false, reason: 'no-task' }, flags, logger);
  }
  const port = Number(flags.port || DEFAULT_PORT);
  const apiKey = flags.apiKey || flags.key || DEFAULT_KEY;
  const { maxSteps, autoContinue, maxExtensions, totalStepBudget } = resolveCodeBudget(flags);
  const resourceProfile = normalizeResourceProfile(flags.resourceProfile || flags.ramProfile);
  const explicitContextMode = ['compact', 'normal', 'expanded'].includes(String(flags.contextMode || '').toLowerCase()) ? String(flags.contextMode).toLowerCase() : null;
  // Adaptive self-tuning: with no explicit flag, learn the default from how
  // recent missions went on this machine (see src/core/journal.js).
  const tuning = explicitContextMode ? null : suggestTuning();
  const contextMode = explicitContextMode || (tuning && tuning.contextMode) || 'normal';
  const contextModeSource = explicitContextMode ? 'flag' : (tuning && tuning.contextMode ? 'adaptive' : 'default');
  // llama.cpp reserves completion tokens against the active context window.
  // A 1024-token completion request can itself overflow a 2048-token server
  // once the tool contract and project context are present. Agent actions are
  // short JSON, so leave headroom by default; users may still override this.
  const codeRecommendation = recommendationForWorkflow(String(flags.model || 'local'), 'code', loadRecommendations(), { fallbackGeneral: false });
  const generation = resolveCodeGenerationSettings({ flags, recommendation: codeRecommendation, resourceProfile, contextMode });
  const { maxTokens, temperature } = generation;
  const timeoutMs = Number(flags.timeout || 600000);
  const activeSkills = mergeSkillIds(inferSkillIds(goal), flags.skills || flags.skill, parsedRequest.requested);
  const skillSet = buildSkillGuidance({ reasoning: flags.reasoning, skills: activeSkills });

  const serving = await ensureServing({ model: flags.model, port, apiKey, restart: Boolean(flags.restart), showWarmup: !flags.json }, flags, logger);
  if (!serving.ok) {
    process.exitCode = 1;
    return emit(serving, flags, logger);
  }

  const missionStart = Date.now();
  const ctx = {
    missionId: newMissionId(),
    root: process.cwd(),
    dryRun: Boolean(flags.dryRun),
    allowRun: Boolean(flags.allowRun),
    allowOutside: Boolean(flags.allowOutsideProject),
    maxReadChars: contextMode === 'compact' ? 1100 : contextMode === 'expanded' ? 2200 : MAX_READ_CHARS,
    maxListChars: contextMode === 'compact' ? 700 : contextMode === 'expanded' ? 1800 : 1200,
    changed: [],
  };

  if (!flags.json) {
    ui.sectionHeader(`LEHROSOL CODE — ${displayModelName(serving.model).toUpperCase()} ON :${port}${serving.reused ? ' (ALREADY HOT)' : ''}`);
    ui.keyValue('Task', goal.slice(0, 100));
    ui.keyValue('Project root', ctx.root);
    ui.keyValue('Writes', ctx.dryRun ? 'dry run (nothing touches disk)' : 'live (jailed to the project root)');
    ui.keyValue('Commands', ctx.allowRun ? 'enabled (--allowRun)' : 'disabled (pass --allowRun to enable)');
    ui.keyValue('Reasoning', skillSet.reasoning);
    ui.keyValue('Skills', skillSet.skillIds.join(', '));
    ui.keyValue('Resource profile', resourceProfile);
    ui.keyValue('Context mode', `${contextMode} (${ctx.maxReadChars} chars per read · ${maxTokens} output tokens reserved)${contextModeSource === 'adaptive' ? ' — auto-tuned from mission history' : ''}`);
    ui.keyValue('Step budget', `${maxSteps} per pass · ${totalStepBudget} total${autoContinue ? ` · up to ${maxExtensions} continuation(s)` : ' · strict'}`);
    ui.keyValue('Mission id', ctx.missionId);
    console.log();
  }

  const system = buildSystemPrompt({ allowRun: ctx.allowRun, dryRun: ctx.dryRun, reasoning: skillSet.reasoning, skills: skillSet.skillIds });
  let initialListing = '(could not list the project root)';
  try { initialListing = listDir({ path: '.' }, ctx).observation; } catch { /* keep placeholder */ }

  // Fast context: pre-read key files so the model can answer simpler
  // questions immediately and start complex tasks with real context.
  // Disable with --fast=false if you want the model to discover on its own.
  let fastContext = '';
  if (contextMode !== 'compact' && flags.fast !== false && String(flags.fast) !== 'false') {
    fastContext = await buildFastContext(ctx.root, contextMode === 'expanded' ? 2800 : 1600);
    if (!flags.json && fastContext) console.log(`  [fast] pre-loaded ${fastContext.match(/--- /g)?.length ?? 0} key file(s)`);
  }

  // Plan-first mode: one tiny planning turn keeps deep missions on rails.
  // Enabled with --plan, or automatically for deep reasoning; --plan=false disables.
  let planText = '';
  const planDisabled = flags.plan === false || String(flags.plan) === 'false';
  const planWanted = !planDisabled && (flags.plan === true || String(flags.plan) === 'true' || skillSet.reasoning === 'deep');
  if (planWanted) {
    const planRes = await chatOnce({ baseUrl: serving.baseUrl, apiKey, prompt: `TASK: ${goal}\n\nWrite a numbered micro-plan (at most 3 short steps) for completing this task with list/read/write actions. Plan only — no JSON, no code.`, system: 'You are a concise planning assistant. Reply with at most 3 numbered steps, one line each.', history: [], maxTokens: 96, temperature, timeoutMs });
    if (planRes.ok && planRes.content) {
      planText = truncateText(String(planRes.content).trim(), 400);
      if (!flags.json) console.log(`  [plan]\n${planText.split('\n').map((l) => `    ${l}`).join('\n')}`);
    }
  }

  let history = [];
  let prompt = `TASK: ${goal}\n\nProject root: ${basename(ctx.root)}\nTop-level entries:\n${initialListing}${fastContext}${planText ? `\n\nPLAN (follow it, adjust if reality disagrees):\n${planText}` : ''}\n\nStart with your first action. If the pre-loaded files already give you enough context to answer the task fully, you may go straight to \"done\".`;
  let summary = null;
  let stepsUsed = 0;
  let parseFails = 0;
  let retries = 0;
  let lastActionKey = null;
  let repeatedActions = 0;
  let prematureDoneClaims = 0;
  const actionCounts = {};
  const missionFlags = { dryRun: ctx.dryRun, allowRun: ctx.allowRun, contextMode, resourceProfile, reasoning: skillSet.reasoning, maxSteps, autoContinue, maxExtensions, totalStepBudget };
  let extensions = 0;
  let stepsWithoutActing = 0;
  let terminationReason = 'budget-exhausted';

  for (let step = 1; step <= totalStepBudget; step += 1) {
    stepsUsed = step;
    const stepStart = Date.now();
    let res = await chatOnce({ baseUrl: serving.baseUrl, apiKey, prompt, system, history, maxTokens, temperature, timeoutMs });
    // Self-healing: a context overflow shrinks observation budgets and retries
    // instead of killing the mission (the old behavior surfaced as HTTP 500).
    if (!res.ok && retries < 2 && /context|exceed|500/i.test(String(res.error || ''))) {
      retries += 1;
      ctx.maxReadChars = Math.max(500, Math.floor(Number(ctx.maxReadChars) * 0.55));
      ctx.maxListChars = Math.max(400, Math.floor(Number(ctx.maxListChars) * 0.55));
      history = [];
      prompt = `TASK (unchanged): ${truncateText(goal, 300)}\n\n(The previous request overflowed the model context; observations are smaller now.) Continue with your next action.`;
      if (!flags.json) console.log(`  [${step}/${totalStepBudget}] context overflow — shrinking observations and retrying (${retries}/2)`);
      res = await chatOnce({ baseUrl: serving.baseUrl, apiKey, prompt, system, history, maxTokens: Math.min(maxTokens, 256), temperature, timeoutMs });
    }
    if (!res.ok) {
      if (!flags.json) ui.error('Model call failed', res.error);
      recordMission({ id: ctx.missionId, ok: false, task: goal, steps: stepsUsed, retries, durationMs: Date.now() - missionStart, changedFiles: ctx.changed, contextMode, contextModeSource, resourceProfile, root: ctx.root, error: String(res.error || 'chat failed'), flags: missionFlags });
      process.exitCode = 1;
      return emit({ ok: false, reason: 'chat-failed', error: res.error, changedFiles: ctx.changed, missionId: ctx.missionId }, flags, logger);
    }
    // Never retain the original project dump after the first tool action. It
    // is the main source of context-overflow on 2K llama.cpp servers. The
    // current observation plus the immediately preceding action is enough to
    // continue the tool loop and keeps every request bounded.
    history = [{ role: 'assistant', content: truncateText(res.content, 700) }];

    const action = extractAction(res.content);
    if (!action) {
      parseFails += 1;
      if (!flags.json) console.log(`  [${step}/${totalStepBudget}] (no valid JSON action in reply — nudging the model)`);
      if (parseFails >= 3) {
        if (!flags.json) ui.error('Model kept replying without a valid JSON action', 'This model may be too small for the code lane — try a stronger one: lehrosol code "..." --model jan');
        terminationReason = 'model-format-stall';
        break;
      }
      prompt = buildNudgePrompt(goal);
      continue;
    }
    parseFails = 0;

    // Loop guard: a model that repeats the exact same action is stuck.
    const actionKey = JSON.stringify(action);
    if (actionKey === lastActionKey) {
      repeatedActions += 1;
      if (!flags.json) console.log(`  [${step}/${totalStepBudget}] (repeated the same action — nudging a different approach)`);
      if (repeatedActions >= 4) {
        terminationReason = 'model-action-stall';
        break;
      }
      prompt = `TASK (unchanged): ${truncateText(goal, 300)}\n\nYou just repeated the exact same action. Do NOT repeat it. Take a DIFFERENT next action, or finish with \"done\".`;
      continue;
    }
    repeatedActions = 0;
    lastActionKey = actionKey;
    actionCounts[String(action.action)] = (actionCounts[String(action.action)] || 0) + 1;

    // Verification-treadmill guard (2026-09-11, Qwen3.8-9B live run): the
    // model cycled list/read/run for 15+ steps re-verifying without ever
    // acting — the identical-action stall guard cannot see it because every
    // read varies slightly. After this many non-acting steps in a row,
    // demand the actual change (or an honest done-with-blocker).
    const actingKind = ['write', 'edit', 'mkdir'].includes(String(action.action).toLowerCase());
    if (actingKind) stepsWithoutActing = 0;
    else stepsWithoutActing += 1;
    if (stepsWithoutActing === 6) {
      prompt = `TASK (unchanged): ${truncateText(goal, 300)}\n\nYou have taken ${stepsWithoutActing} inspection steps in a row without changing any file. Take the actual edit or write action NOW — copy the exact text from your last read. If acting is genuinely impossible, use "done" with the specific blocker.`;
      if (!flags.json) console.log(`  [${step}/${totalStepBudget}] action-lag guard: ${stepsWithoutActing} non-acting steps — demanding the change`);
      continue;
    }

    const out = await applyAction(action, ctx);
    if (!flags.json) console.log(`  [${step}/${totalStepBudget}] ${out.label}${out.ok ? '' : '  ← refused'}  (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);
    if (out.done) {
      const summaryText = String(out.summary || '').trim();
      const mutationTask = /\b(add|build|change|create|delete|fix|implement|modify|refactor|remove|rename|replace|update|write)\b/i.test(goal);
      const blockerClaim = /\b(blocked|cannot|can't|impossible|missing|not available|unable)\b/i.test(summaryText);
      const premature = summaryText.length < 20 || (mutationTask && !ctx.dryRun && ctx.changed.length === 0 && !blockerClaim);
      if (premature && prematureDoneClaims < 2) {
        prematureDoneClaims += 1;
        prompt = `TASK (unchanged): ${truncateText(goal, 300)}\n\nCompletion was not accepted: ${summaryText.length < 20 ? 'the summary lacked concrete evidence' : 'this is a change task but no file changes were recorded'}. Continue working, or return "done" with a specific blocker and evidence.`;
        if (!flags.json) console.log(`  [${step}/${totalStepBudget}] done claim rejected — completion evidence is incomplete (${prematureDoneClaims}/2)`);
        continue;
      }
      summary = out.summary;
      terminationReason = 'done';
      break;
    }
    prompt = buildFollowUpPrompt(goal, action.action, out.observation);

    // A pass boundary is a checkpoint, not an automatic task failure. Give
    // the model a fresh request with the unchanged goal and let it continue
    // unless the caller explicitly selected strict mode.
    if (step < totalStepBudget && step % maxSteps === 0 && extensions < maxExtensions) {
      extensions += 1;
      history = [];
      prompt = `TASK (unchanged): ${truncateText(goal, 300)}\n\nBudget checkpoint reached after ${step} tool steps. Continue from the current project state; do not stop just because the previous pass ended. Take the next action, or use "done" only after verification.`;
      if (!flags.json) console.log(`  [${step}/${totalStepBudget}] continuing mission (pass ${extensions + 1}/${maxExtensions + 1})`);
    }
  }

  const durationMs = Date.now() - missionStart;
  recordMission({ id: ctx.missionId, ok: Boolean(summary), task: goal, steps: stepsUsed, retries, extensions, totalStepBudget, terminationReason, durationMs, changedFiles: ctx.changed, contextMode, contextModeSource, resourceProfile, root: ctx.root, summary, actionCounts, flags: missionFlags });

  if (!flags.json) {
    ui.divider();
    if (summary) ui.success(`Done in ${stepsUsed} step(s)`, summary.slice(0, 300));
    else ui.warning(`Stopped after ${stepsUsed} step(s) without "done"`, `${terminationReason}${autoContinue ? ' — continuation budget exhausted' : ' — strict budget enabled'}. Resume with --continue or raise --maxSteps.`);
    if (ctx.changed.length) ui.keyValue('Files changed', ctx.changed.join(', '));
    else ui.keyValue('Files changed', ctx.dryRun ? '(none — dry run)' : '(none)');
    ui.keyValue('Mission report', `${(durationMs / 1000).toFixed(1)}s · ${Object.entries(actionCounts).map(([k, v]) => `${k}×${v}`).join(' ') || 'no actions'}${retries ? ` · ${retries} overflow retry(ies)` : ''}`);
    ui.nextSteps([
      'Review the changes: git diff (or open the files)',
      ctx.changed.length ? `Roll it back if needed: lehrosol missions undo --id ${ctx.missionId}` : (ctx.dryRun ? 'Happy with the plan? Re-run without --dryRun to write for real' : 'Test it, then commit'),
      'Mission history: lehrosol missions list',
    ]);
  }

  return emit({ ok: Boolean(summary), missionId: ctx.missionId, task: goal, reasoning: skillSet.reasoning, skills: skillSet.skillIds, model: serving.model, steps: stepsUsed, maxSteps, totalStepBudget, autoContinue, extensions, terminationReason, continuationAvailable: !summary && terminationReason === 'budget-exhausted', retries, durationMs, actionCounts, contextMode, contextModeSource, resourceProfile, changedFiles: ctx.changed, summary }, flags, logger);
}
