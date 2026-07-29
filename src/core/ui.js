// LehroSol CLI — Rich terminal UI layer (zero-dependency, ANSI-only).
// Ported from gidevo-api-tool's `ui.ts` / `spinner.ts` / `interactive.ts`
// patterns, re-themed to match LehroSol's dark glass-HUD design language.

import { createInterface } from 'node:readline';
import { refreshCapabilities, setUnicode } from './theme.js';

const ESC = String.fromCharCode(27);
const C = {
  reset: `${ESC}[0m`,
  cyan: (t) => `${ESC}[38;2;34;211;238m${t}${C.reset}`,
  green: (t) => `${ESC}[38;2;52;211;153m${t}${C.reset}`,
  amber: (t) => `${ESC}[38;2;251;191;36m${t}${C.reset}`,
  red: (t) => `${ESC}[38;2;248;113;113m${t}${C.reset}`,
  dim: (t) => `${ESC}[2m${t}${C.reset}`,
  bold: (t) => `${ESC}[1m${t}${C.reset}`,
  underline: (t) => `${ESC}[4m${t}${C.reset}`,
  white: (t) => `${ESC}[38;2;226;250;255m${t}${C.reset}`,
  bgDark: (t) => `${ESC}[48;2;5;7;10m${ESC}[38;2;34;211;238m${t}${C.reset}`,
};

let _quiet = false;
let _noColor = false;

export function configureUi(opts = {}) {
  _quiet = opts.quiet ?? _quiet;
  _noColor = opts.noColor ?? _noColor;
  if (_noColor) process.env.NO_COLOR = '1';
  if (opts.ascii) { process.env.LEHRO_ASCII = '1'; setUnicode(false); }
  if (opts.noAnim) process.env.LEHRO_NO_ANIM = '1';
  // Keep the HELIX design system's capability detection in sync with flags.
  refreshCapabilities();
}

function isEnabled() {
  return !_noColor && !process.env.NO_COLOR && process.stdout.isTTY;
}

function paint(fn, text) {
  return isEnabled() ? fn(String(text)) : String(text);
}

function stripAnsi(str) {
  return String(str).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export function showBanner(version) {
  if (_quiet) return;
  console.log('');
  console.log(paint(C.cyan, paint(C.bold, '  LehroSol CLI')));
  console.log(paint(C.dim, '  Unified agentic engineering: loop + harness + orchestration'));
  if (version) console.log(paint(C.dim, `  v${version}  ·  GPL-3.0-or-later  ·  alias: lehr-sol`));
  console.log('');
}

export function showCompactBanner(version) {
  if (_quiet) return;
  console.log(paint(C.cyan, paint(C.bold, '\n  LehroSol')) + paint(C.dim, ` CLI  v${version || ''}`));
}

// ASCII rendition of the LS brand mark — terminals can't show the real logo
// (that lives in the GUI and the web dashboard), so this is its text twin.
// Pure ASCII on purpose: survives legacy consoles, pipes, and CI logs.
export function showLogoBanner(version) {
  if (_quiet) return;
  const mark = [
    ' _       ____  ',
    '| |     / ___| ',
    '| |     \\___ \\ ',
    '| |___   ___) |',
    '|_____| |____/ ',
  ];
  const side = [
    '',
    'L E H R O S O L',
    'local models on your drive · agentic engineering',
    version ? `v${version} · GPL-3.0-or-later · alias: lehr-sol` : '',
    '',
  ];
  console.log('');
  mark.forEach((row, i) => {
    const left = paint(C.green, paint(C.bold, '  ' + row));
    const right = i === 1
      ? paint(C.cyan, paint(C.bold, '   ' + side[i]))
      : (side[i] ? paint(C.dim, '   ' + side[i]) : '');
    console.log(left + right);
  });
  console.log('');
}

export function box(content, opts = {}) {
  const { title, padding = 1 } = opts;
  const borderColor = opts.borderColor || 'cyan';
  const lines = String(content).split('\n');
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length), title ? stripAnsi(title).length + 4 : 0);
  const width = maxLen + padding * 2;
  const b = isEnabled() ? (borderColor === 'green' ? C.green : borderColor === 'amber' ? C.amber : borderColor === 'red' ? C.red : C.cyan) : (t) => t;
  const hLine = '─'.repeat(width);
  const pad = ' '.repeat(padding);
  let result = title
    ? b(`╭─ ${title} ${'─'.repeat(Math.max(width - stripAnsi(title).length - 3, 0))}`) + '\n'
    : b(`╭${hLine}╮`) + '\n';
  for (const line of lines) {
    const lineLen = stripAnsi(line).length;
    const rightPad = ' '.repeat(Math.max(width - padding - lineLen, 0));
    result += b('│') + pad + line + rightPad + b('│') + '\n';
  }
  result += b(`╰${hLine}╯`);
  return result;
}

