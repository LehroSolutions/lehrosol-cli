// xAI Grok — OpenAI-compatible endpoint with tool calling.
// Requires XAI_API_KEY. Override with env:
//   LEHRO_GROK_URL   (default https://api.x.ai/v1)
//   LEHRO_GROK_MODEL (default grok-4.5)
// See https://docs.x.ai and https://x.ai/api
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'grok',
  label: 'xAI Grok',
  baseUrl: process.env.LEHRO_GROK_URL || 'https://api.x.ai/v1',
  model: process.env.LEHRO_GROK_MODEL || 'grok-4.5',
  resolveModel: () => process.env.LEHRO_GROK_MODEL || 'grok-4.5',
  apiKeyEnv: 'XAI_API_KEY',
  docs: 'https://docs.x.ai',
});

export const meta = adapter.meta;
export const run = adapter.run;
