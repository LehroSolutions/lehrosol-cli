// LehroSol CLI — Motion & Interaction engine ("HELIX/Motion")
// -----------------------------------------------------------------------------
// Zero-dependency terminal motion primitives that power the immersive TUI:
// alt-screen management, cursor control, frame loops, keypress handling,
// typewriter/reveal effects, animated banners, spinners and shimmer.
//
// Everything is guarded by `motionEnabled()` so non-TTY / CI / piped contexts
// silently fall back to a single static paint (no escape spam in logs).

import { CSI, gradient, gradients, style, fg, palette, glyph, colorEnabled } from './theme.js';

const OUT = process.stdout;
const IN = process.stdin;

export function isTTY() { return Boolean(OUT && OUT.isTTY && IN && IN.isTTY); }
export function motionEnabled() {
  if (process.env.LEHRO_NO_ANIM || process.env.NO_ANIM) return false;
  if (process.env.CI) return false;
  return isTTY() && colorEnabled();
}

export function size() {
  return {
    cols: Math.max(60, Number(OUT.columns) || 100),
    rows: Math.max(20, Number(OUT.rows) || 30),
  };
}

// ---------------------------------------------------------------------------
// Raw terminal control
// ---------------------------------------------------------------------------
function w(s) { OUT.write(s); }
export const term = {
  hideCursor() { if (isTTY()) w(`${CSI}?25l`); },
  showCursor() { if (isTTY()) w(`${CSI}?25h`); },
  enterAlt() { if (isTTY()) w(`${CSI}?1049h`); },
  exitAlt() { if (isTTY()) w(`${CSI}?1049l`); },
  clear() { if (isTTY()) w(`${CSI}2J${CSI}H`); },
  home() { if (isTTY()) w(`${CSI}H`); },
  moveTo(row, col) { if (isTTY()) w(`${CSI}${row};${col}H`); },
  clearLine() { if (isTTY()) w(`${CSI}2K`); },
  clearBelow() { if (isTTY()) w(`${CSI}J`); },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

// Terminal "synchronized update" (DEC private mode 2026). Terminals that support
// it (Windows Terminal, iTerm2, Kitty, WezTerm, modern VTE, tmux>=3.4) buffer
// everything between BEGIN and END and swap the frame atomically — this is what
// eliminates flicker/tearing. Terminals that don't support it ignore these
// unknown private-mode sequences harmlessly. Opt out with LEHRO_NO_SYNC=1.
const SYNC_ON = process.env.LEHRO_NO_SYNC ? '' : `${CSI}?2026h`;
const SYNC_OFF = process.env.LEHRO_NO_SYNC ? '' : `${CSI}?2026l`;

// ---------------------------------------------------------------------------
// Frame painter — repaints an array of lines from the top-left of the screen
// with zero flicker:
//   1) the whole frame is wrapped in a synchronized-update block so the
//      terminal shows only the finished frame (never a half-drawn one);
//   2) each line is positioned with an absolute cursor move + clear-to-EOL
//      instead of a trailing "\n", so the bottom row never scrolls the screen
//      (scrolling was the primary source of flicker);
//   3) content is clamped to the visible rows and everything below the last
//      line is cleared once.
// ---------------------------------------------------------------------------
export function paintFrame(lines) {
  if (!isTTY()) { console.log(lines.join('\n')); return; }
  const { rows } = size();
  const max = Math.max(1, rows - 1);
  const visible = lines.length > max ? lines.slice(0, max) : lines;
  let buf = `${SYNC_ON}${CSI}H`;
  for (let i = 0; i < visible.length; i += 1) {
    buf += `${CSI}${i + 1};1H${visible[i]}${CSI}K`;
  }
  // Clear anything left below the current frame (e.g. after it shrinks).
  buf += `${CSI}${visible.length + 1};1H${CSI}J`;
  buf += SYNC_OFF;
  w(buf);
}

// ---------------------------------------------------------------------------
// Keypress handling (raw mode). Returns a normalized key name.
// ---------------------------------------------------------------------------
function decodeKey(data) {
  const s = data.toString('utf8');
  if (s === '\x03') return 'ctrl-c';
  if (s === '\r' || s === '\n') return 'enter';
  if (s === '\x1b') return 'esc';
  if (s === '\x7f' || s === '\b') return 'backspace';
  if (s === ' ') return 'space';
  if (s === '\t') return 'tab';
  if (s === '\x1b[A' || s === '\x1bOA') return 'up';
  if (s === '\x1b[B' || s === '\x1bOB') return 'down';
  if (s === '\x1b[C' || s === '\x1bOC') return 'right';
  if (s === '\x1b[D' || s === '\x1bOD') return 'left';
  return s;
}

export function startKeyReader(onKey) {
  if (!isTTY()) return () => {};
  if (IN.setRawMode) IN.setRawMode(true);
  IN.resume();
  IN.setEncoding('utf8');
  const handler = (data) => onKey(decodeKey(Buffer.from(data)));
  IN.on('data', handler);
  return function stop() {
    IN.off('data', handler);
    if (IN.setRawMode) IN.setRawMode(false);
    IN.pause();
  };
}

// ---------------------------------------------------------------------------
// Live loop — drives an animated screen until the render fn signals done.
//   render(ctx) => string[] | { lines, done }
//   onKey(key, ctx) => optionally set ctx.done = true
// ---------------------------------------------------------------------------
export async function runLiveLoop({ render, onKey, fps = 12 }) {
  const ctx = { frame: 0, done: false, key: null, startedAt: Date.now() };
  if (!motionEnabled()) {
    const res = render(ctx);
    const lines = Array.isArray(res) ? res : res.lines;
    console.log(lines.join('\n'));
    return ctx;
  }
  term.enterAlt();
  term.hideCursor();
  term.clear();
  const stopKeys = startKeyReader((key) => {
    ctx.key = key;
    if (key === 'ctrl-c') { ctx.done = true; return; }
    if (onKey) onKey(key, ctx);
  });
  const interval = Math.max(30, Math.round(1000 / fps));
  try {
    while (!ctx.done) {
      const res = render(ctx);
      const lines = Array.isArray(res) ? res : res.lines;
      if (res && res.done) ctx.done = true;
      paintFrame(lines);
      ctx.frame += 1;
      // eslint-disable-next-line no-await-in-loop
      await sleep(interval);
    }
  } finally {
    stopKeys();
    term.showCursor();
    term.exitAlt();
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Typewriter reveal (async). Skips instantly when motion is disabled.
// ---------------------------------------------------------------------------
export async function typewriter(text, { delay = 12, paint = (s) => process.stdout.write(s) } = {}) {
  const chars = [...String(text)];
  if (!motionEnabled()) { console.log(text); return; }
  for (const ch of chars) { paint(ch); await sleep(delay); }
  paint('\n');
}

// Reveal an array of pre-rendered lines with a slight stagger (fade-in feel).
export async function revealLines(lines, { delay = 22 } = {}) {
  if (!motionEnabled()) { console.log(lines.join('\n')); return; }
  for (const line of lines) { console.log(line); await sleep(delay); }
}

// ---------------------------------------------------------------------------
// Shimmer helpers — use the frame counter to animate a gradient offset.
// ---------------------------------------------------------------------------
export function shimmer(text, frame, stops = gradients.brand, speed = 0.04) {
  return gradient(text, stops, { offset: (frame * speed) % 1, bold: true });
}

// Animated "scanning" ellipsis, e.g. "working", "working.", "working.."
export function pulseDots(frame, max = 3) {
  const n = frame % (max + 1);
  return '.'.repeat(n) + ' '.repeat(max - n);
}

// Spinner frame set (braille) resolved for the current frame.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export function spinnerFrame(frame, hex = palette.cyan) {
  return fg(hex, SPINNER[frame % SPINNER.length]);
}

// A moving "comet" progress strip for indeterminate work.
export function cometBar(frame, width = 24, stops = gradients.aurora) {
  const pos = frame % width;
  const cells = [];
  for (let i = 0; i < width; i += 1) {
    const d = Math.abs(i - pos);
    if (d === 0) cells.push('█');
    else if (d === 1) cells.push('▓');
    else if (d === 2) cells.push('▒');
    else cells.push('░');
  }
  return gradient(cells.join(''), stops, { offset: (frame * 0.03) % 1 });
}

export const anim = {
  isTTY, motionEnabled, size, term, sleep, paintFrame,
  startKeyReader, runLiveLoop, typewriter, revealLines,
  shimmer, pulseDots, spinnerFrame, cometBar,
};
export default anim;
