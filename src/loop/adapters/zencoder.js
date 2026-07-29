// Zencoder CLI (zen) — agentic coding CLI from Zencoder.
// Non-interactive: `zen run "<prompt>"`.
// See https://zencoder.ai
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'zencoder',
  label: 'Zencoder CLI',
  bin: 'zen',
  docs: 'https://zencoder.ai',
  buildArgs: (context) => ['run', context.prompt],
});

export const meta = adapter.meta;
export const run = adapter.run;
