// Interactive input helpers for the HELIX cockpit. Kept separate from anim.js
// so the motion engine stays focused on rendering. Both degrade safely when
// there is no interactive TTY (return empty / resolve immediately).
import { startKeyReader, isTTY } from './anim.js';

// Resolve on the next keypress. Used to "press any key to continue" after an
// action runs in the normal screen buffer, before returning to the cockpit.
export function waitForKey(message) {
  return new Promise((resolve) => {
    if (!isTTY()) { resolve('enter'); return; }
    if (message) process.stdout.write('\n' + message);
    const stop = startKeyReader((key) => {
      stop();
      process.stdout.write('\n');
      resolve(key);
    });
  });
}

// Cooked-mode single-line input (with normal editing). The caller must ensure
// the raw-mode key reader is stopped before calling this.
export async function readLineInput(promptText) {
  if (!isTTY()) return '';
  const readline = await import('node:readline/promises');
  const iface = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await iface.question(promptText || '');
    return String(answer == null ? '' : answer);
  } catch {
    return '';
  } finally {
    iface.close();
  }
}

export default { waitForKey, readLineInput };
