// Ollama — run any local open-source model (Llama, Qwen, DeepSeek, Mistral,
// Gemma…) through its OpenAI-compatible endpoint with full tool calling.
// No API key required; just `ollama serve`. Override with env:
//   LEHRO_OLLAMA_URL   (default http://localhost:11434/v1)
//   LEHRO_OLLAMA_MODEL (default qwen2.5-coder:7b)
// See https://ollama.com
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'ollama',
  label: 'Ollama (local)',
  baseUrl: process.env.LEHRO_OLLAMA_URL || 'http://localhost:11434/v1',
  model: process.env.LEHRO_OLLAMA_MODEL || 'qwen2.5-coder:7b',
  resolveModel: () => process.env.LEHRO_OLLAMA_MODEL || 'qwen2.5-coder:7b',
  local: true,
  docs: 'https://ollama.com',
});

export const meta = adapter.meta;
export const run = adapter.run;
