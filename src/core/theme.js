// LehroSol CLI — Terminal Design System ("HELIX")
// -----------------------------------------------------------------------------
// A single, zero-dependency source of truth for color, typography, glyphs,
// spacing and component primitives used across the CLI *and* the in-terminal
// GUI (TUI). The goal: an agentic terminal experience that out-classes every
// other CLI agent tool — immersive, legible, and consistent at every stage
// (basic / intermediate / advanced).
//
// Design tokens live here. Motion/interaction primitives live in `anim.js`.
// Everything degrades gracefully: truecolor -> 256 -> 16 -> plain, and
// unicode -> ascii, so the same code renders on a modern terminal, a CI log,
// a Windows console, or a piped file.

const ESC = '\x1b';
export const CSI = `${ESC}[`;

// ---------------------------------------------------------------------------
// Color capability detection (0 none, 1 = 16c, 2 = 256c, 3 = truecolor)
// ---------------------------------------------------------------------------
function detectColorLevel(stream = process.stdout) {
  if (process.env.NO_COLOR || process.env.LEHRO_NO_COLOR) return 0;
  const force = process.env.FORCE_COLOR;
  if (force === '0') return 0;
  if (force === '1') return 1;
  if (force === '2') return 2;
  if (force === '3' || force === 'true') return 3;
  const isTTY = Boolean(stream && stream.isTTY);
  if (!isTTY && !process.env.LEHRO_FORCE_TTY) return 0;
  const term = process.env.TERM || '';
  if (term === 'dumb') return 0;
  const colorterm = process.env.COLORTERM || '';
  if (/truecolor|24bit/i.test(colorterm)) return 3;
  if (/-256(color)?$/i.test(term)) return 2;
  return 3; // modern terminals assume truecolor
}

let COLOR_LEVEL = detectColorLevel();
let UNICODE = !process.env.LEHRO_ASCII;

export function setColorLevel(level) { COLOR_LEVEL = level; }
export function getColorLevel() { return COLOR_LEVEL; }
export function colorEnabled() { return COLOR_LEVEL > 0; }
export function setUnicode(on) { UNICODE = Boolean(on); }
export function unicodeEnabled() { return UNICODE; }

// Re-detect (used after CLI flags like --no-color / --ascii are parsed).
export function refreshCapabilities() {
  COLOR_LEVEL = detectColorLevel();
  UNICODE = !process.env.LEHRO_ASCII;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbTo256({ r, g, b }) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16
    + 36 * Math.round((r / 255) * 5)
    + 6 * Math.round((g / 255) * 5)
    + Math.round((b / 255) * 5);
}

function rgbTo16({ r, g, b }) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const bright = lum > 150 ? 60 : 0;
  const code = 30 + (r > 110 ? 1 : 0) + (g > 110 ? 2 : 0) + (b > 110 ? 4 : 0);
  return code + bright;
}

function fgEscape(hex) {
  if (COLOR_LEVEL >= 3) { const { r, g, b } = hexToRgb(hex); return `${CSI}38;2;${r};${g};${b}m`; }
  if (COLOR_LEVEL === 2) return `${CSI}38;5;${rgbTo256(hexToRgb(hex))}m`;
  if (COLOR_LEVEL === 1) return `${CSI}${rgbTo16(hexToRgb(hex))}m`;
  return '';
}

function bgEscape(hex) {
  if (COLOR_LEVEL >= 3) { const { r, g, b } = hexToRgb(hex); return `${CSI}48;2;${r};${g};${b}m`; }
  if (COLOR_LEVEL === 2) return `${CSI}48;5;${rgbTo256(hexToRgb(hex))}m`;
  if (COLOR_LEVEL === 1) return `${CSI}${rgbTo16(hexToRgb(hex)) + 10}m`;
  return '';
}

function reset() { return COLOR_LEVEL > 0 ? `${CSI}0m` : ''; }

// ---------------------------------------------------------------------------
// Palette — LehroSol "Deep HUD" (dark glass, neon accents)
// ---------------------------------------------------------------------------
export const palette = {
  bg:       '#05070a',
  bgElev:   '#0b1118',
  surface:  '#0f1720',
  surface2: '#141d29',
  line:     '#22303f',
  lineSoft: '#16212e',
  cyan:     '#22d3ee',
  teal:     '#2dd4bf',
  green:    '#34d399',
  amber:    '#fbbf24',
  orange:   '#fb923c',
  red:      '#f87171',
  violet:   '#a78bfa',
  blue:     '#38bdf8',
  indigo:   '#818cf8',
  pink:     '#f472b6',
  text:     '#e6faff',
  textDim:  '#9fb4c0',
  muted:    '#63788a',
  faint:    '#3a4a5a',
  white:    '#ffffff',
};

