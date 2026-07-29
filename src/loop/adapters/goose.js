// Goose CLI one-off run mode: `goose run --text "<instruction>"`.
// See https://block.github.io/goose/docs/guides/goose-cli-commands (non-interactive run).
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'goose',
  label: 'Goose',
  bin: 'goose',
  docs: 'https://block.github.io/goose/docs/guides/goose-cli-commands',
  buildArgs: (context) => ['run', '--text', context.prompt]
});

export const meta = adapter.meta;
export const run = adapter.run;
