import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { recordUsage, readUsage } from '../src/core/usage.js';
import { readGgufContext } from '../src/core/ggufMetadata.js';
import { executeTool } from '../src/mcp/tools.js';

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lehro-usage-'));
  t.after(() => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep)); rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('usage aggregates measured counts and keeps missing values unknown', (t) => {
  const dir = temporary(t);
  recordUsage({ model: 'alpha', usage: { prompt_tokens: 0, completion_tokens: 30 } }, dir);
  recordUsage({ model: 'alpha', usage: { prompt_tokens: -1, completion_tokens: '12' } }, dir);
  recordUsage({ model: 'beta', usage: { prompt_tokens: 20, completion_tokens: 10 } }, dir);
  const result = readUsage({ home: dir }); const alpha = result.models[0];
  assert.equal(alpha.requests, 2); assert.equal(alpha.promptTokens, 0); assert.equal(alpha.completionTokens, 30);
  assert.equal(alpha.unmeasuredRequests, 1); assert.equal(alpha.last.completionTokens, null);
});

test('usage skips duplicate request ids, malformed tails, and limits its period', (t) => {
  const dir = temporary(t);
  const row = recordUsage({ model: 'alpha', usage: { prompt_tokens: 2, completion_tokens: 3 } }, dir);
  appendFileSync(join(dir, 'usage', row.at.slice(0, 10) + '.jsonl'), JSON.stringify(row) + '\n{partial\n');
  const result = readUsage({ home: dir, days: Infinity });
  assert.equal(result.periodDays, 30); assert.equal(result.models[0].requests, 1); assert.equal(result.invalidRows, 1);
});

test('GGUF context reads typed native metadata and rejects invalid headers', (t) => {
  const dir = temporary(t); const file = join(dir, 'tiny.gguf');
  const string = (text) => { const size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(Buffer.byteLength(text))); return Buffer.concat([size, Buffer.from(text)]); };
  const header = Buffer.alloc(24); header.write('GGUF'); header.writeUInt32LE(3, 4); header.writeBigUInt64LE(1n, 16);
  const type = Buffer.alloc(4); type.writeUInt32LE(4); const value = Buffer.alloc(4); value.writeUInt32LE(131072);
  writeFileSync(file, Buffer.concat([header, string('qwen.context_length'), type, value]));
  assert.equal(readGgufContext(file), 131072);
  writeFileSync(file, 'not a GGUF'); assert.equal(readGgufContext(file), null);
  assert.equal(readGgufContext(join(dir, 'missing')), null);
});

test('usage is exposed as a read-only MCP tool', async () => {
  const result = await executeTool('model_usage', { days: 1 });
  assert.equal(result.ok, true); assert.equal(result.periodDays, 1); assert.ok(Array.isArray(result.models));
});

test('a null ledger row does not discard later valid requests', (t) => {
  const dir = temporary(t);
  const first = recordUsage({ model: 'alpha', usage: { prompt_tokens: 2, completion_tokens: 3 } }, dir);
  appendFileSync(join(dir, 'usage', first.at.slice(0, 10) + '.jsonl'), 'null\n');
  recordUsage({ model: 'alpha', usage: { prompt_tokens: 5, completion_tokens: 7 } }, dir);
  const result = readUsage({ home: dir });
  assert.equal(result.invalidRows, 1);
  assert.equal(result.models[0].requests, 2);
  assert.equal(result.models[0].promptTokens, 7);
  assert.equal(result.models[0].completionTokens, 10);
});

test('code --events emits parseable start/request/result and records real API counts', async (t) => {
  const dir = temporary(t); const project = join(dir, 'project'); mkdirSync(project);
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
    req.resume(); req.on('end', () => res.end(JSON.stringify({ model: 'fixture-model', choices: [{ message: { content: JSON.stringify({ action: 'done', summary: 'This project is empty; no source files are available to describe.' }) } }], usage: { prompt_tokens: 44, completion_tokens: 21 } })));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const port = server.address().port;
  writeFileSync(join(dir, 'serve.json'), JSON.stringify({ model: 'fixture-model', port, baseUrl: `http://127.0.0.1:${port}/v1` }));
  const bin = fileURLToPath(new URL('../bin/lehrosol.js', import.meta.url));
  const result = await promisify(execFile)(process.execPath, [bin, 'code', 'Explain this project', '--events', '--port', String(port), '--dryRun', '--maxSteps', '2'], { cwd: project, env: { ...process.env, LEHRO_HOME: dir, NO_COLOR: '1' }, timeout: 60000 });
  const rows = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(rows.some((row) => row.type === 'start'));
  assert.equal(rows.find((row) => row.type === 'request').usage.prompt_tokens, 44);
  assert.equal(rows.at(-1).type, 'result'); assert.equal(rows.at(-1).ok, true);
  assert.equal(rows.at(-1).summary.includes('empty'), true);
  const usage = readUsage({ home: dir });
  assert.equal(usage.models[0].model, 'fixture-model'); assert.equal(usage.models[0].promptTokens, 44);
});
