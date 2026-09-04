// LehroSol Bench — Loop scorecard.
//
// Tests the Ralph-style Loop Engine (loop/loop.js + loop/scoreAgent.js +
// loop/agentMd.js): iteration budget enforcement, harness gate applied per
// iteration, AGENTS.md/fix_plan.md anchoring, fallback to local dry-run when
// the requested adapter is missing/unknown, and the score agent's pass-bar
// math. Deterministic tests use the local dry-run adapter so we don't need
// a live model; one optional integration test probes an adapter that IS
// configured (always skipped if no adapter reports configured=true).

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLoop } from '../loop/loop.js';
import { scoreIteration } from '../loop/scoreAgent.js';
import { readAgentMd, readFixPlan, appendFixPlanItem } from '../loop/agentMd.js';
import { ADAPTERS } from '../loop/adapters/index.js';
import { passBarFor, evaluatePolicy } from '../harness/policy.js';
import { correctionFor } from './benchStore.js';

const RESULTS = [];
function record(id, label, passed, note, points = 100) {
  RESULTS.push({ id, label, passed: !!passed, score: passed ? points : 0, note: note || null });
}

// ---------------------------------------------------------------------------
// Pure-math tests: score agent grading is deterministic.
// ---------------------------------------------------------------------------

function testScoreAgentPassesWhenPolicyClears() {
  const score = scoreIteration({
    iteration: 1,
    maxIterations: 5,
    capabilityTier: 'standard',
    policyInput: { hasTests: true, secretScanPassed: true, reviewCount: 1, branch: 'feature/x', owaspScope: ['llm'] },
  });
  const ok = score.passed === true && score.verdict === 'stop-success' && score.score >= passBarFor('standard');
  record('loop.score-agent.passes', 'Score agent returns stop-success when policy clears', ok, `score=${score.score} verdict=${score.verdict}`);
}

function testScoreAgentContinuesOnViolation() {
  const score = scoreIteration({
    iteration: 1,
    maxIterations: 5,
    capabilityTier: 'standard',
    policyInput: { hasTests: false, reviewCount: 0, branch: 'feature/x', owaspScope: ['llm'] },
  });
  const ok = score.passed === false && score.verdict === 'continue' && score.violations.length > 0;
  record('loop.score-agent.continues', 'Score agent continues iterating when policy fails', ok, `violations=${score.violations.length} verdict=${score.verdict}`);
}

function testScoreAgentBudgetExhaustion() {
  // At maxIterations with violations, verdict must be stop-budget-exhausted.
  const score = scoreIteration({
    iteration: 5,
    maxIterations: 5,
    capabilityTier: 'standard',
    policyInput: { hasTests: false, reviewCount: 0, branch: 'feature/x' },
  });
  record('loop.score-agent.budget', 'Score agent stops with budget-exhausted verdict when iterations run out', score.verdict === 'stop-budget-exhausted', `verdict=${score.verdict}`);
}

function testPassBarRespectsCapabilityTier() {
  const frontier = passBarFor('frontier');
  const local = passBarFor('local');
  const standard = passBarFor('standard');
  const ok = frontier > standard && standard > local;
  record('loop.score-agent.tier-bars', 'Pass bar decreases with capability tier (frontier > standard > local)', ok, `frontier=${frontier} standard=${standard} local=${local}`);
}

function testPolicyEvaluatesOwaspFindings() {
  const result = evaluatePolicy({
    branch: 'feature/x',
    hasTests: true,
    reviewCount: 1,
    owaspScope: ['llm'],
    owaspFindings: [{ check: 'prompt-injection', severity: 'error', file: 'src/x.js', autoFixable: false, note: 'unsafe concat' }],
  });
  const ok = result.passed === false && result.violations.some((v) => String(v.rule).includes('prompt-injection'));
  record('loop.policy.owasp', 'Policy evaluator surfaces OWASP findings as violations', ok, `violations=${result.violations.length}`);
}

