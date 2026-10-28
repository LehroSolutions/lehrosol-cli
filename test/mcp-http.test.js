import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { startHttpServer } from '../src/mcp/server.js';

test('network-facing MCP requires authentication before opening a listener', () => {
  const previous = process.env.LEHRO_MCP_TOKEN;
  delete process.env.LEHRO_MCP_TOKEN;
  try {
    for (const host of ['0.0.0.0', '::', '192.0.2.1']) {
      assert.throws(() => startHttpServer({ port: 0, host }), /requires.*token/i);
    }
  } finally {
    if (previous === undefined) delete process.env.LEHRO_MCP_TOKEN;
    else process.env.LEHRO_MCP_TOKEN = previous;
  }
});

test('authenticated network binding rejects anonymous clients and accepts its token', async () => {
  const server = startHttpServer({ port: 0, host: '0.0.0.0', token: 'test-token' });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) };
    const anonymous = await fetch(url, options);
    assert.equal(anonymous.status, 401);
    await anonymous.arrayBuffer();
    const authenticated = await fetch(url, { ...options, headers: { ...options.headers, authorization: 'Bearer test-token' } });
    assert.equal(authenticated.status, 200);
    assert.ok(Array.isArray((await authenticated.json()).result.tools));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('HTTP JSON preserves UTF-8 characters split across incoming chunks', async () => {
  const server = startHttpServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const name = 'missing-💡-工具';
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }));
  const split = body.indexOf(Buffer.from('💡')) + 1;
  try {
    const result = await new Promise((resolve, reject) => {
      const req = request(`http://127.0.0.1:${server.address().port}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch (err) { reject(err); }
        });
      });
      req.on('error', reject);
      server.once('request', (incoming) => incoming.once('data', () => req.end(body.subarray(split))));
      req.write(body.subarray(0, split));
    });
    assert.equal(result.error.message, `Unknown tool: ${name}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
