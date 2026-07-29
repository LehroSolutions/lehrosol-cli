// Aider non-interactive mode: `aider --message "<prompt>" --yes-always`.
// See https://aider.chat/docs/scripting.html (scripting / non-interactive usage).
import { createCliAdapter } from './makeCliAdapter.js';

const adapter = createCliAdapter({
  id: 'aider',
  label: 'Aider',
  bin: 'aider',
  docs: 'https://aider.chat/docs/scripting.html',
  buildArgs: (context) => ['--message', context.prompt, '--yes-always']
});

export const meta = adapter.meta;
export const run = adapter.run;