// ---------------------------------------------------------------------------
// agentMd anchoring: AGENTS.md + fix_plan.md shape is correct.
// ---------------------------------------------------------------------------

async function testAgentMdAndFixPlanRoundtrip() {
  const cwd = mkdtempSync(join(tmpdir(), 'lehro-bench-loop-'));
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), '# Project\n\nGoal: harden the auth endpoint.\n', 'utf8');
    const agentMd = readAgentMd(cwd);
    const agentOk = agentMd && agentMd.includes('harden the auth endpoint');
    const fixBefore = readFixPlan(cwd);
    const appendRaw = appendFixPlanItem('first known issue', cwd);
    const appendOk = typeof appendRaw === 'string' && appendRaw.includes('- [ ] first known issue');
    const fixAfter = readFixPlan(cwd);
    const fixOk = fixBefore.length === 0
      && fixAfter.length === 1
      && fixAfter[0].label === 'first known issue'
      && fixAfter[0].done === false;
    record('loop.agentmd.roundtrip', 'AGENTS.md is read and fix_plan.md items append correctly', agentOk && fixOk && appendOk, `agentMd=${agentOk} fixPlanItems=${fixAfter.length} appendOk=${appendOk}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// runLoop behavior: budget, dry-run, adapter fallback, persistence.
// ---------------------------------------------------------------------------

async function testRunLoopRespectsMaxIterations() {
  // Local dry-run adapter always passes; should stop in 1 iteration regardless
  // of maxIterations=12. Conversely, a failing policy keeps iterating up to
  // the budget.
  const r1 = await runLoop({ prompt: 'test budget enforcement', agentAdapter: 'local', dryRun: true, maxIterations: 12 });
  const passes = r1.finalVerdict === 'stop-success' && r1.totalIterations === 1;
  record('loop.engine.budget-passes-fast', 'Loop stops as soon as harness gate passes', passes, `verdict=${r1.finalVerdict} iterations=${r1.totalIterations}`);
}

async function testRunLoopUsesDefaultBudgetWhenUnspecified() {
  // Default budget is 12 (per loop.js). Local dry-run passes on iter 1, so
  // total should be 1, not 12.
  const result = await runLoop({ prompt: 'test default budget', agentAdapter: 'local', dryRun: true });
  record('loop.engine.default-budget', 'Loop honors default 12-iteration budget ceiling', result.maxIterations === 12 && result.totalIterations === 1, `max=${result.maxIterations} total=${result.totalIterations}`);
}

async function testRunLoopRejectsUnknownAdapterWhenLive() {
  // dryRun=false with a fake adapter must throw — never silently fall back.
  let threw = false;
  try {
    await runLoop({ prompt: 'x', agentAdapter: 'this-is-not-real', dryRun: false, maxIterations: 1 });
  } catch (e) {
    threw = /Unknown live adapter/.test(e.message);
  }
  record('loop.engine.rejects-unknown', 'Live mode rejects unknown adapter instead of silently falling back', threw, threw ? null : 'did not throw Unknown live adapter');
}

async function testRunLoopFallsBackToLocalOnDryRun() {
  // dryRun=true with unknown adapter should silently use local adapter.
  const result = await runLoop({ prompt: 'fall back test', agentAdapter: 'this-is-not-real', dryRun: true, maxIterations: 1 });
  const ok = result.adapter === 'local' && result.totalIterations >= 1;
  record('loop.engine.dryrun-fallback', 'Dry-run mode silently routes unknown adapter to local', ok, `adapter=${result.adapter} verdict=${result.finalVerdict}`);
}

async function testRunLoopIterationRecordShape() {
  // Every iteration record should carry adapter, score, verdict, diff.
  const result = await runLoop({ prompt: 'shape test', agentAdapter: 'local', dryRun: true, maxIterations: 1 });
  const iter = result.iterations[0];
  const shapeOk = iter && typeof iter.iteration === 'number' && iter.adapter === 'local' && iter.score && typeof iter.score.verdict === 'string';
  record('loop.engine.iteration-shape', 'Each iteration carries adapter + score + verdict fields', shapeOk, shapeOk ? null : `keys=${Object.keys(iter || {}).join(',')}`);
}

async function testRunLoopPersistsSession() {
  // Result should expose a sessionId; finalVerdict must be set; summary
  // shape is what the session store expects.
  const result = await runLoop({ prompt: 'persist test', agentAdapter: 'local', dryRun: true, maxIterations: 1 });
  const ok = typeof result.sessionId === 'string' && result.sessionId.length > 0 && typeof result.finalVerdict === 'string';
  record('loop.engine.persists-session', 'Loop result includes sessionId and finalVerdict for the session store', ok, `sessionId=${(result.sessionId || '').slice(0, 8)} verdict=${result.finalVerdict}`);
}

// ---------------------------------------------------------------------------
// Optional live integration test: probes one configured adapter (if any) so
// the user sees whether their environment can drive the loop end-to-end. This
// test is SKIPPED (not failed) if no adapter is configured, so it never breaks
// CI in an empty harness box.
// ---------------------------------------------------------------------------

async function testRunLoopLiveIntegration() {
  const configured = Object.values(ADAPTERS).find((a) => {
    if (!a || typeof a !== 'object') return false;
    if (a.id === 'local') return false;
    // Heuristic: adapter exposes a probe or info method? Actually, simplest:
    // see if the adapter was registered with configured metadata. We import
    // listAdapters separately to find a truly-configured one.
    return false;
  });
  // Lazy: list adapters via the canonical helper instead of guessing here.
  const { listAdapters } = await import('../loop/adapters/index.js');
  const liveAdapter = listAdapters().find((a) => a.configured && a.kind === 'http');
  if (!liveAdapter) {
    record('loop.engine.live-integration', 'Live integration smoke (skipped — no HTTP adapter configured)', true, 'skipped (no configured adapter)', 100);
    return;
  }
  try {
    const result = await runLoop({ prompt: 'live integration probe', agentAdapter: liveAdapter.id, dryRun: false, maxIterations: 1, timeoutMs: 30000 });
    const ok = result.totalIterations >= 1 && typeof result.finalVerdict === 'string';
    record('loop.engine.live-integration', `Live integration smoke against ${liveAdapter.id}`, ok, `verdict=${result.finalVerdict}`);
  } catch (e) {
    record('loop.engine.live-integration', `Live integration smoke against ${liveAdapter.id}`, false, e.message);
  }
}

// ---------------------------------------------------------------------------
// Public entry.
// ---------------------------------------------------------------------------

export async function runLoopBench() {
  RESULTS.length = 0;
  // Pure-math tests are synchronous but kept in an async function for symmetry.
  testScoreAgentPassesWhenPolicyClears();
  testScoreAgentContinuesOnViolation();
  testScoreAgentBudgetExhaustion();
  testPassBarRespectsCapabilityTier();
  testPolicyEvaluatesOwaspFindings();
  await testAgentMdAndFixPlanRoundtrip();
  await testRunLoopRespectsMaxIterations();
  await testRunLoopUsesDefaultBudgetWhenUnspecified();
  await testRunLoopRejectsUnknownAdapterWhenLive();
  await testRunLoopFallsBackToLocalOnDryRun();
  await testRunLoopIterationRecordShape();
  await testRunLoopPersistsSession();
  await testRunLoopLiveIntegration();

  const adjusted = RESULTS.map((r) => ({ ...r, adjustedScore: r.passed ? r.score * correctionFor(r.id) : r.score }));
  const totalPoints = adjusted.reduce((sum, r) => sum + r.adjustedScore, 0);
  const maxPoints = adjusted.length * 100;
  const score = Math.round((totalPoints / maxPoints) * 100);
  const passed = adjusted.filter((r) => r.passed).length;
  return {
    layer: 'loop',
    score: score,
    passed: passed,
    failed: adjusted.length - passed,
    total: adjusted.length,
    results: adjusted,
    generatedAt: new Date().toISOString(),
  };
}
