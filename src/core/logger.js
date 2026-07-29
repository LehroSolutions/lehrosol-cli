// Minimal dependency-free logger with --json / --quiet / --no-color awareness.
// ANSI codes are built from character codes at runtime (not embedded as raw
// escape bytes in this source file) to keep the file plain-text safe.
const ESC = String.fromCharCode(27);
const CODES = { reset: `${ESC}[0m`, dim: `${ESC}[2m`, red: `${ESC}[31m`, green: `${ESC}[32m`, yellow: `${ESC}[33m`, cyan: `${ESC}[36m` };

export function createLogger(flags = {}) {
  const useColor = !flags.noColor && process.stdout.isTTY;
  const paint = (code, text) => (useColor ? `${CODES[code]}${text}${CODES.reset}` : text);
  return {
    info: (msg) => { if (!flags.quiet) console.log(msg); },
    success: (msg) => { if (!flags.quiet) console.log(paint('green', `OK  ${msg}`)); },
    warn: (msg) => console.error(paint('yellow', `!!  ${msg}`)),
    error: (msg) => console.error(paint('red', `ERR ${msg}`)),
    dim: (msg) => { if (!flags.quiet) console.log(paint('dim', msg)); },
    json: (obj) => console.log(JSON.stringify(obj, null, 2)),
  };
}
