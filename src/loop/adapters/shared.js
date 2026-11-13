// Shared helpers for real agent-CLI adapters: PATH detection, git-diff based
// change tracking, and lightweight security heuristics used to build a
// policyInput for the harness Score Agent after an adapter runs.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

export function commandExists(bin) {
  return resolveCommand(bin).ok;
}

// Successful PATH resolutions are memoized per binary for a short TTL. Each
// miss spawns a `where`/`which` child process, and the loop engine/MCP server
// re-probe the same adapter binaries many times per run — on Windows that
// wasted whole minutes (see fix_plan.md). Failed lookups are deliberately NOT
// cached: a binary that appears on PATH later (or mid-test) must be found, and
// failed probes are the cheap path anyway. Call clearResolveCache() in tests
// that manipulate PATH.
const RESOLVE_TTL_MS = 60_000;
const resolveCache = new Map();

export function clearResolveCache() {
  resolveCache.clear();
}

export function resolveCommand(bin) {
  if (!bin) return { ok: true, command: null, launcher: null };
  const raw = String(bin);
  // Explicit path (contains a separator): trust the filesystem directly —
  // `where`/`which` only search PATH and would reject e.g. a llama-server
  // binary discovered inside a model vault root.
  if (/[\\/]/.test(raw)) {
    try {
      if (statSync(raw).isFile()) {
        if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(raw)) {
          return { ok: true, command: raw, launcher: 'cmd' };
        }
        return { ok: true, command: raw, launcher: null };
      }
    } catch { /* fall through: not a real file */ }
    return { ok: false, command: raw, launcher: null };
  }
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const cached = resolveCache.get(raw);
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.value;
  let value;
  try {
    const out = execFileSync(lookup, [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const candidates = out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const command = process.platform === 'win32'
      ? candidates.find((candidate) => /\.exe$/i.test(candidate)) || candidates.find((candidate) => /\.(cmd|bat)$/i.test(candidate)) || candidates[0] || bin
      : candidates[0] || bin;
    const lower = command.toLowerCase();
    // Windows npm shims are often .cmd/.bat files. execFile('opencode') can
    // report ENOENT even after `where opencode` succeeds; launch the resolved
    // shim's Node entrypoint so arguments are not reparsed by a shell.
    if (process.platform === 'win32' && (/\.(cmd|bat)$/.test(lower) || !/\.exe$/.test(lower))) {
      value = { ok: true, command, launcher: 'cmd' };
    } else {
      value = { ok: true, command, launcher: null };
    }
    resolveCache.set(raw, { at: Date.now(), value });
    return value;
  } catch {
    return { ok: false, command: bin, launcher: null };
  }
}

export function launchSpec(bin, args = []) {
  const resolved = resolveCommand(bin);
  if (!resolved.ok) return { ok: false, file: bin, args };
  if (resolved.launcher === 'cmd') {
    let entry;
    try {
      const shim = readFileSync(resolved.command, 'utf8');
      const match = shim.match(/"%dp0%[\\/](node_modules[\\/][\w@.\\/ -]+\.[cm]?js)"\s+%\*/i);
      if (match) {
        const base = resolve(dirname(resolved.command));
        const candidate = resolve(base, match[1].replace(/[\\/]/g, sep));
        if (candidate.startsWith(base + sep) && statSync(candidate).isFile()) entry = candidate;
      }
    } catch {}
    if (!entry) throw new Error('Custom Windows shell wrappers cannot safely preserve adapter arguments. Configure a native executable or a Node.js entrypoint instead.');
    return { ok: true, file: process.execPath, args: [entry, ...args], resolvedCommand: resolved.command };
  }
  if (/\.[cm]?js$/i.test(resolved.command || '')) return { ok: true, file: process.execPath, args: [resolved.command, ...args], resolvedCommand: resolved.command };
  return { ok: true, file: resolved.command || bin, args, resolvedCommand: resolved.command || bin };
}


export function isGitRepo(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function changedFilesSince(cwd, ref) {
  if (!isGitRepo(cwd)) return [];
  try {
    const tracked = execFileSync('git', ['diff', '--relative', '--name-only', '-z', ref || 'HEAD', '--', '.'], { cwd: cwd, encoding: 'utf8' });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'], { cwd: cwd, encoding: 'utf8' });
    const files = (tracked + untracked).split('\0').filter(Boolean);
    return Array.from(new Set(files));
  } catch {
    return [];
  }
}

export function diffText(cwd, ref) {
  if (!isGitRepo(cwd)) return '';
  try {
    return execFileSync('git', ['diff', '--relative', ref || 'HEAD', '--', '.'], { cwd: cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch {
    return '';
  }
}

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA|EC|OPENSSH|PGP|DSA) PRIVATE KEY-----/,
  /sk-[a-zA-Z0-9]{20,}/,
  /gh[pousr]_[a-zA-Z0-9]{20,}/,
  /xox[baprs]-[0-9a-zA-Z-]{10,}/,
  /AIza[0-9A-Za-z_-]{35}/
];

export function scanForSecrets(text) {
  const haystack = text || '';
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(haystack)) return false;
  }
  return true;
}

const TEST_FILE_PATTERN = /(^|\/)(test|tests|__tests__|spec)(\/|_|-|\.)|\.(test|spec)\.[jt]sx?$|(^|\/)test_.*\.py$|_test\.py$/i;

export function hasTestChanges(files) {
  return (files || []).some((f) => TEST_FILE_PATTERN.test(f));
}

function basePolicyInput(context) {
  return { hasTests: false, secretScanPassed: true, reviewCount: context.reviewCount != null ? context.reviewCount : 0, branch: context.branch || 'unknown', owaspScope: context.owaspScope || [] };
}

export function unavailableResult(meta, context) {
  const ctx = context || {};
  return {
    adapter: meta.id,
    available: false,
    summary: meta.label + ' adapter: `' + meta.bin + '` was not found on PATH. Install it' + (meta.docs ? ' (see ' + meta.docs + ')' : '') + ', or pass a different --agentAdapter (try `local` for a dry run).',
    changedFiles: [],
    policyInput: basePolicyInput(ctx)
  };
}

export function failureResult(meta, context, err) {
  const ctx = context || {};
  return {
    adapter: meta.id,
    available: true,
    error: true,
    summary: meta.label + ' adapter failed: ' + String((err && err.message) || err),
    changedFiles: [],
    policyInput: basePolicyInput(ctx)
  };
}

export function successResult(meta, cwd, beforeRef, stdout, context) {
  const ctx = context || {};
  const changedFiles = beforeRef ? changedFilesSince(cwd, beforeRef) : [];
  const diff = beforeRef ? diffText(cwd, beforeRef) : '';
  const secretScanPassed = scanForSecrets(diff) && scanForSecrets(stdout);
  return {
    adapter: meta.id,
    available: true,
    summary: (meta.label + ' output:\n' + String(stdout || '').trim()).slice(0, 4000),
    changedFiles: changedFiles,
    policyInput: {
      hasTests: hasTestChanges(changedFiles),
      secretScanPassed: secretScanPassed,
      reviewCount: ctx.reviewCount != null ? ctx.reviewCount : 1,
      branch: ctx.branch || 'lehro/loop',
      owaspScope: ctx.owaspScope || []
    }
  };
}
