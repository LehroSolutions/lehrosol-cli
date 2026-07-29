// Orchestration engineering: git-worktree based parallel agent workers. Inspired by craigsc/cmux and coder/mux, but framework-agnostic so any agent adapter can be attached to a worker.
//
// Audit upgrade: there is no hardcoded `main` fallback anywhere. If the caller
// omits baseBranch, we use the current branch; in detached HEAD, we use the
// current commit SHA; outside a git repo we return per-worker errors.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEHRO_HOME } from '../core/config.js';

const REGISTRY_PATH = join(LEHRO_HOME, 'worktrees.json');

function readRegistry() {
  if (!existsSync(REGISTRY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeRegistry(reg) {
  mkdirSync(LEHRO_HOME, { recursive: true, mode: 0o700 });
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd: cwd || process.cwd(), encoding: 'utf8' }).trim();
}

function detectBaseRef(cwd) {
  try {
    const branch = git(['branch', '--show-current'], cwd);
    if (branch) return branch;
  } catch {
    // fall through
  }
  try {
    const symbolic = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (symbolic && symbolic !== 'HEAD') return symbolic;
  } catch {
    // fall through
  }
  try {
    return git(['rev-parse', 'HEAD'], cwd);
  } catch {
    throw new Error('Could not detect a base branch or commit. Run inside a git repo or pass --baseBranch <ref>.');
  }
}

export function spawnWorktree(options, cwd) {
  const opts = options || {};
  const count = Math.max(1, Math.min(Number(opts.count || 1), 50));
  const workDir = cwd || process.cwd();
  const taskPrefix = String(opts.taskPrefix || 'lehro-worker').replace(/[^A-Za-z0-9._-]/g, '-');
  let baseBranch;
  try {
    baseBranch = opts.baseBranch || detectBaseRef(workDir);
  } catch (err) {
    return {
      requested: count,
      created: Array.from({ length: count }, (_, i) => ({ name: taskPrefix + '-' + i, error: String((err && err.message) || err) }))
    };
  }

  const registry = readRegistry();
  const created = [];
  for (let i = 0; i < count; i += 1) {
    const suffix = Date.now().toString(36) + i;
    const name = taskPrefix + '-' + suffix;
    const branch = 'lehro/' + name;
    const dir = join(workDir, '.lehro-worktrees', name);
    try {
      git(['worktree', 'add', '-b', branch, dir, baseBranch], workDir);
      registry[name] = { name: name, branch: branch, dir: dir, baseBranch: baseBranch, createdAt: new Date().toISOString(), status: 'idle' };
      created.push(registry[name]);
    } catch (err) {
      created.push({ name: name, error: String((err && err.message) || err) });
    }
  }
  writeRegistry(registry);
  return { requested: count, created: created };
}

export function listWorktrees() {
  return { worktrees: Object.values(readRegistry()) };
}

export function removeWorktree(name, cwd) {
  const workDir = cwd || process.cwd();
  const registry = readRegistry();
  const entry = registry[name];
  if (!entry) return { removed: false, reason: 'not-found' };
  try {
    git(['worktree', 'remove', entry.dir, '--force'], workDir);
  } catch (err) {
    return { removed: false, reason: String((err && err.message) || err) };
  }
  delete registry[name];
  writeRegistry(registry);
  return { removed: true, name: name };
}
