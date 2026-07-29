// Codex CLI non-interactive mode: `codex exec "<prompt>"`.
// See https://github.com/openai/codex (CLI reference: `codex exec`).
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'codex',
  label: 'Codex CLI',
  bin: 'codex',
  install: 'npm install -g @openai/codex',
  headless: 'codex exec "<prompt>"',
  docs: 'https://github.com/openai/codex',
  buildArgs: (context) => ['exec', context.prompt]
});

export const meta = adapter.meta;
export const run = adapter.run;
