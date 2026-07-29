// Cursor CLI (cursor-agent) headless mode: `cursor-agent -p "<prompt>"`.
// See https://docs.cursor.com/en/cli/overview
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'cursor',
  label: 'Cursor CLI',
  bin: 'cursor-agent',
  docs: 'https://docs.cursor.com/en/cli/overview',
  buildArgs: (context) => ['-p', '--output-format', 'text', context.prompt],
});

export const meta = adapter.meta;
export const run = adapter.run;
