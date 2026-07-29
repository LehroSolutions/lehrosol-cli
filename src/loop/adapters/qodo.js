// Qodo Command (qodo) — open-source agentic CLI from Qodo.
// Non-interactive: `qodo --ci -p "<prompt>"`.
// See https://docs.qodo.ai/qodo-documentation/qodo-command
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'qodo',
  label: 'Qodo Command',
  bin: 'qodo',
  docs: 'https://docs.qodo.ai/qodo-documentation/qodo-command',
  buildArgs: (context) => ['--ci', '-p', context.prompt],
});

export const meta = adapter.meta;
export const run = adapter.run;
