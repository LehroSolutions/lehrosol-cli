// LM Studio — local OpenAI-compatible model server.
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'lmstudio',
  label: 'LM Studio (local)',
  baseUrl: process.env.LEHRO_LMSTUDIO_URL || 'http://localhost:1234/v1',
  model: process.env.LEHRO_LMSTUDIO_MODEL || 'local-model',
  resolveModel: () => process.env.LEHRO_LMSTUDIO_MODEL || 'local-model',
  local: true,
  docs: 'https://lmstudio.ai/docs/app/api/endpoints/openai',
});

export const meta = adapter.meta;
export const run = adapter.run;
