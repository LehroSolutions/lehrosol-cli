// vLLM — local/self-hosted OpenAI-compatible server.
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'vllm',
  label: 'vLLM / OpenAI-compatible local',
  baseUrl: process.env.LEHRO_VLLM_URL || 'http://localhost:8000/v1',
  model: process.env.LEHRO_VLLM_MODEL || 'local-model',
  resolveModel: () => process.env.LEHRO_VLLM_MODEL || 'local-model',
  local: true,
  docs: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
});

export const meta = adapter.meta;
export const run = adapter.run;
