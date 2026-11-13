// Quick lane — up / try / arena / scan. The daily-driver commands must be
// honest: real HTTP chat measurement, real vault scan, real help output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chatOnce, formatStats, arenaWinner, formatArenaRows, runScanCommand } = await import('../src/commands/quick.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'lehrosol.js');

test('chatOnce measures latency and tok/s against an OpenAI-compatible server', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.messages.at(-1).content, 'ping');
      assert.equal(req.headers.authorization, 'Bearer k');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }], usage: { prompt_tokens: 8, completion_tokens: 42, total_tokens: 50 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const res = await chatOnce({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k', prompt: 'ping' });
  server.close();
  assert.equal(res.ok, true);
  assert.equal(res.content, 'pong');
  assert.equal(res.tokens, 42);
  assert.equal(res.promptTokens, 8);
  assert.equal(res.totalTokens, 50);
  assert.ok(res.tokPerSec > 0);
  assert.match(formatStats(res), /tok\/s/);
});

test('chatOnce forwards temperature when tuning generation settings', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.max_tokens, 128);
      assert.equal(parsed.temperature, 0.5);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { completion_tokens: 2 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const res = await chatOnce({ baseUrl: `http://127.0.0.1:${port}/v1`, prompt: 'ping', maxTokens: 128, temperature: 0.5 });
  server.close();
  assert.equal(res.ok, true);
});

test('chatOnce reports HTTP failures instead of throwing', async () => {
  const server = createServer((req, res) => {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'bad key' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const res = await chatOnce({ baseUrl: `http://127.0.0.1:${port}/v1`, prompt: 'x' });
  server.close();
  assert.equal(res.ok, false);
  assert.match(res.error, /401/);
  assert.match(res.error, /bad key/);
});

test('chatOnce retries once when the engine drops a dead keep-alive socket', async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    if (calls === 1) { req.socket.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'recovered' } }], usage: { completion_tokens: 5 } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const res = await chatOnce({ baseUrl: `http://127.0.0.1:${port}/v1`, prompt: 'hi' });
  server.close();
  assert.equal(res.ok, true);
  assert.equal(res.content, 'recovered');
  assert.equal(calls, 2, 'failed request was retried exactly once');
});

