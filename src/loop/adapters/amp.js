// Amp (Sourcegraph) — agentic coding CLI. Non-interactive: `amp -x "<prompt>"`.
// See https://ampcode.com
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'amp',
  label: 'Amp (Sourcegraph)',
  bin: 'amp',
  docs: 'https://ampcode.com',
  buildArgs: (context) => ['-x', context.prompt],
});

export const meta = adapter.meta;
export const run = adapter.run;
