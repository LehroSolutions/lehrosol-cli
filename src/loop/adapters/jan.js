// Jan (jan.ai) — local OpenAI-compatible model server started via `jan serve`
// (default: http://localhost:6767/v1). Lets LehroSol act as the agentic
// harness while Jan supplies the local model backend (LlamaCPP / MLX).
//
//   jan serve jan-code-4b --detach        # expose model at localhost:6767/v1
//   lehrosol config set --adapter jan --model jan-code-4b
//   lehrosol loop run --agentAdapter jan
//
// If `jan serve` was started with --api-key, export it as OPENAI_API_KEY (the
// HTTP factory falls back to that env var) or set it via:
//   lehrosol config set --adapter jan --apiKey <key>
import { createHttpAdapter } from './makeHttpAdapter.js';

const adapter = createHttpAdapter({
  id: 'jan',
  label: 'Jan (local)',
  baseUrl: process.env.LEHRO_JAN_URL || 'http://localhost:6767/v1',
  model: process.env.LEHRO_JAN_MODEL || 'jan-model',
  resolveModel: () => process.env.LEHRO_JAN_MODEL || 'jan-model',
  local: true,
  docs: 'https://www.jan.ai/docs/desktop/cli',
});

export const meta = adapter.meta;
export const run = adapter.run;
