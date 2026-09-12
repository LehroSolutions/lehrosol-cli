// The Loop Engine: a Ralph-style outer loop that repeatedly hands a prompt
// plus AGENTS.md + fix_plan.md context to an agent adapter, then grades the
// result with the Score Agent until it passes or the iteration budget runs out.
import { randomUUID } from 'node:crypto';
import { readAgentMd, readFixPlan, appendFixPlanItem } from './agentMd.js';
import { scoreIteration } from './scoreAgent.js';
import { ADAPTERS } from './adapters/index.js';
import { scanOwaspBasics } from '../harness/owasp.js';
import { createSession, recordCheckpoint, finalizeSession } from '../core/sessionStore.js';
import { captureWorkspaceDiff } from '../core/diffCapture.js';

export async function runLoop(options) {
  const opts = options || {};
  const prompt = opts.prompt;
  if (!prompt) throw new Error('loop_run requires a "prompt".');

  const requestedMax = Number(opts.maxIterations || 12);
  const maxIterations = Number.isFinite(requestedMax) ? Math.max(1, Math.min(requestedMax, 100)) : 12;
  const dryRun = opts.dryRun !== false;
  const requestedAdapter = opts.agentAdapter || 'local';
  if (!ADAPTERS[requestedAdapter] && opts.dryRun === false) {
    throw new Error(`Unknown live adapter: ${requestedAdapter}. Run \`lehrosol adapters\` or \`lehrosol models list\`.`);
  }
  const adapterName = ADAPTERS[requestedAdapter] ? requestedAdapter : 'local';
  const adapter = ADAPTERS[adapterName];
  const cwd = opts.cwd || process.cwd();

  const agentMd = readAgentMd(cwd);
  const fixPlan = readFixPlan(cwd);
  const sessionId = opts.sessionId || randomUUID();
  createSession({ id: sessionId, prompt: prompt, adapter: adapterName, cwd: cwd, startedAt: new Date().toISOString() });

  const iterations = [];
  let iteration = 0;
  let verdict = 'continue';
  // Continuation memory: each pass starts a fresh chat, so the previous pass's
  // summary is injected into the next prompt — otherwise a model that ran out
  // of tool steps redoes recon from scratch on every iteration.
  let lastSummary = null;

  while (verdict === 'continue' && iteration < maxIterations) {
    iteration += 1;
    const context = {
      prompt: prompt,
      agentMd: agentMd,
      fixPlan: fixPlan,
      iteration: iteration,
      lastSummary: lastSummary,
      owaspScope: opts.owaspScope,
      cwd: cwd,
      branch: opts.branch,
      reviewCount: opts.reviewCount,
      timeoutMs: opts.timeoutMs,
      temperature: opts.temperature,
      skills: opts.skills || [],
      reasoning: opts.reasoning || 'standard',
      resourceProfile: opts.resourceProfile || 'balanced',
      toolSteps: opts.toolSteps,
    };
    const result = dryRun ? await ADAPTERS.local(context) : await adapter(context);
    const adapterFailed = !dryRun && (result.available === false || result.error === true);
    const adapterIncomplete = !dryRun && result.incomplete === true;
    const owaspFindings = scanOwaspBasics({ cwd: cwd, files: result.changedFiles || [], owaspScope: opts.owaspScope });
    const policyInput = Object.assign({}, result.policyInput || {}, { owaspFindings: owaspFindings });
    const score = adapterFailed
      ? {
          iteration,
          score: 0,
          bar: 100,
          passed: false,
          violations: [{ name: result.available === false ? 'adapter-unavailable' : 'adapter-error', fixSuggestion: result.summary || 'Check adapter setup.' }],
          warnings: [],
          verdict: result.available === false ? 'stop-adapter-unavailable' : 'stop-adapter-error',
        }
      : adapterIncomplete
        ? {
            iteration,
            score: 0,
            bar: 100,
            passed: false,
            violations: [{ name: 'adapter-incomplete', fixSuggestion: result.summary || 'Adapter reached its tool-step checkpoint without a verified final answer.' }],
            warnings: [],
            verdict: iteration >= maxIterations ? 'stop-budget-exhausted' : 'continue',
          }
      : scoreIteration({ iteration: iteration, maxIterations: maxIterations, policyInput: policyInput, capabilityTier: opts.capabilityTier });
    // Snapshot the workspace diff so users can inspect exactly what the agent
    // changed (lehrosol diff, TUI 'x' view, GUI sessions_diff). Dry runs make
    // no changes, so skip the capture there.
    const workspaceDiff = dryRun ? null : captureWorkspaceDiff(cwd);
    const record = { iteration: iteration, adapter: adapterName, requestedAdapter: requestedAdapter, result: result, owaspFindings: owaspFindings, score: score, diff: workspaceDiff };
    iterations.push(record);
    recordCheckpoint(sessionId, iteration, record);
    if (result && result.summary) lastSummary = String(result.summary);
    verdict = score.verdict;
    if (verdict === 'stop-budget-exhausted') {
      appendFixPlanItem('Loop exhausted budget for prompt: ' + prompt, cwd);
    }
  }

  const summary = {
    sessionId: sessionId,
    prompt: prompt,
    adapter: adapterName,
    requestedAdapter: requestedAdapter,
    dryRun: dryRun,
    maxIterations: maxIterations,
    totalIterations: iterations.length,
    finalVerdict: verdict,
    skills: opts.skills || [],
    reasoning: opts.reasoning || 'standard',
    resourceProfile: opts.resourceProfile || 'balanced',
    iterations: iterations
  };
  finalizeSession(sessionId, summary);
  return summary;
}