export function success(message, details) {
  console.log(paint(C.green, paint(C.bold, '\n  [OK]')));
  console.log(paint(C.white, `  ${message}`));
  if (details) console.log(paint(C.dim, `  ${details}`));
}

export function error(message, details) {
  console.log(paint(C.red, paint(C.bold, '\n  [ERROR]')));
  console.log(paint(C.white, `  ${message}`));
  if (details) console.log(paint(C.dim, `  ${details}`));
}

export function warning(message, details) {
  console.log(paint(C.amber, paint(C.bold, '\n  [WARN]')));
  console.log(paint(C.white, `  ${message}`));
  if (details) console.log(paint(C.dim, `  ${details}`));
}

export function info(message, details) {
  console.log(paint(C.cyan, paint(C.bold, '\n  [INFO]')));
  console.log(paint(C.white, `  ${message}`));
  if (details) console.log(paint(C.dim, `  ${details}`));
}

export function step(stepNum, total, message) {
  const sn = String(stepNum).padStart(2, '0');
  const tn = String(total).padStart(2, '0');
  console.log(paint(C.dim, '  [') + paint(C.cyan, sn) + paint(C.dim, `/${tn}] `) + paint(C.white, message));
}

export function list(items, title) {
  if (title) console.log(paint(C.cyan, paint(C.bold, `\n  ${title}`)));
  items.forEach((item) => console.log(paint(C.cyan, '  ▸ ') + paint(C.white, item)));
}

export function keyValue(key, value, indent = 2) {
  const padStr = ' '.repeat(indent);
  console.log(`${padStr}${paint(C.dim, `${key}:`)} ${paint(C.white, value)}`);
}

export function table(headers, rows) {
  const safeRows = rows || [];
  const colWidths = headers.map((h, i) => {
    const maxRow = Math.max(0, ...safeRows.map((r) => stripAnsi(r[i] ?? '').length));
    return Math.max(stripAnsi(h).length, maxRow);
  });
  console.log('');
  console.log('  ' + headers.map((h, i) => paint(C.dim, String(h).toUpperCase().padEnd(colWidths[i]))).join('  '));
  safeRows.forEach((row) => {
    const rowStr = row.map((cell, i) => {
      const content = String(cell ?? '').padEnd(colWidths[i]);
      return i === 0 ? paint(C.cyan, content) : paint(C.white, content);
    }).join('  ');
    console.log(`  ${rowStr}`);
  });
  console.log('');
}

export function progressBar(current, total, width = 30) {
  const numericTotal = Number(total);
  const safeTotal = Number.isFinite(numericTotal) && numericTotal > 0 ? numericTotal : 100;
  const numericCurrent = Number(current);
  const safeCurrent = Number.isFinite(numericCurrent) ? Math.max(0, Math.min(numericCurrent, safeTotal)) : 0;
  const pct = Math.round((safeCurrent / safeTotal) * 100);
  const filled = Math.round((safeCurrent / safeTotal) * width);
  const empty = Math.max(0, width - filled);
  return `${paint(C.cyan, '█'.repeat(filled))}${paint(C.dim, '░'.repeat(empty))} ${pct}%`;
}

export function divider(char = '─', length = 50) {
  console.log(paint(C.dim, `\n  ${String(char).repeat(length)}\n`));
}

export function sectionHeader(title) {
  console.log(paint(C.cyan, paint(C.bold, `\n  ${String(title).toUpperCase()}\n`)));
}

export function nextSteps(steps) {
  console.log(paint(C.green, paint(C.bold, '\n  NEXT STEPS\n')));
  steps.forEach((s, i) => console.log(paint(C.dim, `  ${i + 1}. `) + paint(C.white, s)));
  console.log('');
}

export function code(command, description) {
  console.log(paint(C.bgDark, `  $ ${command}  `));
  if (description) console.log(paint(C.dim, `    ${description}`));
}

export function highlight(text) {
  return paint(C.amber, text);
}

export function filePath(p) {
  return paint(C.underline, paint(C.dim, p));
}

