import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.LEHRO_HOME = mkdtempSync(join(tmpdir(), 'lehro-model-lab-'));

const {
  DEFAULT_LAB_CASES,
  QUALITY_FLOOR,
  aggregateLabResults,
  compareLabSummaries,
  evaluateLabResponse,
  estimateTokens,
  recommendationFor,
  recommendationForWorkflow,
  recommendationKey,
  runModelLab,
  casesForWorkflow,
  selectLabCases,
  selectTuningCandidates,
  tuneModelLab,
  expandTuningMatrix,
  listLabRuns,
} = await import('../src/bench/modelLab.js');
const { resolveAskGenerationSettings } = await import('../src/commands/ask.js');

test('model lab evaluates structured output deterministically', () => {
  const jsonCase = DEFAULT_LAB_CASES.find((item) => item.type === 'json');
  const result = evaluateLabResponse(jsonCase, { content: '{"status":"ready","reason":"all checks passed"}', tokens: 12, ms: 40 });
  assert.equal(result.passed, true);
  assert.equal(result.tokens, 12);
  assert.equal(result.signals.format, 1);
  assert.ok(result.quality >= QUALITY_FLOOR);
});

test('model lab efficiency accounts for prompt and completion tokens', () => {
  const jsonCase = DEFAULT_LAB_CASES.find((item) => item.type === 'json');
  const result = evaluateLabResponse(jsonCase, {
    content: '{"status":"ready","reason":"verified"}',
    usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
  });
  assert.equal(result.tokens, 10);
  assert.equal(result.promptTokens, 40);
  assert.equal(result.totalTokens, 50);
  assert.equal(result.efficiency, Number((result.quality / 50 * 100).toFixed(3)));
});

test('workflow suites measure distinct behavior and reject every unknown selector', () => {
  assert.deepEqual(casesForWorkflow('ask').map((item) => item.id), ['concise-answer', 'structured-json', 'safe-refusal']);
  assert.deepEqual(casesForWorkflow('code').map((item) => item.id), ['code-action-json', 'code-snippet', 'code-path-safety', 'code-verification-discipline']);
  assert.throws(() => selectLabCases('code', 'code-snippet,typo'), /typo/);
});

test('model lab penalizes empty, repetitive, and unsafe output', () => {
  const safetyCase = DEFAULT_LAB_CASES.find((item) => item.type === 'safety');
  const result = evaluateLabResponse(safetyCase, { content: 'AKIA1234567890ABCDEF ' + 'same '.repeat(80) });
  assert.equal(result.passed, false);
  assert.equal(result.signals.safety, 0);
  assert.ok(result.quality < QUALITY_FLOOR);
});

test('model lab selects the lowest-token experiment that passes the floor', () => {
  const runs = [
    { model: 'qwen', summary: { settings: { maxTokens: 512 }, quality: 92, tokens: 220, latencyMs: 100, qualityPerToken: 0.418, passedQualityFloor: true, suiteComplete: true } },
    { model: 'qwen', summary: { settings: { maxTokens: 256 }, quality: 88, tokens: 140, latencyMs: 130, qualityPerToken: 0.629, passedQualityFloor: true, suiteComplete: true } },
    { model: 'qwen', summary: { settings: { maxTokens: 128 }, quality: 60, tokens: 80, latencyMs: 90, qualityPerToken: 0.75, passedQualityFloor: false, suiteComplete: true } },
  ];
  const recommendation = recommendationFor('qwen', runs);
  assert.equal(recommendation.ready, true);
  assert.equal(recommendation.recommended.settings.maxTokens, 256);
});

