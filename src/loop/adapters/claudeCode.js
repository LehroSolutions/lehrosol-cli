// Claude Code non-interactive ("headless") mode: `claude --print --output-format json "<prompt>"`.
// See https://code.claude.com/docs (CLI reference / headless mode).
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'claude-code',
  label: 'Claude Code',
  bin: 'claude',
  install: 'npm install -g @anthropic-ai/claude-code',
  headless: 'claude --print --output-format json "<prompt>"',
  docs: 'https://code.claude.com/docs',
  buildArgs: (context) => ['--print', '--output-format', 'json', context.prompt]
});

export const meta = adapter.meta;
export const run = adapter.run;
