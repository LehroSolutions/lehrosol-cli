/** One-shot Q&A against the configured local engine. */
import { chatOnce, ensureServing, DEFAULT_PORT, DEFAULT_KEY } from './quick.js';
import { loadRecommendations, recommendationForWorkflow } from '../bench/modelLab.js';

export function resolveAskGenerationSettings(flags = {}, recommendation = null) {
  const recommended = recommendation?.ready ? (recommendation.recommended?.settings || {}) : {};
  return {
    maxTokens: Number(flags.maxTokens || recommended.maxTokens || 1024),
    temperature: flags.temperature != null ? Number(flags.temperature) : (recommended.temperature == null ? undefined : Number(recommended.temperature)),
  };
}

export async function runAskCommand(question, flags = {}, logger = console) {
  const prompt = String(question || '').trim();
  if (!prompt) {
    logger.error('Usage: lehrosol ask "<your question>"');
    process.exitCode = 1;
    return { ok: false, reason: 'missing-question' };
  }

  const port = Number(flags.port || DEFAULT_PORT);
  const apiKey = flags.apiKey || DEFAULT_KEY;
  const recommendation = recommendationForWorkflow(String(flags.model || 'local'), 'ask', loadRecommendations(), { fallbackGeneral: true });
  const generation = resolveAskGenerationSettings(flags, recommendation);
  const host = await ensureServing({
    model: flags.model,
    port,
    apiKey,
    restart: Boolean(flags.restart),
    showWarmup: !flags.json,
  }, flags, logger);

  if (!host || !host.ok) {
    const reason = host?.reason || 'engine-unavailable';
    if (!flags.json) logger.error(`ask: could not start or reach an engine (${reason})`);
    return { ok: false, reason };
  }

  const result = await chatOnce({
    baseUrl: host.baseUrl,
    apiKey,
    prompt,
    system: 'You are a helpful engineering assistant. Be concise and accurate.',
    maxTokens: generation.maxTokens,
    temperature: generation.temperature,
  });

  if (!result.ok) {
    if (!flags.json) logger.error(`ask: engine error — ${result.error}`);
    return { ok: false, error: result.error };
  }

  const payload = { ok: true, question: prompt, reply: result.content, ms: result.ms, tokensPerSec: result.tokPerSec };
  if (flags.json) {
    if (logger.json) logger.json(payload); else logger.log(JSON.stringify(payload));
  } else {
    logger.log(result.content);
    if (result.tokPerSec) logger.log(`\n  [${result.tokPerSec.toFixed(1)} tok/s]`);
  }
  return payload;
}
