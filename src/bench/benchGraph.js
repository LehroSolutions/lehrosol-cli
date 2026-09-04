// LehroSol Bench — Graph scorecard.
//
// Tests the dependency-aware task-graph scheduler (orchestrator/taskGraph.js):
// cycle detection, missing-dep rejection, wave construction, concurrency cap,
// fail-fast blocking, max-parallelism reporting. These are pure functions so
// every test is deterministic — the graph layer should never need a live
// model to grade.
//
// Each test produces a result { id, label, passed, score (0-100), note? }.
// The aggregate layer score is the mean of test scores, with the user's
// per-test correction multiplier applied on top.

import { planTaskGraph, validateTaskGraph, executeTaskGraph } from '../orchestrator/taskGraph.js';
import { correctionFor } from './benchStore.js';

const RESULTS = [];
function record(id, label, passed, note, points = 100) {
  RESULTS.push({ id, label, passed: !!passed, score: passed ? points : 0, note: note || null });
}

// ---------------------------------------------------------------------------
// Deterministic graph test cases.
// ---------------------------------------------------------------------------

function testValidateGraphHappyPath() {
  // Valid 4-task diamond: A -> B,C -> D. Should plan into 3 waves.
  try {
    const graph = validateTaskGraph({
      id: 'diamond',
      tasks: [
        { id: 'A', prompt: 'first' },
        { id: 'B', prompt: 'second-a', dependsOn: ['A'] },
        { id: 'C', prompt: 'second-b', dependsOn: ['A'] },
        { id: 'D', prompt: 'third', dependsOn: ['B', 'C'] },
      ],
    });
    const plan = planTaskGraph(graph);
    const wavesOk = JSON.stringify(plan.waves) === JSON.stringify([['A'], ['B', 'C'], ['D']]);
    const parOk = plan.maxParallelism === 2;
    record('graph.happy-path', 'Diamond graph plans into 3 waves with parallelism=2', wavesOk && parOk, wavesOk && parOk ? null : `waves=${JSON.stringify(plan.waves)} parallelism=${plan.maxParallelism}`);
  } catch (e) {
    record('graph.happy-path', 'Diamond graph plans into 3 waves with parallelism=2', false, e.message);
  }
}

function testValidateGraphRejectsCycle() {
  try {
    validateTaskGraph({
      tasks: [
        { id: 'A', prompt: 'a', dependsOn: ['B'] },
        { id: 'B', prompt: 'b', dependsOn: ['A'] },
      ],
    });
    record('graph.cycle-detected', 'Self-referential cycle is rejected', false, 'no throw');
  } catch (e) {
    record('graph.cycle-detected', 'Self-referential cycle is rejected', /cycle/i.test(e.message), e.message);
  }
}

function testValidateGraphRejectsMissingDep() {
  try {
    validateTaskGraph({
      tasks: [{ id: 'A', prompt: 'a', dependsOn: ['ghost'] }],
    });
    record('graph.missing-dep', 'Reference to nonexistent task is rejected', false, 'no throw');
  } catch (e) {
    record('graph.missing-dep', 'Reference to nonexistent task is rejected', /missing task/i.test(e.message), e.message);
  }
}

function testValidateGraphRejectsSelfDependency() {
  try {
    validateTaskGraph({
      tasks: [{ id: 'A', prompt: 'a', dependsOn: ['A'] }],
    });
    record('graph.self-dep', 'Task depending on itself is rejected', false, 'no throw');
  } catch (e) {
    record('graph.self-dep', 'Task depending on itself is rejected', /itself/i.test(e.message), e.message);
  }
}

function testValidateGraphRejectsDuplicateIds() {
  try {
    validateTaskGraph({
      tasks: [
        { id: 'A', prompt: 'a' },
        { id: 'A', prompt: 'b' },
      ],
    });
    record('graph.duplicate-id', 'Duplicate task ids are rejected', false, 'no throw');
  } catch (e) {
    record('graph.duplicate-id', 'Duplicate task ids are rejected', /duplicate/i.test(e.message), e.message);
  }
}

function testValidateGraphRejectsOversize() {
  try {
    const tasks = Array.from({ length: 101 }, (_, i) => ({ id: 'T' + i, prompt: 'p' + i }));
    validateTaskGraph({ tasks: tasks });
    record('graph.size-cap', '>100 task graph is rejected', false, 'no throw');
  } catch (e) {
    record('graph.size-cap', '>100 task graph is rejected', /safety limit/i.test(e.message), e.message);
  }
}

function testValidateGraphRejectsEmpty() {
  try {
    validateTaskGraph({ tasks: [] });
    record('graph.empty', 'Empty task graph is rejected', false, 'no throw');
  } catch (e) {
    record('graph.empty', 'Empty task graph is rejected', /at least one/i.test(e.message), e.message);
  }
}

function testValidateGraphRejectsInvalidIds() {
  try {
    validateTaskGraph({ tasks: [{ id: 'has space', prompt: 'p' }] });
    record('graph.id-format', 'Task id with whitespace is rejected', false, 'no throw');
  } catch (e) {
    record('graph.id-format', 'Task id with whitespace is rejected', /invalid task id/i.test(e.message), e.message);
  }
}