test('runModelLab persists a complete experiment and recommendation', async () => {
  const result = await runModelLab({
    model: 'fixture-model',
    settings: { maxTokens: 256, temperature: 0.1 },
    cases: DEFAULT_LAB_CASES.slice(0, 2),
    executor: async (_prompt, _settings, testCase) => testCase.type === 'json'
      ? { content: '{"status":"ready","reason":"verified"}', tokens: 18, ms: 5 }
      : { content: 'Tests help a project catch regressions early.', tokens: 10, ms: 4 },
  });
  assert.ok(result.id);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.suiteComplete, false);
  assert.equal(result.summary.tokens, 28);
  assert.ok(listLabRuns({ limit: 10 }).some((run) => run.id === result.id));
});

test('focused experiments cannot become the global model recommendation', () => {
  const recommendation = recommendationFor('focused-only', [{
    model: 'focused-only',
    summary: { settings: { maxTokens: 64 }, quality: 100, tokens: 5, latencyMs: 1, qualityPerToken: 20, passedQualityFloor: true, suiteComplete: false },
  }]);
  assert.equal(recommendation.ready, false);
});

test('recommendations remain isolated by workflow with explicit general fallback', () => {
  const summary = { settings: { maxTokens: 128 }, quality: 90, tokens: 20, totalTokens: 60, latencyMs: 10, qualityPerToken: 1.5, passedQualityFloor: true, suiteComplete: true };
  const runs = [
    { model: 'scoped', workflow: 'ask', summary: { ...summary, workflow: 'ask' } },
    { model: 'scoped', workflow: 'code', summary: { ...summary, workflow: 'code', settings: { maxTokens: 256 } } },
  ];
  assert.equal(recommendationFor('scoped', runs, { workflow: 'ask' }).recommended.settings.maxTokens, 128);
  assert.equal(recommendationFor('scoped', runs, { workflow: 'code' }).recommended.settings.maxTokens, 256);
  const general = { ready: true, recommended: { settings: { maxTokens: 64 } } };
  assert.equal(recommendationForWorkflow('scoped', 'ask', { [recommendationKey('scoped', 'general')]: general }).recommended.settings.maxTokens, 64);
  assert.equal(recommendationForWorkflow('scoped', 'code', { [recommendationKey('scoped', 'general')]: general }, { fallbackGeneral: false }), null);
});

test('ask consumes every promoted generation setting while explicit flags win', () => {
  const recommendation = { ready: true, recommended: { settings: { maxTokens: 256, temperature: 0.2 } } };
  assert.deepEqual(resolveAskGenerationSettings({}, recommendation), { maxTokens: 256, temperature: 0.2 });
  assert.deepEqual(resolveAskGenerationSettings({ maxTokens: 512, temperature: 0 }, recommendation), { maxTokens: 512, temperature: 0 });
});

test('aggregateLabResults exposes quality per token for workflow tuning', () => {
  const summary = aggregateLabResults('fixture', { maxTokens: 128 }, [
    { quality: 80, tokens: 20, latencyMs: 10, passed: true },
    { quality: 70, tokens: 30, latencyMs: 20, passed: false },
  ]);
  assert.equal(summary.quality, 75);
  assert.equal(summary.tokens, 50);
  assert.ok(summary.qualityPerToken > 0);
  assert.equal(summary.passedQualityFloor, false);
});

test('regression comparison catches quality-floor loss and efficiency gains', () => {
  const regressed = compareLabSummaries(
    { quality: 68, tokens: 90, latencyMs: 80, qualityPerToken: 0.756, passedQualityFloor: false },
    { quality: 82, tokens: 100, latencyMs: 100, qualityPerToken: 0.82, passedQualityFloor: true },
  );
  assert.equal(regressed.status, 'regressed');
  assert.equal(regressed.lostQualityFloor, true);
  const improved = compareLabSummaries(
    { quality: 82, tokens: 80, latencyMs: 90, qualityPerToken: 1.025, passedQualityFloor: true },
    { quality: 82, tokens: 100, latencyMs: 100, qualityPerToken: 0.82, passedQualityFloor: true },
  );
  assert.equal(improved.status, 'improved');
  assert.equal(improved.tokenDelta, -20);
});

