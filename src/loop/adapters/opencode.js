// OpenCode CLI non-interactive run mode: `opencode run "<prompt>"`.
// See https://opencode.ai/docs/cli (non-interactive `run` command).
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'opencode',
  label: 'OpenCode',
  bin: 'opencode',
  docs: 'https://opencode.ai/docs/cli',
  install: 'npm install -g opencode-ai',
  headless: 'opencode run "<prompt>"',
  buildArgs: (context) => ['run', context.prompt]
});

export const meta = adapter.meta;
export const run = adapter.run;