// Semantic tokens
export const tokens = {
  brand:      palette.cyan,
  brandAlt:   palette.violet,
  accent:     palette.teal,
  ok:         palette.green,
  warn:       palette.amber,
  danger:     palette.red,
  info:       palette.blue,
  text:       palette.text,
  textDim:    palette.textDim,
  muted:      palette.muted,
  border:     palette.line,
  borderSoft: palette.lineSoft,
  panelTitle: palette.cyan,
};

// Signature gradients
export const gradients = {
  brand:   [palette.cyan, palette.teal, palette.violet],
  aurora:  [palette.teal, palette.cyan, palette.blue, palette.violet],
  ember:   [palette.amber, palette.orange, palette.pink],
  ok:      [palette.teal, palette.green],
  danger:  [palette.orange, palette.red, palette.pink],
  ocean:   [palette.blue, palette.cyan, palette.teal],
};

// ---------------------------------------------------------------------------
// Core paint helpers
// ---------------------------------------------------------------------------
export function fg(hex, text) { return COLOR_LEVEL ? `${fgEscape(hex)}${text}${reset()}` : String(text); }
export function bg(hex, text) { return COLOR_LEVEL ? `${bgEscape(hex)}${text}${reset()}` : String(text); }
export function on(bgHex, fgHex, text) { return COLOR_LEVEL ? `${bgEscape(bgHex)}${fgEscape(fgHex)}${text}${reset()}` : String(text); }

export const style = {
  bold:      (t) => (COLOR_LEVEL ? `${CSI}1m${t}${CSI}22m` : String(t)),
  dim:       (t) => (COLOR_LEVEL ? `${CSI}2m${t}${CSI}22m` : String(t)),
  italic:    (t) => (COLOR_LEVEL ? `${CSI}3m${t}${CSI}23m` : String(t)),
  underline: (t) => (COLOR_LEVEL ? `${CSI}4m${t}${CSI}24m` : String(t)),
  inverse:   (t) => (COLOR_LEVEL ? `${CSI}7m${t}${CSI}27m` : String(t)),
};

// ---------------------------------------------------------------------------
// Gradient text (supports animated `offset` for shimmer)
// ---------------------------------------------------------------------------
function sampleStops(rgbStops, t) {
  if (rgbStops.length === 1) return rgbStops[0];
  const clamped = Math.max(0, Math.min(1, t));
  const seg = clamped * (rgbStops.length - 1);
  const i = Math.min(Math.floor(seg), rgbStops.length - 2);
  const local = seg - i;
  const a = rgbStops[i];
  const b = rgbStops[i + 1];
  return {
    r: a.r + (b.r - a.r) * local,
    g: a.g + (b.g - a.g) * local,
    b: a.b + (b.b - a.b) * local,
  };
}