export function createSpinner(message) {
  if (_quiet || !process.stdout.isTTY || process.env.CI) {
    return {
      text: message,
      start: () => {},
      stop: () => {},
      succeed: (t) => { if (t) console.log(t); },
      fail: (t) => { if (t) console.log(t); },
    };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIdx = 0;
  let interval = null;
  const spinner = {
    text: message,
    start: () => {
      if (interval) return;
      interval = setInterval(() => {
        process.stdout.write(`\r${paint(C.cyan, frames[frameIdx % frames.length])} ${spinner.text}`);
        frameIdx += 1;
      }, 80);
    },
    stop: () => {
      if (interval) { clearInterval(interval); interval = null; }
      process.stdout.write('\r' + ' '.repeat(stripAnsi(spinner.text || '').length + 4) + '\r');
    },
    succeed: (t) => { spinner.stop(); if (t) console.log(paint(C.green, '✓') + ' ' + t); },
    fail: (t) => { spinner.stop(); if (t) console.log(paint(C.red, '✗') + ' ' + t); },
  };
  return spinner;
}

function ask(question, defaultValue) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`  ${paint(C.cyan, '?')} ${question}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || (defaultValue || ''));
    });
  });
}

function askConfirm(question, defaultYes = true) {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${paint(C.cyan, '?')} ${question} [${hint}]: `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' ? defaultYes : a.startsWith('y'));
    });
  });
}

function askSelect(question, options, defaultIndex = 0) {
  console.log(paint(C.cyan, paint(C.bold, `\n  ${question}\n`)));
  options.forEach((opt, i) => {
    const marker = i === defaultIndex ? paint(C.green, '❯') : ' ';
    console.log(`  ${marker} ${opt}`);
  });
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${paint(C.cyan, '?')} Enter number [${defaultIndex + 1}]: `, (answer) => {
      rl.close();
      const idx = parseInt(answer.trim(), 10);
      resolve(options[Number.isNaN(idx) || idx < 1 || idx > options.length ? defaultIndex : idx - 1]);
    });
  });
}

export async function runInteractiveMode(version) {
  showBanner(version);
  const action = await askSelect('Select a workflow', [
    'doctor      — Read-only project health check',
    'init        — Scaffold AGENTS.md / fix_plan.md / .lehrorc.json',
    'loop run    — Run the Ralph-style Loop Engine',
    'adapters    — List agent CLI adapters',
    'sessions    — Inspect persisted loop sessions',
    'orchestrate — Manage git-worktree agent workers',
    'policy      — Run the harness policy/OWASP gate',
    'gui         — Start the MCP control plane for terminal ↔ GUI handoff',
    'tui         — Open the immersive in-terminal GUI cockpit (live)',
    'exit        — Close interactive mode',
  ], 0);

  const cmd = action.split(/\s+/)[0].trim().toLowerCase();

  switch (cmd) {
    case 'doctor':
      return { command: 'doctor', options: {} };
    case 'init':
      return { command: 'init', options: { force: await askConfirm('Overwrite existing files?', false) } };
    case 'loop':
      return { command: 'loop', options: {
        prompt: await ask('Prompt for the loop'),
        maxIterations: Number(await ask('Max iterations', '8')),
        agentAdapter: await ask('Agent adapter (local, claude-code, codex, opencode, gemini-cli, aider, goose, hermes-agent)', 'local'),
        dryRun: await askConfirm('Dry run? (no real agent calls)', true),
      }};
    case 'adapters':
      return { command: 'adapters', options: {} };
    case 'sessions':
      return { command: 'sessions', options: { id: await ask('Session ID (leave empty to list all)') } };
    case 'orchestrate':
      return { command: 'orchestrate', options: {
        subcommand: await askSelect('Action', ['spawn', 'list', 'remove'], 0),
        count: Number(await ask('How many workers?', '1')),
      }};
    case 'policy':
      return { command: 'policy', options: {
        branch: await ask('Branch name'),
        hasTests: await askConfirm('Has tests?', true),
        reviewCount: Number(await ask('Review count', '1')),
        owaspScope: await ask('OWASP scope (llm,web,asvs)', 'web'),
      }};
    case 'gui':
      return { command: 'gui', options: {} };
    case 'tui':
      return { command: 'tui', options: {
        mode: (await ask('TUI mode (basic, intermediate, advanced)', 'advanced')).toLowerCase(),
        live: true,
      } };
    case 'exit':
      console.log('\n  Interactive mode closed.\n');
      process.exit(0);
    default:
      throw new Error(`Unknown workflow: ${cmd}`);
  }
}

export const ui = {
  configureUi, showBanner, showCompactBanner, showLogoBanner, box,
  success, error, warning, info, step, list, keyValue, table,
  progressBar, divider, nextSteps, sectionHeader, code, highlight, filePath,
  createSpinner, runInteractiveMode,
};

export default ui;
