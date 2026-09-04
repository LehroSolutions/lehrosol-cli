import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LEHRO_HOME = mkdtempSync(join(tmpdir(), 'lehro-mission-'));

const { planMission, runMission, normalizeAutonomy, listMissions, loadMission, AUTONOMY_LEVELS, resolveMissionAdapter, DEFAULT_MISSION_ITERATIONS, MAX_MISSION_ITERATIONS } = await import('../src/agentic/mission.js');
const { TOOL_DEFINITIONS, executeTool } = await import('../src/mcp/tools.js');
const { buildTuiSnapshot, quickActions } = await import('../src/commands/tui.js');

test('normalizeAutonomy accepts levels and rejects junk', () => {
  assert.deepEqual(AUTONOMY_LEVELS, ['readonly', 'guarded', 'full']);
  assert.equal(normalizeAutonomy(undefined), 'guarded');
  assert.equal(normalizeAutonomy('FULL'), 'full');
  assert.throws(() => normalizeAutonomy('yolo'), /Unknown autonomy level/);
});

test('missions expose a longer local-model iteration budget', () => {
  assert.equal(DEFAULT_MISSION_ITERATIONS, 8);
  assert.equal(MAX_MISSION_ITERATIONS, 48);
  assert.equal(TOOL_DEFINITIONS.mission_run.inputSchema.properties.maxIterations.default, 8);
  assert.equal(TOOL_DEFINITIONS.mission_run.inputSchema.properties.maxIterations.maximum, 48);
});

test('planMission produces a dependency-ordered phase graph', () => {
  const plan = planMission('add rate limiting', { harden: true, document: true });
  assert.match(plan.id, /^mission-/);
  assert.deepEqual(plan.tasks.map((t) => t.id), ['recon', 'implement', 'verify', 'harden', 'document']);
  assert.deepEqual(plan.tasks[1].dependsOn, ['recon']);
  assert.deepEqual(plan.tasks[4].dependsOn, ['harden']);
  assert.ok(plan.tasks.every((t) => t.prompt.includes('add rate limiting')));
  assert.throws(() => planMission('   '), /requires a --goal/);
});

test('runMission dry-run completes all phases and persists the mission', async () => {
  const report = await runMission('smoke the mission engine', { id: 'test1' });
  assert.equal(report.status, 'succeeded');
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.phases.map((p) => p.phase), ['recon', 'implement', 'verify']);
  assert.ok(report.phases.every((p) => p.verdict === 'stop-success' && p.sessionId));
  const stored = loadMission(report.id);
  assert.equal(stored.kind, 'mission');
  assert.equal(stored.status, 'succeeded');
  assert.ok(stored.events.some((e) => e.type === 'mission-started'));
  assert.ok(stored.events.some((e) => e.type === 'mission-finished'));
  assert.ok(listMissions().some((m) => m.id === report.id));
});

test('readonly autonomy can never go live', async () => {
  const report = await runMission('attempt live', { id: 'test2', autonomy: 'readonly', dryRun: false, adapter: 'grok' });
  assert.equal(report.dryRun, true, 'readonly must force dry-run even when dryRun=false is passed');
  assert.equal(report.status, 'succeeded');
});

test('resolveMissionAdapter validates explicit ids', () => {
  assert.equal(resolveMissionAdapter('grok'), 'grok');
  assert.throws(() => resolveMissionAdapter('not-a-real-adapter'), /Unknown adapter/);
});

test('MCP exposes mission tools and mission_plan executes', async () => {
  for (const name of ['mission_run', 'mission_plan', 'mission_list']) {
    assert.ok(TOOL_DEFINITIONS[name], `missing MCP tool ${name}`);
  }
  assert.equal(TOOL_DEFINITIONS.mission_run.inputSchema.required[0], 'goal');
  const plan = await executeTool('mission_plan', { goal: 'mcp mission plan' });
  assert.deepEqual(plan.tasks.map((t) => t.id), ['recon', 'implement', 'verify']);
  const listed = await executeTool('mission_list', {});
  assert.ok(Array.isArray(listed.missions));
});

test('TUI surfaces missions in snapshot and quick actions', () => {
  const snapshot = buildTuiSnapshot();
  assert.ok(Array.isArray(snapshot.missions));
  const actions = quickActions('basic');
  assert.equal(actions[0].key, 'mission', 'mission must be the first quick action in every tier');
  const advanced = quickActions('advanced');
  assert.ok(advanced.some((a) => a.key === 'mission'));
});
