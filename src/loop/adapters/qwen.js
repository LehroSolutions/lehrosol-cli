// Qwen Code (qwen) — open-source agentic CLI (Gemini-CLI fork) from Alibaba.
// Non-interactive/headless: `qwen -p "<prompt>"`.
// See https://github.com/QwenLM/qwen-code
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'qwen',
  label: 'Qwen Code',
  bin: 'qwen',
  docs: 'https://github.com/QwenLM/qwen-code',
  install: 'npm install -g @qwen-code/qwen-code@latest',
  headless: 'qwen -p "<prompt>"',
  buildArgs: (context) => ['-p', context.prompt],
});

export const meta = adapter.meta;
export const run = adapter.run;
