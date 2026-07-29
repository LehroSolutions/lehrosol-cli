// LocalAI — self-hosted OpenAI-compatible server.
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'localai',
  label: 'LocalAI (local)',
  baseUrl: process.env.LEHRO_LOCALAI_URL || 'http://localhost:8080/v1',
  model: process.env.LEHRO_LOCALAI_MODEL || 'local-model',
  resolveModel: () => process.env.LEHRO_LOCALAI_MODEL || 'local-model',
  local: true,
  docs: 'https://localai.io/',
});

export const meta = adapter.meta;
export const run = adapter.run;
