// LehroSol Bench — Mission/Agentic scorecard.
//
// Tests the agentic mission engine (agentic/mission.js + orchestrator/taskGraph.js
// when driven by missions): goal -> plan produces the right phases,
// dependencies are wired correctly, dry-run mode is default, readonly
// forces dry-run even when caller asks for live, recovery ladder is
// exposed in the report, mission persists to the run registry.
//
// Every test uses a deterministic local dry-run loop so the bench runs in
// any environment (no live model needed).

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planMission, runMission, normalizeAutonomy, AUTONOMY_LEVELS, resolveMissionAdapter } from '../agentic/mission.js';
import { listRuns, loadRun } from '../core/runRegistry.js';
import { correctionFor } from './benchStore.js';

const RESULTS = [];
function record(id, label, passed, note, points = 100) {
  RESULTS.push({ id, label, passed: !!passed, score: passed ? points : 0, note: note || null });
}

// ---------------------------------------------------------------------------
// Static planner tests.
// ---------------------------------------------------------------------------

function testAutonomyLevelsExposed() {
  const ok = AUTONOMY_LEVELS.length === 3
    && AUTONOMY_LEVELS.includes('readonly')
    && AUTONOMY_LEVELS.includes('guarded')
    && AUTONOMY_LEVELS.includes('full');
  record('mission.autonomy.levels', 'All three autonomy levels (readonly, guarded, full) are exposed', ok, `levels=${AUTONOMY_LEVELS.join(',')}`);
}

function testNormalizeAutonomyAcceptsValidLevels() {
  const cases = [['readonly', 'readonly'], ['GUARDED', 'guarded'], ['Full', 'full'], [undefined, 'guarded']];
  let ok = true;
  for (const [input, expected] of cases) {
    if (normalizeAutonomy(input) !== expected) { ok = false; break; }
  }
  record('mission.autonomy.normalize', 'normalizeAutonomy accepts and normalizes valid levels', ok);
}

function testNormalizeAutonomyRejectsJunk() {
  let threw = false;
  try { normalizeAutonomy('yolo'); } catch { threw = true; }
  record('mission.autonomy.rejects-junk', 'normalizeAutonomy rejects unknown autonomy levels', threw);
}

function testPlanProducesStandardPhases() {
  const plan = planMission('add input validation');
  const ok = plan.tasks.length === 3
    && plan.tasks[0].id === 'recon'
    && plan.tasks[1].id === 'implement'
    && plan.tasks[2].id === 'verify';
  record('mission.plan.standard-phases', 'Plan produces recon -> implement -> verify by default', ok, `tasks=${plan.tasks.map((t) => t.id).join(',')}`);
}

function testPlanAddsHardenAndDocument() {
  const plan = planMission('secure the endpoint', { harden: true, document: true });
  const ok = plan.tasks.map((t) => t.id).join(',') === 'recon,implement,verify,harden,document';
  record('mission.plan.harden-document', 'Plan appends harden and document phases when requested', ok, `tasks=${plan.tasks.map((t) => t.id).join(',')}`);
}

function testPlanWiresDependencies() {
  const plan = planMission('wire deps', { harden: true, document: true });
  // implement depends on recon; verify depends on implement; harden on verify;
  // document on harden (because harden is set).
  const byId = Object.fromEntries(plan.tasks.map((t) => [t.id, t]));
  const ok = byId.implement.dependsOn.includes('recon')
    && byId.verify.dependsOn.includes('implement')
    && byId.harden.dependsOn.includes('verify')
    && byId.document.dependsOn.includes('harden');
  record('mission.plan.dependencies', 'Plan wires sequential dependencies between phases', ok);
}

function testPlanRejectsEmptyGoal() {
  let threw = false;
  try { planMission('   '); } catch { threw = true; }
  record('mission.plan.empty-goal', 'Plan rejects an empty/whitespace goal', threw);
}

function testPlanIncludesGoalInPrompts() {
  const plan = planMission('unique-marker-98765');
  const ok = plan.tasks.every((t) => t.prompt.includes('unique-marker-98765'));
  record('mission.plan.goal-injected', 'Every phase prompt contains the original goal text', ok);
}

// ---------------------------------------------------------------------------
// Adapter resolution.
// ---------------------------------------------------------------------------

function testResolveAdapterAcceptsExplicit() {
  // 'local' is always registered.
  const ok = resolveMissionAdapter('local') === 'local';
  record('mission.adapter.explicit', 'resolveMissionAdapter accepts an explicit known adapter', ok);
}

function testResolveAdapterRejectsUnknown() {
  let threw = false;
  try { resolveMissionAdapter('definitely-not-a-real-adapter'); } catch { threw = true; }
  record('mission.adapter.rejects-unknown', 'resolveMissionAdapter rejects unknown adapter ids', threw);
}

// ---------------------------------------------------------------------------
// Run behavior: dry-run default, readonly forces dry-run, mission persists.
// ---------------------------------------------------------------------------