async function testExecuteGraphHonorsFailFast() {
  // 3 tasks: A (succeeds), B (fails), C (depends on B; must be blocked).
  let cStarted = false;
  const plan = validateTaskGraph({
    tasks: [
      { id: 'A', prompt: 'ok' },
      { id: 'B', prompt: 'fail', dependsOn: ['A'] },
      { id: 'C', prompt: 'downstream', dependsOn: ['B'] },
    ],
  });
  const execution = await executeTaskGraph(plan, {
    concurrency: 4,
    failFast: true,
    runner: async (task) => {
      if (task.id === 'B') throw new Error('boom');
      if (task.id === 'C') cStarted = true;
      return { ok: true };
    },
  });
  const cBlocked = execution.tasks.find((t) => t.task.id === 'C');
  const cDidNotRun = cBlocked && cBlocked.status === 'blocked' && !cStarted;
  record('graph.fail-fast', 'Downstream tasks blocked when an upstream task fails', cDidNotRun, cDidNotRun ? null : `C.status=${cBlocked?.status} C.ran=${cStarted}`);
}

async function testExecuteGraphContinuesWithoutFailFast() {
  // Same shape but failFast=false: C should still run after B fails.
  let cStarted = false;
  const plan = validateTaskGraph({
    tasks: [
      { id: 'A', prompt: 'ok' },
      { id: 'B', prompt: 'fail', dependsOn: ['A'] },
      { id: 'C', prompt: 'downstream', dependsOn: ['B'] },
    ],
  });
  const execution = await executeTaskGraph(plan, {
    concurrency: 4,
    failFast: false,
    runner: async (task) => {
      if (task.id === 'B') throw new Error('boom');
      if (task.id === 'C') cStarted = true;
      return { ok: true };
    },
  });
  record('graph.continue-on-fail', 'Without failFast, downstream tasks still execute after upstream failure', cStarted, cStarted ? null : 'C did not run');
}

async function testExecuteGraphConcurrencyCap() {
  // 6 independent tasks: with concurrency=2, should take ~3 waves of 2 each.
  let maxConcurrent = 0;
  let current = 0;
  const plan = validateTaskGraph({
    tasks: Array.from({ length: 6 }, (_, i) => ({ id: 'T' + i, prompt: 'p' + i })),
  });
  await executeTaskGraph(plan, {
    concurrency: 2,
    runner: async () => {
      current += 1;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 10));
      current -= 1;
      return { ok: true };
    },
  });
  record('graph.concurrency-cap', 'Runner concurrency is clamped to the requested limit', maxConcurrent <= 2, `observed max concurrent=${maxConcurrent}`);
}

async function testExecuteGraphSchedulesIndependentTasksInSameWave() {
  // 4 tasks with no deps: should all run in one wave (regardless of completion order).
  const finishedOrder = [];
  const plan = planTaskGraph({
    tasks: [
      { id: 'A', prompt: 'a' },
      { id: 'B', prompt: 'b' },
      { id: 'C', prompt: 'c' },
      { id: 'D', prompt: 'd' },
    ],
  });
  const execution = await executeTaskGraph(plan, {
    concurrency: 4,
    runner: async (task) => { finishedOrder.push(task.id); return { ok: true }; },
  });
  const oneWave = plan.waves.length === 1 && plan.waves[0].length === 4;
  record('graph.parallel-wave', 'Independent tasks are scheduled in a single parallel wave', oneWave, `waves=${JSON.stringify(plan.waves)} order=${finishedOrder.join(',')}`);
}

async function testExecuteGraphMarksSuccessOnCompletion() {
  const plan = validateTaskGraph({
    tasks: [{ id: 'A', prompt: 'ok' }],
  });
  const execution = await executeTaskGraph(plan, {
    runner: async () => ({ ok: true }),
  });
  const ok = execution.status === 'done' && execution.failed === 0 && execution.tasks[0].status === 'done';
  record('graph.success-status', 'Successful execution reports status=done with zero failed tasks', ok, `status=${execution.status} failed=${execution.failed}`);
}

// ---------------------------------------------------------------------------
// Public entry: run all graph tests and return the scorecard.
// ---------------------------------------------------------------------------

export async function runGraphBench() {
  RESULTS.length = 0;
  testValidateGraphHappyPath();
  testValidateGraphRejectsCycle();
  testValidateGraphRejectsMissingDep();
  testValidateGraphRejectsSelfDependency();
  testValidateGraphRejectsDuplicateIds();
  testValidateGraphRejectsOversize();
  testValidateGraphRejectsEmpty();
  testValidateGraphRejectsInvalidIds();
  await testExecuteGraphHonorsFailFast();
  await testExecuteGraphContinuesWithoutFailFast();
  await testExecuteGraphConcurrencyCap();
  await testExecuteGraphSchedulesIndependentTasksInSameWave();
  await testExecuteGraphMarksSuccessOnCompletion();

  // Apply per-test corrections (user-tuned weights from preferences.json).
  const adjusted = RESULTS.map((r) => ({ ...r, adjustedScore: r.passed ? r.score * correctionFor(r.id) : r.score }));
  const totalPoints = adjusted.reduce((sum, r) => sum + r.adjustedScore, 0);
  const maxPoints = adjusted.length * 100;
  const score = Math.round((totalPoints / maxPoints) * 100);
  const passed = adjusted.filter((r) => r.passed).length;
  return {
    layer: 'graph',
    score: score,
    passed: passed,
    failed: adjusted.length - passed,
    total: adjusted.length,
    results: adjusted,
    generatedAt: new Date().toISOString(),
  };
}