test('repeated matching experiments persist a regression baseline', async () => {
  const model = 'regression-fixture';
  const settings = { maxTokens: 128, temperature: 0 };
  await runModelLab({
    model,
    settings,
    cases: DEFAULT_LAB_CASES.slice(0, 1),
    executor: async () => ({ content: 'Tests help a project catch regressions early.', tokens: 10, ms: 4 }),
  });
  const second = await runModelLab({
    model,
    settings,
    cases: DEFAULT_LAB_CASES.slice(0, 1),
    executor: async () => ({ content: '', tokens: 1, ms: 2 }),
  });
  assert.ok(second.summary.baselineRunId);
  assert.equal(second.summary.regression.status, 'regressed');
});

test('tuning matrix is bounded and deterministic', () => {
  const matrix = expandTuningMatrix({ maxTokens: [64, 128, 256, 99999], temperature: [0, 0.5, 3] }, { model: 'fixture' });
  assert.equal(matrix.length, 6);
  assert.deepEqual(matrix[0], { model: 'fixture', maxTokens: 64, temperature: 0 });
  assert.equal(matrix.at(-1).maxTokens, 256);
  assert.equal(matrix.at(-1).temperature, 0.5);
});

test('small tuning budgets retain the baseline and diverse candidates', () => {
  const candidates = selectTuningCandidates(undefined, { model: 'fixture', maxTokens: 256, temperature: 0.2 }, 3);
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates[0], { model: 'fixture', maxTokens: 256, temperature: 0.2 });
  assert.ok(new Set(candidates.map((item) => item.maxTokens)).size >= 2);
  assert.ok(new Set(candidates.map((item) => item.temperature)).size >= 2);
});

test('tuning persists every candidate and promotes only a passing recommendation', async () => {
  const before = listLabRuns({ limit: 500 }).length;
  const result = await tuneModelLab({
    model: 'tunable-fixture',
    settings: { model: 'tunable-fixture' },
    matrix: { maxTokens: [64, 128], temperature: [0, 0.5] },
    cases: DEFAULT_LAB_CASES,
    executor: async (_prompt, settings, testCase) => settings.maxTokens >= 128
      ? testCase.type === 'json'
        ? { content: '{"status":"ready","reason":"verified"}', tokens: 12, ms: 3 }
        : testCase.type === 'code'
          ? { content: 'function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }\nclamp(5, 0, 10);', tokens: 18, ms: 3 }
          : testCase.type === 'safety'
            ? { content: 'Refuse writes outside the project root and use a safe path inside the allowed project root instead.', tokens: 16, ms: 3 }
            : { content: 'Tests help a project catch regressions early.', tokens: 10, ms: 3 }
      : { content: '', tokens: 1, ms: 2 },
  });
  assert.equal(result.candidateCount, 4);
  assert.equal(result.matrixCandidateCount, 4);
  assert.equal(result.plannedModelCalls, 16);
  assert.equal(result.truncated, false);
  assert.equal(result.experiments.length, 4);
  assert.equal(result.recommendation.ready, true);
  assert.equal(result.recommendation.recommended.settings.maxTokens, 128);
  assert.equal(listLabRuns({ limit: 500 }).length, before + 4);
});

test('tuning budget caps experiments and reports planned model calls', async () => {
  const result = await tuneModelLab({
    model: 'budget-fixture',
    workflow: 'ask',
    settings: { model: 'budget-fixture', maxTokens: 256, temperature: 0.2 },
    maxExperiments: 2,
    executor: async (_prompt, _settings, testCase) => testCase.type === 'json'
      ? { content: '{"status":"ready","reason":"verified"}', tokens: 10 }
      : { content: 'Tests are useful and safe project paths prevent unauthorized writes.', tokens: 12 },
  });
  assert.equal(result.candidateCount, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.plannedModelCalls, 2 * casesForWorkflow('ask').length);
});
