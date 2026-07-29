import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toolNames, toolSchemas, executeTool } from '../src/loop/tools/registry.js';
import { listAdapters } from '../src/loop/adapters/index.js';
import { createHttpAdapter } from '../src/loop/adapters/makeHttpAdapter.js';
import { loadCustomAdapters } from '../src/loop/adapters/customAdapters.js';
import { buildTuiSnapshot } from '../src/commands/tui.js';

// ---------------------------------------------------------------------------
// Tool-calling registry
// ---------------------------------------------------------------------------
test('tool registry exposes OpenAI-compatible schemas', () => {
  const names = toolNames();
  for (const expected of ['read_file', 'write_file', 'edit_file', 'list_dir', 'search_text', 'git_diff', 'run_tests', 'run_command']) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  const schemas = toolSchemas();
  assert.ok(schemas.every((s) => s.type === 'function' && s.function && s.function.name && s.function.parameters));
});

test('tool registry list_dir works inside the project root', () => {
  const res = executeTool('list_dir', { path: '.' }, { cwd: process.cwd() });
  assert.equal(res.ok, true);
  assert.match(res.output, /package\.json/);
});

test('tool registry sandboxes filesystem access to the project root', () => {
  const res = executeTool('read_file', { path: '../../../../etc/passwd' }, { cwd: process.cwd() });
  assert.equal(res.ok, false);
  assert.match(res.output, /outside|Refus/i);
});

test('tool registry rejects unknown tools without throwing', () => {
  const res = executeTool('definitely_not_a_tool', {}, { cwd: process.cwd() });
  assert.equal(res.ok, false);
  assert.match(res.output, /Unknown tool/);
});

test('run_command is denied unless explicitly opted in', () => {
  const prev = process.env.LEHRO_TOOLS_ALLOW_EXEC;
  delete process.env.LEHRO_TOOLS_ALLOW_EXEC;
  const res = executeTool('run_command', { command: 'echo hi' }, { cwd: process.cwd() });
  assert.equal(res.ok, true); // executor itself does not throw
  assert.match(res.output, /disabled|LEHRO_TOOLS_ALLOW_EXEC/);
  if (prev != null) process.env.LEHRO_TOOLS_ALLOW_EXEC = prev;
});

// ---------------------------------------------------------------------------
// Adapter ecosystem
// ---------------------------------------------------------------------------
test('adapter registry includes the open-source agent ecosystem', () => {
  const adapters = listAdapters();
  const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));
  for (const id of ['local', 'claude-code', 'codex', 'cursor', 'qwen', 'qoder', 'zencoder', 'amp', 'ollama', 'nvidia', 'grok']) {
    assert.ok(byId[id], `missing adapter ${id}`);
  }
  // Every adapter advertises a kind + configured flag for the cockpit.
  assert.ok(adapters.every((a) => typeof a.kind === 'string' && typeof a.configured === 'boolean'));
  assert.equal(byId.ollama.kind, 'http');
  assert.equal(byId.nvidia.kind, 'http');
  assert.equal(byId.grok.kind, 'http');
  assert.equal(byId.grok.requiresEnv, 'XAI_API_KEY');
  assert.ok(byId.grok.baseUrl && byId.grok.baseUrl.includes('api.x.ai'));
  assert.match(String(byId.grok.model || ''), /grok/i);
  assert.equal(byId.cursor.kind, 'cli');
  assert.equal(byId.qwen.headless, 'qwen -p "<prompt>"');
  assert.equal(byId.qoder.bin, 'qodercli');
  assert.equal(byId.qoder.headless, 'qodercli -p "<prompt>"');
  assert.equal(byId.local.installed, true);
  assert.ok(byId.ollama.baseUrl && byId.ollama.baseUrl.includes('11434'));
  assert.equal(byId.ollama.requiresEnv, null);
  assert.equal(byId.nvidia.requiresEnv, 'NVIDIA_API_KEY');
});

test('unconfigured HTTP adapter fails gracefully instead of throwing', async () => {
  const prev = process.env.MISSING_KEY_TEST;
  delete process.env.MISSING_KEY_TEST;
  const adapter = createHttpAdapter({
    id: 'test-http', label: 'Test HTTP', baseUrl: 'http://localhost:9/v1',
    model: 'x', apiKeyEnv: 'MISSING_KEY_TEST',
  });
  assert.equal(adapter.configured(), false);
  const result = await adapter.run({ prompt: 'hello', cwd: process.cwd() });
  assert.equal(result.available, false);
  assert.match(result.summary, /not configured/i);
  assert.deepEqual(result.changedFiles, []);
  if (prev != null) process.env.MISSING_KEY_TEST = prev;
});

test('local HTTP adapter factory needs no API key but registry can still probe reachability', () => {
  const adapter = createHttpAdapter({ id: 'local-http', label: 'Local', baseUrl: 'http://localhost:1234/v1', model: 'm', local: true });
  assert.equal(adapter.configured(), true);
});

test('custom adapters load from .lehrorc.json (usable with ANY agent)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lehro-custom-'));
  const home = await mkdtemp(join(tmpdir(), 'lehro-home-'));
  const prevHome = process.env.LEHRO_HOME;
  process.env.LEHRO_HOME = home;
  try {
    await writeFile(join(dir, '.lehrorc.json'), JSON.stringify({
      adapters: [
        { id: 'my-cli', label: 'My CLI', kind: 'cli', bin: 'my-agent', args: ['run', '--prompt', '{prompt}'] },
        { id: 'my-http', label: 'My HTTP', kind: 'http', baseUrl: 'http://localhost:8000/v1', model: 'm', local: true },
      ],
    }), 'utf8');
    const custom = loadCustomAdapters(dir);
    const ids = custom.map((a) => a.meta.id);
    assert.ok(ids.includes('my-cli'));
    assert.ok(ids.includes('my-http'));
    assert.ok(custom.every((a) => a.meta.custom === true));
  } finally {
    if (prevHome != null) process.env.LEHRO_HOME = prevHome; else delete process.env.LEHRO_HOME;
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Cockpit snapshot surfaces the new capabilities
// ---------------------------------------------------------------------------
test('tui snapshot exposes tools + adapter kinds for the interactive cockpit', () => {
  const snap = buildTuiSnapshot('advanced');
  assert.ok(Array.isArray(snap.tools) && snap.tools.includes('read_file'));
  assert.ok(snap.adapters.every((a) => typeof a.kind === 'string'));
});
