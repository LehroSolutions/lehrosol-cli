// Hermes Agent non-interactive send mode: `hermes send "<prompt>"`.
// Best-effort invocation; Hermes Agent's CLI surface is less standardized, so
// this adapter degrades gracefully via unavailableResult if `hermes` is not on PATH.
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'hermes-agent',
  label: 'Hermes Agent',
  bin: 'hermes',
  docs: null,
  buildArgs: (context) => ['send', context.prompt]
});

export const meta = adapter.meta;
export const run = adapter.run;
