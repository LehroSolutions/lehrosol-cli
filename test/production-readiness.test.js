import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleRpc, startHttpServer } from '../src/mcp/server.js';
import { TOOL_DEFINITIONS, executeTool } from '../src/mcp/tools.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BIN = join(ROOT, 'bin', 'lehrosol.js');

function onceListening(server) {
  return new Promise((resolve) => server.on('listening', resolve));
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('package is production version with executable bin', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+(-[\w.]+)?$/, 'version must be valid semver');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.bin.lehrosol, './bin/lehrosol.js');
  assert.ok(pkg.files.includes('bin'));
  assert.ok(pkg.files.includes('src'));
  assert.ok(!pkg.files.includes('test'), 'npm package should not ship tests');
  const st = await stat(BIN);
  if (process.platform !== 'win32') assert.ok((st.mode & 0o111) !== 0, 'bin must be executable');
});

test('help exposes production config and CMUX thread commands', async () => {
  const { stdout } = await execFileAsync(process.execPath, [BIN, '--help'], {
    cwd: ROOT,
    env: { ...process.env, NO_COLOR: '1', CI: '1' },
    maxBuffer: 5 * 1024 * 1024,
  });
  assert.match(stdout, /config list\|set\|doctor\|wizard/);
  assert.match(stdout, /threads list\|run/);
  assert.match(stdout, /models list\|use\|current\|test/);
  assert.match(stdout, /tui \[--mode basic\|intermediate\|advanced\]/);
});

test('MCP initialize reports the package version (no drift)', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(res.result.serverInfo.name, 'lehrosol-cli');
  assert.equal(res.result.serverInfo.version, pkg.version, 'MCP serverInfo.version must match package.json');
});

test('MCP tools include config, thread, and expanded adapter tools', () => {
  for (const name of ['config_list', 'config_set', 'config_unset', 'threads_list', 'threads_run', 'adapters_list', 'loop_run', 'model_lab_run', 'model_lab_tune', 'model_lab_history', 'model_lab_recommend']) {
    assert.ok(TOOL_DEFINITIONS[name], `missing ${name}`);
  }
  assert.doesNotThrow(() => JSON.stringify(TOOL_DEFINITIONS.loop_run.inputSchema));
  assert.match(TOOL_DEFINITIONS.loop_run.inputSchema.properties.agentAdapter.description, /ollama/);
  assert.match(TOOL_DEFINITIONS.loop_run.inputSchema.properties.agentAdapter.description, /nvidia/);
  assert.match(TOOL_DEFINITIONS.loop_run.inputSchema.properties.agentAdapter.description, /grok/);
});

test('MCP config_set does not echo secrets', async () => {
  const out = await executeTool('config_set', { adapter: 'nvidia', apiKey: 'nvapi-prod-secret-123456', model: 'nvidia/test' });
  assert.deepEqual(out, { adapter: 'nvidia', saved: true });
});

test('HTTP MCP requires bearer token when configured', async () => {
  const server = startHttpServer({ port: 0, host: '127.0.0.1', token: 'test-token' });
  await onceListening(server);
  const { port } = server.address();
  try {
    const noAuth = await postJson(`http://127.0.0.1:${port}`, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(noAuth.status, 401);

    const authed = await postJson(`http://127.0.0.1:${port}`, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { authorization: 'Bearer test-token' });
    assert.equal(authed.status, 200);
    assert.ok(Array.isArray(authed.json.result.tools));

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const h = await health.json();
    assert.equal(h.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