test('waitForEngine keeps polling until the engine answers', async () => {
  const { waitForEngine } = await import('../src/commands/quick.js');
  let calls = 0;
  const server = createServer((req, res) => {
    calls += 1;
    if (calls < 3) { res.statusCode = 503; res.end('loading'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'jan' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const state = await waitForEngine(`http://127.0.0.1:${port}/v1`, 'k', 30000, { quiet: true, pollMs: 50 });
  server.closeAllConnections?.();
  server.close();
  assert.equal(state.up, true);
  assert.deepEqual(state.models, ['jan']);
  assert.ok(calls >= 3, 'kept polling through warm-up responses');
});

test('waitForPortFree treats any listener as busy until it vanishes', async () => {
  const { waitForPortFree } = await import('../src/commands/quick.js');
  const server = createServer((req, res) => { res.statusCode = 401; res.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/v1`;
  const stillBusy = await waitForPortFree(url, 'k', 900, 200);
  assert.equal(stillBusy, false, 'a 401-answering listener still counts as busy');
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  const freed = await waitForPortFree(url, 'k', 5000, 100);
  assert.equal(freed, true, 'reports free once the listener is gone');
});

test('model matching is not fooled by every file being named model.gguf', async () => {
  const { runningMatches } = await import('../src/commands/quick.js');
  const running = ['D:\\AI MODELS\\LLAMACPP\\MODELS\\JAN-V3.5-4B-Q4_K_XL\\MODEL.GGUF'];
  const jan = { id: 'Jan-v3.5-4B-Q4_K_XL', path: 'D:\\AI Models\\llamacpp\\models\\Jan-v3.5-4B-Q4_K_XL\\model.gguf' };
  const gemma = { id: 'gemma-4-E4B-it-qat-UD-Q2_K_XL', path: 'D:\\AI Models\\llamacpp\\models\\gemma-4-E4B-it-qat-UD-Q2_K_XL\\model.gguf' };
  assert.equal(runningMatches(running, jan), true, 'hot Jan satisfies a request for jan');
  assert.equal(runningMatches(running, gemma), false, 'hot Jan must NOT satisfy a request for gemma');
});

test('displayModelName shows the model folder instead of a generic model.gguf', async () => {
  const { displayModelName } = await import('../src/commands/quick.js');
  assert.equal(displayModelName('D:\\AI MODELS\\LLAMACPP\\MODELS\\JAN-V3.5-4B-Q4_K_XL\\MODEL.GGUF'), 'JAN-V3.5-4B-Q4_K_XL');
  assert.equal(displayModelName('qwopus.gguf'), 'qwopus.gguf');
});

test('parseNetstatPids finds only LISTENING PIDs on the exact port', async () => {
  const { parseNetstatPids } = await import('../src/commands/quick.js');
  const out = [
    '  TCP    0.0.0.0:7000           0.0.0.0:0              LISTENING       19892',
    '  TCP    127.0.0.1:70001        0.0.0.0:0              LISTENING       333',
    '  TCP    0.0.0.0:7000           1.2.3.4:555            ESTABLISHED     444',
    '  TCP    [::]:7000              [::]:0                 LISTENING       19892',
  ].join('\r\n');
  assert.deepEqual(parseNetstatPids(out, 7000), [19892]);
});

test('a silent reasoner cannot win the arena over a model that answered', async () => {
  const rows = [
    { model: 'gemma', ok: true, tokPerSec: 5.5, hasText: false },
    { model: 'jan', ok: true, tokPerSec: 4.9, hasText: true },
    { model: 'broken', ok: false },
  ];
  assert.equal(arenaWinner(rows).model, 'jan', 'visible answer beats faster empty reply');
  const allEmpty = [
    { model: 'a', ok: true, tokPerSec: 2, hasText: false },
    { model: 'b', ok: true, tokPerSec: 3, hasText: false },
  ];
  assert.equal(arenaWinner(allEmpty).model, 'b', 'falls back to speed when nobody answered');
});

test('verifyChatAuth flags a key-protected engine that rejects our key', async () => {
  const { verifyChatAuth } = await import('../src/commands/quick.js');
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer wrong-key');
    res.statusCode = 401;
    res.end('unauthorized: Invalid API Key');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const res = await verifyChatAuth(`http://127.0.0.1:${port}/v1`, 'wrong-key');
  server.close();
  assert.equal(res.ok, false);
  assert.equal(res.unauthorized, true, 'ensureServing relies on this flag to replace a key-rejecting hot engine');
});

test('ensureServing reuses the exact tracked endpoint on the requested port without requiring process ownership', async (t) => {
  const { ensureServing } = await import('../src/commands/quick.js');
  const { rmSync } = await import('node:fs');
  const home = mkdtempSync(join(tmpdir(), 'lehro-tracked-endpoint-'));
  const previousHome = process.env.LEHRO_HOME;
  process.env.LEHRO_HOME = home;
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/fixture/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'tracked-fixture' }] }));
    } else if (req.url === '/fixture/v1/chat/completions') {
      req.resume();
      req.on('end', () => res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  t.after(async () => {
    process.env.LEHRO_HOME = previousHome;
    server.closeAllConnections?.();
    await new Promise((done) => server.close(done));
    assert.ok(home.startsWith(join(tmpdir(), 'lehro-tracked-endpoint-')));
    rmSync(home, { recursive: true, force: true });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/fixture/v1`;
  writeFileSync(join(home, 'serve.json'), JSON.stringify({ model: 'tracked-fixture', port, baseUrl }));
  const result = await ensureServing({ port, apiKey: 'fixture-key', restart: false, showWarmup: false }, { json: true }, console);
  assert.equal(result.ok, true);
  assert.equal(result.reused, true);
  assert.equal(result.baseUrl, baseUrl);
  assert.equal(result.model, 'tracked-fixture');
  assert.deepEqual(paths, ['/fixture/v1/models', '/fixture/v1/chat/completions']);
});

test('a slow warm-up is not treated as a launch failure', async () => {
  const { isLaunchFailure } = await import('../src/commands/quick.js');
  assert.equal(isLaunchFailure({ ok: false, reason: 'port-in-use' }), true);
  assert.equal(isLaunchFailure({ ok: false, reason: 'engine-start-failed' }), true);
  assert.equal(isLaunchFailure({ ok: false, pid: 19892, baseUrl: 'http://localhost:7000/v1' }), false, 'launched-but-still-loading must not count as failure');
  assert.equal(isLaunchFailure({ ok: true }), false);
});

test('chatOnce reports unreachable engines as a clean failure', async () => {
  const res = await chatOnce({ baseUrl: 'http://127.0.0.1:1/v1', prompt: 'x', timeoutMs: 3000 });
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 0);
});

test('arenaWinner picks the highest tok/s among successful rows only', () => {
  const rows = [
    { model: 'a', ok: true, tokPerSec: 5, ms: 2000, tokens: 10, snippet: 'aa' },
    { model: 'b', ok: false, error: 'no fit' },
    { model: 'c', ok: true, tokPerSec: 9, ms: 1000, tokens: 9, snippet: 'cc' },
  ];
  assert.equal(arenaWinner(rows).model, 'c');
  assert.equal(arenaWinner([{ ok: false, model: 'x' }]), null);
  const table = formatArenaRows(rows);
  assert.equal(table.length, 3);
  assert.match(table[1][4], /FAILED: no fit/);
  assert.equal(table[2][3], '9');
});

test('scan discovers GGUFs under LEHRO_MODELS_DIR with zero setup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lehro-quickscan-'));
  const dir = join(root, 'tiny-model-Q4_K_M');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'model.gguf'), Buffer.alloc(2048));
  const prev = process.env.LEHRO_MODELS_DIR;
  process.env.LEHRO_MODELS_DIR = root;
  try {
    let captured = null;
    await runScanCommand({ json: true }, { json: (r) => { captured = r; } });
    assert.ok(captured, 'scan emitted a JSON result');
    assert.equal(captured.ok, true);
    assert.ok(Array.isArray(captured.models));
    assert.ok(captured.models.some((m) => m.id === 'tiny-model-Q4_K_M'), 'fixture model discovered');
  } finally {
    if (prev === undefined) delete process.env.LEHRO_MODELS_DIR;
    else process.env.LEHRO_MODELS_DIR = prev;
  }
});

test('help lists the quick lane and shows the ASCII LS banner', () => {
  const out = spawnSync(process.execPath, [BIN, 'help'], { encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /Quick lane:/);
  assert.match(out.stdout, /try \[model\]/);
  assert.match(out.stdout, /arena/);
  assert.match(out.stdout, /L E H R O S O L/);
});

test('try without a TTY or --prompt fails with guidance instead of hanging', () => {
  const out = spawnSync(process.execPath, [BIN, 'try', '--json'], { encoding: 'utf8', input: '' });
  assert.equal(out.status, 1);
  const parsed = JSON.parse(out.stdout.slice(out.stdout.indexOf('{')));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, 'repl-requires-tty');
});
