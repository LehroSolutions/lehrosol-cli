// Qoder CLI (qodercli) — Qoder's terminal-native AI coding agent.
// Install: npm install -g @qoder-ai/qodercli
// Authenticate once with `qodercli` then `/login`, or configure credentials for CI.
// Headless mode: `qodercli -p "<prompt>"`.
// See https://docs.qoder.com/en/cli/quick-start and /subagent
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'qoder',
  label: 'Qoder CLI',
  bin: 'qodercli',
  docs: 'https://docs.qoder.com/en/cli/quick-start',
  install: 'npm install -g @qoder-ai/qodercli',
  headless: 'qodercli -p "<prompt>"',
  buildArgs: (context) => ['-p', context.prompt],
});

export const meta = adapter.meta;
export const run = adapter.run;
