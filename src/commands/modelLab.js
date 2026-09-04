import { chatOnce, ensureServing, DEFAULT_PORT, DEFAULT_KEY } from './quick.js';
import { ui } from '../core/ui.js';
import { DEFAULT_LAB_CASES, DEFAULT_TUNING_MATRIX, listLabRuns, loadRecommendations, recommendationFor, recommendationForWorkflow, runModelLab, selectLabCases, tuneModelLab } from '../bench/modelLab.js';

function emit(payload, flags, logger) {
  if (flags.json) {
    if (logger?.json) logger.json(payload); else console.log(JSON.stringify(payload, null, 2));
  }
  return payload;
}

async function executeAgainstLocal(prompt, settings, testCase, flags, logger) {
  const serving = await ensureServing({
    model: settings.model || flags.model,
    port: Number(flags.port || DEFAULT_PORT),
    apiKey: flags.apiKey || DEFAULT_KEY,
    restart: Boolean(flags.restart),
    showWarmup: false,
  }, { ...flags, json: true }, logger);
  if (!serving.ok) return { ok: false, text: '', error: serving.reason || 'engine-unavailable' };
  const result = await chatOnce({
    baseUrl: serving.baseUrl,
    apiKey: flags.apiKey || DEFAULT_KEY,
    prompt,
    system: settings.system || 'You are a concise, accurate engineering assistant.',
    maxTokens: Number(settings.maxTokens || flags.maxTokens || 256),
    temperature: settings.temperature,
    timeoutMs: Number(flags.timeout || 600000),
  });
  return result.ok ? result : { ...result, text: '' };
}

export async function runModelLabCommand(subcommand = 'run', flags = {}, logger = console) {
  const cmd = String(subcommand || 'run').toLowerCase();
  if (cmd === 'list' || cmd === 'history') {
    const runs = listLabRuns({ limit: Number(flags.limit || 20) });
    return emit({ runs: runs.map((run) => ({ id: run.id, createdAt: run.createdAt, model: run.model, summary: run.summary })) }, flags, logger);
  }
  if (cmd === 'recommend' || cmd === 'recommendations') {
    const model = String(flags.model || '').trim();
    const workflow = String(flags.workflow || 'general');
    const recommendations = loadRecommendations();
    const payload = model ? (recommendationForWorkflow(model, workflow, recommendations, { fallbackGeneral: false }) || recommendationFor(model, undefined, { workflow })) : recommendations;
    return emit(payload, flags, logger);
  }
  if (cmd === 'tune') {
    const model = String(flags.model || 'local').trim();
    const workflow = String(flags.workflow || 'general');
    const savedRecommendation = recommendationForWorkflow(model, workflow, loadRecommendations(), { fallbackGeneral: false });
    const recommendedSettings = savedRecommendation?.ready ? (savedRecommendation.recommended?.settings || {}) : {};
    const settings = {
      model,
      maxTokens: Number(flags.maxTokens || recommendedSettings.maxTokens || 256),
      temperature: flags.temperature != null ? Number(flags.temperature) : Number(recommendedSettings.temperature ?? 0.2),
    };
    let cases;
    try { cases = selectLabCases(workflow, flags.case); } catch (error) {
      ui.error(error.message);
      process.exitCode = 1;
      return null;
    }
    const result = await tuneModelLab({
      model,
      workflow,
      settings,
      matrix: DEFAULT_TUNING_MATRIX,
      maxExperiments: Number(flags.maxExperiments || 9),
      cases,
      executor: (prompt, experimentSettings, testCase) => executeAgainstLocal(prompt, experimentSettings, testCase, flags, logger),
    });
    if (!flags.json) {
      ui.sectionHeader(`Model Lab Tuning — ${model}`);
      ui.keyValue('Experiments', String(result.candidateCount));
      ui.keyValue('Planned calls', String(result.plannedModelCalls));
      ui.keyValue('Recommendation', result.recommendation.ready ? JSON.stringify(result.recommendation.recommended) : result.recommendation.reason);
    }
    return emit(result, flags, logger);
  }
  if (cmd !== 'run') {
    ui.error(`Unknown model-lab subcommand: ${cmd}`, 'Try: run | tune | history | recommend');
    process.exitCode = 1;
    return null;
  }

  const model = String(flags.model || 'local').trim();
  const workflow = String(flags.workflow || 'general');
  const savedRecommendation = recommendationForWorkflow(model, workflow, loadRecommendations(), { fallbackGeneral: false });
  const recommendedSettings = savedRecommendation?.ready ? (savedRecommendation.recommended?.settings || {}) : {};
  const settings = {
    model,
    maxTokens: Number(flags.maxTokens || recommendedSettings.maxTokens || 256),
    temperature: flags.temperature != null ? Number(flags.temperature) : Number(recommendedSettings.temperature ?? 0.2),
  };
  let cases;
  try { cases = selectLabCases(workflow, flags.case); } catch (error) {
    ui.error(error.message);
    process.exitCode = 1;
    return null;
  }
  const result = await runModelLab({
    model,
    workflow,
    settings,
    cases,
    executor: (prompt, experimentSettings, testCase) => executeAgainstLocal(prompt, experimentSettings, testCase, flags, logger),
  });
  if (!flags.json) {
    ui.sectionHeader(`Model Lab — ${model}`);
    ui.keyValue('Quality', `${result.summary.quality}/100`);
    ui.keyValue('Passed', `${result.summary.passed}/${result.summary.total}`);
    ui.keyValue('Tokens', `${result.summary.totalTokens} total (${result.summary.tokens} output)`);
    ui.keyValue('Quality/token', String(result.summary.qualityPerToken));
    if (result.summary.regression) ui.keyValue('Regression', `${result.summary.regression.status} (quality ${result.summary.regression.qualityDelta >= 0 ? '+' : ''}${result.summary.regression.qualityDelta})`);
    ui.keyValue('Recommendation', result.recommendation.ready ? JSON.stringify(result.recommendation.recommended) : result.recommendation.reason);
    ui.table(['Case', 'Quality', 'Tokens', 'Result'], result.summary.results.map((row) => [row.testId, String(row.quality), String(row.tokens), row.passed ? 'PASS' : 'FAIL']));
  }
  return emit(result, flags, logger);
}