async function testRunMissionDryRunSucceeds() {
  const cwd = mkdtempSync(join(tmpdir(), 'lehro-bench-mission-'));
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Bench fixture\n', 'utf8');
    const report = await runMission('bench mission dry-run', { cwd: cwd, id: 'bench-dryrun-' + Date.now() });
    const ok = report.status === 'succeeded'
      && report.dryRun === true
      && report.phases.length === 3
      && report.phases.every((p) => p.verdict === 'stop-success');
    record('mission.run.dry-run-succeeds', 'Dry-run mission completes all phases with stop-success verdict', ok, `status=${report.status} dryRun=${report.dryRun} phases=${report.phases.length}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function testRunMissionReadonlyForcesDryRun() {
  const cwd = mkdtempSync(join(tmpdir(), 'lehro-bench-mission-'));
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Bench fixture\n', 'utf8');
    // Pass autonomy=readonly AND dryRun=false AND adapter=local — readonly
    // must win, so dryRun must be true.
    const report = await runMission('bench mission readonly', { cwd: cwd, autonomy: 'readonly', dryRun: false, adapter: 'local', id: 'bench-readonly-' + Date.now() });
    const ok = report.dryRun === true && report.autonomy === 'readonly' && report.status === 'succeeded';
    record('mission.run.readonly-forces-dryrun', 'Readonly autonomy forces dry-run even when caller asks for live', ok, `dryRun=${report.dryRun} autonomy=${report.autonomy}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function testRunMissionPersistsToRegistry() {
  const cwd = mkdtempSync(join(tmpdir(), 'lehro-bench-mission-'));
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Bench fixture\n', 'utf8');
    const report = await runMission('bench mission persist', { cwd: cwd, id: 'bench-persist-' + Date.now() });
    const stored = loadRun(report.id);
    const ok = stored
      && stored.kind === 'mission'
      && stored.status === 'succeeded'
      && Array.isArray(stored.events)
      && stored.events.some((e) => e.type === 'mission-started')
      && stored.events.some((e) => e.type === 'mission-finished')
      && listRuns({ limit: 200 }).some((r) => r.id === report.id);
    record('mission.run.persists', 'Mission result is persisted to the run registry with start + finish events', ok, stored ? `events=${stored.events.length}` : 'not stored');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function testRunMissionCapturesHardenPhase() {
  const cwd = mkdtempSync(join(tmpdir(), 'lehro-bench-mission-'));
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Bench fixture\n', 'utf8');
    const report = await runMission('bench mission harden', { cwd: cwd, harden: true, id: 'bench-harden-' + Date.now() });
    const ok = report.phases.length === 4 && report.phases.some((p) => p.phase === 'harden' && p.verdict === 'stop-success');
    record('mission.run.harden-included', 'Mission with --harden runs the additional harden phase', ok, `phases=${report.phases.map((p) => p.phase).join(',')}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function testRunMissionIncludesRecoveryField() {
  // The recovery field is always present in the report shape, even if empty
  // (since dry-runs pass first try).
  const cwd = mkdtempSync(join(tmpdir(), 'lehro-bench-mission-'));
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Bench fixture\n', 'utf8');
    const report = await runMission('bench mission recovery shape', { cwd: cwd, id: 'bench-recovery-' + Date.now() });
    const ok = Array.isArray(report.recoveries);
    record('mission.run.recovery-field', 'Mission report always carries a recoveries array (recovery ladder surface)', ok, `recoveries=${report.recoveries.length}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function testRunMissionGoalPropagatesToPhases() {
  const cwd = mkdtempSync(join(tmpdir(), 'lehro-bench-mission-'));
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Bench fixture\n', 'utf8');
    const marker = 'goal-marker-' + Date.now();
    const report = await runMission(marker, { cwd: cwd, id: 'bench-goal-' + Date.now() });
    // Phases carry sessionIds; the session row should mention the goal via
    // the run registry, which echoes the goal at the mission level.
    const ok = report.goal === marker;
    record('mission.run.goal-propagates', 'Mission report echoes the original goal verbatim', ok, `goal=${report.goal}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Public entry.
// ---------------------------------------------------------------------------

export async function runMissionBench() {
  RESULTS.length = 0;
  // Synchronous tests first.
  testAutonomyLevelsExposed();
  testNormalizeAutonomyAcceptsValidLevels();
  testNormalizeAutonomyRejectsJunk();
  testPlanProducesStandardPhases();
  testPlanAddsHardenAndDocument();
  testPlanWiresDependencies();
  testPlanRejectsEmptyGoal();
  testPlanIncludesGoalInPrompts();
  testResolveAdapterAcceptsExplicit();
  testResolveAdapterRejectsUnknown();
  // Async tests.
  await testRunMissionDryRunSucceeds();
  await testRunMissionReadonlyForcesDryRun();
  await testRunMissionPersistsToRegistry();
  await testRunMissionCapturesHardenPhase();
  await testRunMissionIncludesRecoveryField();
  await testRunMissionGoalPropagatesToPhases();

  const adjusted = RESULTS.map((r) => ({ ...r, adjustedScore: r.passed ? r.score * correctionFor(r.id) : r.score }));
  const totalPoints = adjusted.reduce((sum, r) => sum + r.adjustedScore, 0);
  const maxPoints = adjusted.length * 100;
  const score = Math.round((totalPoints / maxPoints) * 100);
  const passed = adjusted.filter((r) => r.passed).length;
  return {
    layer: 'mission',
    score: score,
    passed: passed,
    failed: adjusted.length - passed,
    total: adjusted.length,
    results: adjusted,
    generatedAt: new Date().toISOString(),
  };
}
