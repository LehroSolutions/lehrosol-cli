// Read-only project health check, generalized from gidevo-api-tool's `doctor` command (validate-only, never mutates).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../core/config.js';
import { listAdapters } from '../loop/adapters/index.js';
import { backend as sessionBackend } from '../core/sessionStore.js';

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return { name: 'node-version', ok: major >= 20, detail: 'node ' + process.versions.node + ' (>=20 required)' };
}

function checkGit(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: cwd, stdio: 'pipe' });
    return { name: 'git-repo', ok: true, detail: 'inside a git work tree' };
  } catch (e) {
    return { name: 'git-repo', ok: false, detail: 'not inside a git work tree (orchestrate/worktree features need git)' };
  }
}

function checkAgentsMd(cwd) {
  const hasAgents = existsSync(join(cwd, 'AGENTS.md')) || existsSync(join(cwd, 'AGENT.md'));
  return { name: 'agents-md', ok: hasAgents, detail: hasAgents ? 'found AGENTS.md / AGENT.md' : 'no AGENTS.md found (Loop Engine works best with one; run: lehrosol init)' };
}

function checkConfig() {
  const config = loadConfig();
  return { name: 'lehro-config', ok: true, detail: 'config loaded (version ' + (config.version || 1) + ')' };
}

function checkSessionStore() {
  const backend = sessionBackend();
  return { name: 'session-store', ok: true, detail: 'checkpoints persist via ' + backend };
}

function checkAdapters() {
  const adapters = listAdapters();
  const installed = adapters.filter((a) => a.installed);
  const names = installed.map((a) => a.id).join(', ') || 'none (local dry-run only)';
  return { name: 'agent-adapters', ok: true, detail: installed.length + '/' + adapters.length + ' agent CLIs found on PATH: ' + names };
}

export function runDoctor(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const checks = [checkNodeVersion(), checkGit(cwd), checkAgentsMd(cwd), checkConfig(), checkSessionStore(), checkAdapters()];
  const allOk = checks.every((c) => c.ok);
  return { ok: allOk, cwd: cwd, checks: checks, checkedAt: new Date().toISOString() };
}
