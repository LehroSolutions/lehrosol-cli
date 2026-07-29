import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BIN = join(ROOT, 'bin', 'lehrosol.js');

async function runCli(args) {
  const home = await mkdtemp(join(tmpdir(), 'lehro-tui-home-'));
  return execFileAsync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, LEHRO_HOME: home, NO_COLOR: '1', CI: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
}

test('tui renders the in-terminal GUI cockpit with all panels', async () => {
  const { stdout, stderr } = await runCli(['tui', '--mode=advanced', '--static']);
  assert.match(stdout, /L E H R O S O L/); // animated wordmark banner
  assert.match(stdout, /agentic engineering console/);
  assert.match(stdout, /SYSTEM HEALTH/);
  assert.match(stdout, /AGENT ADAPTERS/);
  assert.match(stdout, /SESSIONS/);
  assert.match(stdout, /HARNESS \/ POLICY/);
  assert.match(stdout, /ENGRAM MEMORY/);
  assert.match(stdout, /ORCHESTRATION/);
  assert.match(stdout, /QUICK ACTIONS/);
  assert.doesNotMatch(stderr, /ExperimentalWarning/);
});

test('tui highlights the active stage chip', async () => {
  const basic = await runCli(['tui', '--mode=basic', '--static']);
  assert.match(basic.stdout, /\[BASIC\]/);
  const adv = await runCli(['tui', '--mode=advanced', '--static']);
  assert.match(adv.stdout, /\[ADVANCED\]/);
});

test('tui json returns dashboard data for automation', async () => {
  const { stdout } = await runCli(['tui', '--mode=intermediate', '--json']);
  const data = JSON.parse(stdout);
  assert.equal(data.mode, 'intermediate');
  assert.ok(Array.isArray(data.adapters));
  assert.ok(Array.isArray(data.sessions));
  assert.ok(data.doctor);
  assert.ok(data.metrics && Array.isArray(data.metrics.adapters));
});

test('help advertises the immersive terminal GUI command', async () => {
  const { stdout } = await runCli(['--help']);
  assert.match(stdout, /tui \[--mode basic\|intermediate\|advanced\]/);
  assert.match(stdout, /in-terminal GUI cockpit/);
});