// gradient(text, stops, { offset, bold }) — offset in [0,1) rotates the ramp.
export function gradient(text, stops = gradients.brand, opts = {}) {
  const chars = [...String(text)];
  if (!COLOR_LEVEL || chars.length === 0) return String(text);
  const rgbStops = stops.map(hexToRgb);
  const offset = opts.offset || 0;
  let out = '';
  const n = chars.length;
  for (let i = 0; i < n; i += 1) {
    const base = n === 1 ? 0 : i / (n - 1);
    let t = base + offset;
    t = t - Math.floor(t); // wrap into [0,1)
    // ping-pong so the ramp looks continuous when scrolling
    const tt = t <= 0.5 ? t * 2 : (1 - t) * 2;
    const hex = rgbToHex(sampleStops(rgbStops, tt));
    out += opts.bold ? style.bold(fg(hex, chars[i])) : fg(hex, chars[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Glyphs (unicode with ascii fallback)
// ---------------------------------------------------------------------------
const U = (uni, ascii) => (UNICODE ? uni : ascii);
export const glyph = {
  get ok()        { return U('✔', 'v'); },
  get fail()      { return U('✘', 'x'); },
  get warn()      { return U('▲', '!'); },
  get info()      { return U('ⓘ', 'i'); },
  get dot()       { return U('●', '*'); },
  get dotOpen()   { return U('○', 'o'); },
  get diamond()   { return U('◆', '#'); },
  get caret()     { return U('❯', '>'); },
  get arrow()     { return U('➜', '->'); },
  get chevron()   { return U('›', '>'); },
  get bullet()    { return U('•', '-'); },
  get bolt()      { return U('⚡', '*'); },
  get spark()     { return U('✦', '*'); },
  get gear()      { return U('⚙', '%'); },
  get pulse()     { return U('◈', '#'); },
  get lock()      { return U('⛊', '#'); },
  get play()      { return U('▶', '>'); },
  get pause()     { return U('⏸', '=='); },
  get radioOn()   { return U('◉', '(*)'); },
  get radioOff()  { return U('◯', '( )'); },
  get ellipsis()  { return U('…', '...'); },
  get vbar()      { return U('│', '|'); },
  get sep()       { return U('·', '.'); },
};

// Box-drawing sets
export const boxSets = {
  round:  { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', ml: '├', mr: '┤', mt: '┬', mb: '┴', x: '┼' },
  heavy:  { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃', ml: '┣', mr: '┫', mt: '┳', mb: '┻', x: '╋' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', ml: '╠', mr: '╣', mt: '╦', mb: '╩', x: '╬' },
  ascii:  { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ml: '+', mr: '+', mt: '+', mb: '+', x: '+' },
};
export function boxSet(name = 'round') {
  if (!UNICODE) return boxSets.ascii;
  return boxSets[name] || boxSets.round;
}

// ---------------------------------------------------------------------------
// ANSI-aware width helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export function stripAnsi(str) { return String(str).replace(ANSI_RE, ''); }
export function displayWidth(str) { return [...stripAnsi(str)].length; }

// Pad / truncate accounting for ANSI + unicode width.
export function padEndVisible(str, width) {
  const w = displayWidth(str);
  if (w >= width) return str;
  return str + ' '.repeat(width - w);
}
export function truncateVisible(str, width, ell = glyph.ellipsis) {
  const plain = stripAnsi(str);
  const chars = [...plain];
  if (chars.length <= width) return str;
  // Note: truncation drops ANSI styling on the truncated tail intentionally.
  return chars.slice(0, Math.max(0, width - ell.length)).join('') + ell;
}
export function fitVisible(str, width) {
  return padEndVisible(truncateVisible(str, width), width);
}
export function centerVisible(str, width) {
  const w = displayWidth(str);
  if (w >= width) return truncateVisible(str, width);
  const total = width - w;
  const left = Math.floor(total / 2);
  return ' '.repeat(left) + str + ' '.repeat(total - left);
}

// ---------------------------------------------------------------------------
// Badges & chips
// ---------------------------------------------------------------------------
const BADGE_COLORS = {
  ok: palette.green, pass: palette.green, online: palette.green,
  warn: palette.amber, pending: palette.amber,
  fail: palette.red, danger: palette.red, blocked: palette.red, offline: palette.red,
  info: palette.blue, live: palette.cyan, accent: palette.teal, muted: palette.muted,
  brand: palette.cyan,
};
export function badge(text, kind = 'info') {
  const color = BADGE_COLORS[kind] || palette.cyan;
  if (!COLOR_LEVEL) return `[${text}]`;
  return `${bgEscape(color)}${fgEscape('#05070a')}${CSI}1m ${text} ${reset()}`;
}
// Outline chip (colored border + text, transparent fill)
export function chip(text, hex = palette.cyan) {
  if (!COLOR_LEVEL) return `(${text})`;
  return fg(hex, `${UNICODE ? '❰' : '<'}${text}${UNICODE ? '❱' : '>'}`);
}

// Status dot (● colored) + optional label
export function statusDot(kind = 'info') {
  const color = BADGE_COLORS[kind] || palette.muted;
  return fg(color, glyph.dot);
}

// ---------------------------------------------------------------------------
// Meters — gradient progress bars & sparklines
// ---------------------------------------------------------------------------
export function meter(value, total, width = 24, stops = gradients.brand) {
  const t = Number(total) > 0 ? Number(total) : 100;
  const v = Math.max(0, Math.min(Number(value) || 0, t));
  const pct = v / t;
  const filled = Math.round(pct * width);
  const empty = Math.max(0, width - filled);
  if (!COLOR_LEVEL) return `${'#'.repeat(filled)}${'-'.repeat(empty)} ${Math.round(pct * 100)}%`;
  const fullBlock = UNICODE ? '█' : '#';
  const emptyBlock = UNICODE ? '░' : '-';
  const bar = gradient(fullBlock.repeat(filled), stops) + fg(palette.faint, emptyBlock.repeat(empty));
  return `${bar} ${style.bold(fg(palette.text, `${Math.round(pct * 100)}%`))}`;
}

const SPARK_CHARS = '▁▂▃▄▅▆▇█';
export function sparkline(values, hex = palette.cyan) {
  const arr = (values || []).map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0));
  if (!arr.length) return '';
  const max = Math.max(...arr, 1);
  const min = Math.min(...arr, 0);
  const range = max - min || 1;
  const chars = arr.map((v) => {
    if (!UNICODE) return String(Math.round((v / max) * 9));
    const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
  }).join('');
  return fg(hex, chars);
}

export const theme = {
  palette, tokens, gradients, glyph, boxSet, boxSets,
  fg, bg, on, style, gradient, badge, chip, statusDot, meter, sparkline,
  stripAnsi, displayWidth, padEndVisible, truncateVisible, fitVisible, centerVisible,
  colorEnabled, getColorLevel, setColorLevel, unicodeEnabled, setUnicode, refreshCapabilities,
  CSI,
};

export default theme;
