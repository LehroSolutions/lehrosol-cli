// Workspace diff capture for the Loop Engine.
// After each live iteration we snapshot `git diff` so users can inspect what
// the agent actually changed — from the CLI (`lehrosol diff`), the TUI (x),
// or the GUI/MCP control plane (sessions_diff). Zero-dependency: shells out
// to git and degrades to null outside a repo.
import { execFileSync } from 'node:child_process';

const MAX_PATCH_BYTES = 120_000; // keep session storage bounded

function git(cwd, args, timeout = 10000) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

export function isGitRepo(cwd) {
  try {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

// Snapshot of the working tree vs HEAD (or vs the empty index in a fresh
// repo without commits). Includes untracked files so brand-new files the
// agent created are visible too.
export function captureWorkspaceDiff(cwd) {
  if (!isGitRepo(cwd)) return null;
  let stat = '';
  let patch = '';
  try {
    stat = git(cwd, ['diff', '--stat', 'HEAD']).trim();
    patch = git(cwd, ['diff', 'HEAD']);
  } catch {
    // Fresh repo without a HEAD commit — fall back to unstaged diff only.
    try {
      stat = git(cwd, ['diff', '--stat']).trim();
      patch = git(cwd, ['diff']);
    } catch {
      return null;
    }
  }
  let untrackedFiles = [];
  try {
    const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']).trim();
    untrackedFiles = untracked ? untracked.split('\n') : [];
  } catch { /* keep going — tracked diff is still useful */ }
  let truncated = false;
  if (patch.length > MAX_PATCH_BYTES) {
    patch = patch.slice(0, MAX_PATCH_BYTES) + '\n\u2026 (truncated)';
    truncated = true;
  }
  const empty = !patch.trim() && untrackedFiles.length === 0;
  return {
    empty,
    stat,
    patch,
    untrackedFiles,
    truncated,
    capturedAt: new Date().toISOString(),
  };
}

// Shared ANSI colorizer for unified diffs (used by the diff command and TUI).
const ESC = '\u001b[';
const RESET = `${ESC}0m`;
const paint = {
  add: (t) => `${ESC}38;2;52;211;153m${t}${RESET}`,
  del: (t) => `${ESC}38;2;248;113;113m${t}${RESET}`,
  hunk: (t) => `${ESC}38;2;34;211;238m${t}${RESET}`,
  file: (t) => `${ESC}1m${ESC}38;2;226;250;255m${t}${RESET}`,
  meta: (t) => `${ESC}2m${t}${RESET}`,
};

export function colorizeDiff(patch) {
  return String(patch || '').split('\n').map((line) => {
    if (line.startsWith('diff --git')) return paint.file(line);
    if (line.startsWith('+++') || line.startsWith('---')) return paint.file(line);
    if (line.startsWith('@@')) return paint.hunk(line);
    if (line.startsWith('+')) return paint.add(line);
    if (line.startsWith('-')) return paint.del(line);
    if (line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) return paint.meta(line);
    return line;
  });
}
