// llama.cpp (llama-server) — local OpenAI-compatible endpoint (default port
// 8080). Start it with `lehrosol serve start --engine llamacpp --model <gguf>`
// (which passes --jinja so OpenAI-style tool calling works), or run
// llama-server yourself and point this adapter at it.
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'llamacpp',
  label: 'llama.cpp (local)',
  baseUrl: process.env.LEHRO_LLAMACPP_URL || 'http://localhost:8080/v1',
  model: process.env.LEHRO_LLAMACPP_MODEL || 'local-model',
  resolveModel: () => process.env.LEHRO_LLAMACPP_MODEL || 'local-model',
  local: true,
  docs: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server',
});

export const meta = adapter.meta;
export const run = adapter.run;
