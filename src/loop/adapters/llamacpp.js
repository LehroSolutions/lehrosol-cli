// llama.cpp (llama-server) — local OpenAI-compatible endpoint. Resolution
// order: LEHRO_LLAMACPP_URL env → a running `lehrosol serve`/`lehrosol up`
// engine (~/.lehro/serve.json, so `lehrosol up` + `loop run` just work with no
// env setup) → default http://localhost:8080/v1. Start the server with
// `lehrosol vault serve --model <name>` (passes --jinja so OpenAI-style tool
// calling works), or run llama-server yourself.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHttpAdapter } from './makeHttpAdapter.js';

function servedLlamacppBaseUrl() {
  try {
    const state = JSON.parse(readFileSync(join(homedir(), '.lehro', 'serve.json'), 'utf8'));
    if (state && state.engine === 'llamacpp' && state.baseUrl && state.pid) {
      return state.baseUrl;
    }
  } catch { /* no serve state — fall through */ }
  return null;
}

const adapter = createHttpAdapter({
  id: 'llamacpp',
  label: 'llama.cpp (local)',
  baseUrl: process.env.LEHRO_LLAMACPP_URL || servedLlamacppBaseUrl() || 'http://localhost:8080/v1',
  model: process.env.LEHRO_LLAMACPP_MODEL || 'local-model',
  resolveModel: () => process.env.LEHRO_LLAMACPP_MODEL || 'local-model',
  local: true,
  docs: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server',
});

export const meta = adapter.meta;
export const run = adapter.run;
