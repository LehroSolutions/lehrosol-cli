// Gemini CLI non-interactive mode: `gemini --prompt "<prompt>"`.
// See https://github.com/google-gemini/gemini-cli (non-interactive `--prompt` flag).
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'gemini-cli',
  label: 'Gemini CLI',
  bin: 'gemini',
  install: 'npm install -g @google/gemini-cli',
  headless: 'gemini --prompt "<prompt>"',
  docs: 'https://github.com/google-gemini/gemini-cli',
  buildArgs: (context) => ['--prompt', context.prompt]
});

export const meta = adapter.meta;
export const run = adapter.run;
