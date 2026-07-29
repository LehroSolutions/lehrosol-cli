// Autonomous mission engine: goal -> plan -> execute -> verify -> adapt.
// A mission decomposes one high-level goal into a dependency-aware phase graph,
// executes each phase through the Loop Engine (graded by the harness Score
// Agent), and applies the supervisor recovery ladder (retry -> replan ->
// escalate) when a live phase fails. Every event is persisted to the run
// registry so missions are inspectable and resumable evidence, not vibes.
import { randomUUID } from 'node:crypto';
import { runLoop } from '../loop/loop.js';
import { planTaskGraph, executeTaskGraph } from '../orchestrator/taskGraph.js';
import { createRun, appendRunEvent, updateRun, loadRun, listRuns } from '../core/runRegistry.js';
import { listAdapters } from '../loop/adapters/index.js';
import { getFavorites } from '../core/favorites.js';

export const AUTONOMY_LEVELS = ['readonly', 'guarded', 'full'];

export function normalizeAutonomy(value) {
  const level = String(value || 'guarded').trim().toLowerCase();
  if (!AUTONOMY_LEVELS.includes(level)) throw new Error(`Unknown autonomy level: ${value}. Use readonly | guarded | full.`);
  return level;
}

// Pick the best executor: explicit > preferred (if ready) > first ready live adapter > local.
export function resolveMissionAdapter(explicit) {
  const adapters = listAdapters();
  if (explicit) {
    const found = adapters.find((a) => a.id === String(explicit).toLowerCase());
    if (!found) throw new Error(`Unknown adapter: ${explicit}. Run \`lehrosol adapters\`.`);
    return found.id;
  }
  const preferred = getFavorites().preferredAdapter;
  const pick = adapters.find((a) => a.id === preferred && a.configured)
    || adapters.find((a) => a.kind === 'http' && a.configured)
    || adapters.find((a) => a.configured && a.id !== 'local');
  return pick ? pick.id : 'local';
}

// Deterministic phase planner. Offline-safe by design: phases encode the
// agentic engineering method itself (recon -> implement -> verify [+harden/document]).
export function planMission(goal, options = {}) {
  const text = String(goal || '').trim();
  if (!text) throw new Error('A mission requires a --goal.');
  const id = `mission-${(options.id || randomUUID().slice(0, 8)).toString().replace(/[^A-Za-z0-9._-]/g, '-')}`;
  const tasks = [
    { id: 'recon', prompt: `Mission goal: ${text}\n\nPhase 1 (recon): survey the repository, identify exactly what must change to achieve the goal, list risks, and produce a concrete step plan. Do not modify files in this phase beyond notes.` },
    { id: 'implement', dependsOn: ['recon'], prompt: `Mission goal: ${text}\n\nPhase 2 (implement): execute the recon plan with the smallest complete safe changes. Prefer existing project patterns. Include or update tests for changed behavior.` },
    { id: 'verify', dependsOn: ['implement'], prompt: `Mission goal: ${text}\n\nPhase 3 (verify): review the implementation like a hostile senior engineer. Run/describe verification, list any regressions or missed requirements, and fix small issues found.` },
  ];
  if (options.harden) tasks.push({ id: 'harden', dependsOn: ['verify'], prompt: `Mission goal: ${text}\n\nPhase 4 (harden): scan the changed surfaces for security issues (injection, secrets, path escapes, unbounded input) and fix what you find.` });
  if (options.document) tasks.push({ id: 'document', dependsOn: [options.harden ? 'harden' : 'verify'], prompt: `Mission goal: ${text}\n\nFinal phase (document): update project docs/changelog to reflect what changed and why.` });
  return { id, goal: text, tasks };
}

export async function runMission(goal, options = {}) {
  const autonomy = normalizeAutonomy(options.autonomy);
  // readonly can never mutate: force dry-run regardless of flags.
  const dryRun = autonomy === 'readonly' ? true : options.dryRun !== false;
  const adapter = dryRun ? (options.adapter || 'local') : resolveMissionAdapter(options.adapter);
  const maxIterations = Math.max(1, Math.min(Number(options.maxIterations || 3), 12));
  const plan = planMission(goal, options);
  const graph = planTaskGraph({ id: plan.id, tasks: plan.tasks });

  createRun({ id: plan.id, kind: 'mission', goal: plan.goal, autonomy, adapter, dryRun, status: 'running', graph });
  appendRunEvent(plan.id, { type: 'mission-started', autonomy, adapter, dryRun, phases: plan.tasks.map((t) => t.id) });
  options.onEvent?.({ type: 'mission-started', missionId: plan.id, phases: plan.tasks.map((t) => t.id) });

  const recoveries = [];
  const runner = async (task) => {
    // Attempt ladder: run -> (full autonomy, live only) retry -> replan.
    const attempts = (!dryRun && autonomy === 'full') ? ['run', 'retry', 'replan'] : ['run'];
    let last = null;
    for (const strategy of attempts) {
      const prompt = strategy === 'replan'
        ? `${task.prompt}\n\nPrevious attempts failed the harness gate (verdict: ${last?.finalVerdict}). Re-plan: take a different, simpler approach and fix the specific violations before finishing.`
        : task.prompt;
      if (strategy !== 'run') { recoveries.push({ phase: task.id, strategy }); appendRunEvent(plan.id, { type: 'mission-recovery', phase: task.id, strategy }); options.onEvent?.({ type: 'mission-recovery', phase: task.id, strategy }); }
      last = await runLoop({ prompt, agentAdapter: adapter, dryRun, maxIterations, cwd: options.cwd || process.cwd(), branch: options.branch, owaspScope: options.owaspScope, capabilityTier: options.capabilityTier || 'standard' });
      if (last.finalVerdict === 'stop-success') break;
      // Adapter-level failures are terminal: recovery cannot fix a missing binary/key.
      if (String(last.finalVerdict).startsWith('stop-adapter')) break;
    }
    if (last.finalVerdict !== 'stop-success') { const err = new Error(`Phase ${task.id} ended with ${last.finalVerdict}`); err.loopResult = last; throw err; }
    return last;
  };

  const execution = await executeTaskGraph(graph, { concurrency: 1, failFast: true, onEvent: (e) => { appendRunEvent(plan.id, e); options.onEvent?.(e); }, runner });

  const phases = execution.tasks.map((t) => ({ phase: t.task.id, status: t.status, verdict: t.result?.finalVerdict || t.error || null, sessionId: t.result?.sessionId || null, iterations: t.result?.totalIterations || 0 }));
  const status = execution.status === 'done' ? 'succeeded' : 'failed';
  const report = { id: plan.id, goal: plan.goal, autonomy, adapter, dryRun, status, phases, recoveries, finishedAt: new Date().toISOString() };
  updateRun(plan.id, { status, phases, recoveries, report, tasks: execution.tasks.map((t) => ({ id: t.task.id, status: t.status, attempts: t.attempts, error: t.error || null })) });
  appendRunEvent(plan.id, { type: 'mission-finished', status });
  options.onEvent?.({ type: 'mission-finished', missionId: plan.id, status });
  return report;
}

export function listMissions({ limit = 30 } = {}) {
  return listRuns({ limit: 200 }).filter((run) => run.kind === 'mission').slice(0, Math.max(1, Math.min(Number(limit) || 30, 200)));
}

export function loadMission(id) {
  const run = loadRun(id);
  return run && run.kind === 'mission' ? run : null;
}
