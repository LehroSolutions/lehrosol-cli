import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BIN = join(ROOT, 'bin', 'lehrosol.js');

async function runCli(args, home) {
  return execFileAsync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, LEHRO_HOME: home, NO_COLOR: '1', CI: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
}

test('config set stores NVIDIA adapter settings and masks secrets in output', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-config-home-'));
  try {
    const { stdout } = await runCli(['config', 'set', '--adapter', 'nvidia', '--apiKey', 'nvapi-test-secret-123456', '--model', 'nvidia/test-model', '--json'], home);
    const data = JSON.parse(stdout);
    assert.equal(data.adapter, 'nvidia');
    assert.equal(data.config.apiKey, 'nvap…3456');
    assert.equal(data.config.model, 'nvidia/test-model');

    const raw = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'));
    assert.equal(raw.adapters.nvidia.apiKey, 'nvapi-test-secret-123456');
    assert.equal(raw.adapters.nvidia.model, 'nvidia/test-model');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('config doctor sees saved NVIDIA config as ready without env var', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-config-home-'));
  try {
    await runCli(['config', 'set', '--adapter', 'nvidia', '--apiKey', 'nvapi-test-secret-123456', '--model', 'nvidia/test-model', '--json'], home);
    const { stdout } = await runCli(['config', 'doctor', '--json'], home);
    const data = JSON.parse(stdout);
    const nvidia = data.adapters.find((a) => a.id === 'nvidia');
    assert.ok(nvidia);
    assert.equal(nvidia.configured, true);
    assert.equal(nvidia.model, 'nvidia/test-model');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('adapter registry includes local model endpoints', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-config-home-'));
  try {
    const { stdout } = await runCli(['adapters', '--json'], home);
    const data = JSON.parse(stdout);
    const ids = data.adapters.map((a) => a.id);
    for (const id of ['ollama', 'lmstudio', 'vllm', 'localai']) assert.ok(ids.includes(id), `missing ${id}`);
    const lm = data.adapters.find((a) => a.id === 'lmstudio');
    assert.equal(lm.kind, 'http');
    assert.match(lm.baseUrl, /localhost:1234/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('threads list exposes CMUX-style thread and worktree state', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-threads-home-'));
  try {
    const { stdout } = await runCli(['threads', 'list', '--json'], home);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.threads));
    assert.ok(Array.isArray(data.worktrees));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('config set stores Grok/xAI adapter settings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-grok-home-'));
  try {
    const { stdout } = await runCli(['config', 'set', '--adapter', 'grok', '--apiKey', 'xai-test-secret-123456', '--model', 'grok-4.5', '--json'], home);
    const data = JSON.parse(stdout);
    assert.equal(data.adapter, 'grok');
    assert.equal(data.config.model, 'grok-4.5');
    const { stdout: doctorOut } = await runCli(['config', 'doctor', '--json'], home);
    const doctor = JSON.parse(doctorOut);
    const grok = doctor.adapters.find((a) => a.id === 'grok');
    assert.ok(grok);
    assert.equal(grok.configured, true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('models list exposes curated Grok and local profiles', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-models-home-'));
  try {
    const { stdout } = await runCli(['models', 'list', '--json'], home);
    const data = JSON.parse(stdout);
    assert.ok(data.profiles.some((p) => p.id === 'grok-4.5' && p.adapter === 'grok'));
    assert.ok(data.profiles.some((p) => p.adapter === 'ollama'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('models use saves model profile and preferred adapter', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-models-home-'));
  try {
    const { stdout } = await runCli(['models', 'use', '--profile', 'grok-4.5', '--apiKey', 'xai-profile-secret-123456', '--json'], home);
    const data = JSON.parse(stdout);
    assert.equal(data.ok, true);
    assert.equal(data.preferredAdapter, 'grok');
    assert.equal(data.model, 'grok-4.5');
    const raw = JSON.parse(await readFile(join(home, 'config.json'), 'utf8'));
    assert.equal(raw.favorites.preferredAdapter, 'grok');
    assert.equal(raw.adapters.grok.model, 'grok-4.5');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('models test reports missing Grok key without making a live call', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-models-home-'));
  try {
    const { stdout } = await runCli(['models', 'test', '--adapter', 'grok', '--json'], home).catch((err) => ({ stdout: err.stdout }));
    const data = JSON.parse(stdout);
    assert.equal(data.ok, false);
    assert.match(data.detail, /XAI_API_KEY/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
