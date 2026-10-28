// Production-hardened MCP control plane.
// Supports JSON-RPC 2.0 over stdio (default) and a loopback HTTP transport for
// GUI/local automation. HTTP defaults to 127.0.0.1, enforces a small body cap,
// exposes GET /health, and requires Bearer auth for network-facing bindings.
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { listTools, executeTool, TOOL_DEFINITIONS } from './tools.js';
import { CORE_VERSION } from '../core/index.js';

const PROTOCOL_VERSION = '2024-11-05';
const MAX_BODY_BYTES = 1024 * 1024;

async function handleRpc(message) {
  const { id, method, params } = message || {};
  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: 'lehrosol-cli', version: CORE_VERSION },
          capabilities: { tools: {} },
        },
      };
    }
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: listTools() } };
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name || !TOOL_DEFINITIONS[name]) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown tool: ' + name } };
      }
      const result = await executeTool(name, args);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } };
    }
    if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } };
    if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } };
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
  } catch (err) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: String((err && err.message) || err) } };
  }
}

export function startStdioServer() {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const response = await handleRpc(message);
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  });
}

function json(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function authorized(req, token) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

function isLoopbackHost(host) {
  return host.toLowerCase() === 'localhost' || host === '::1'
    || (isIP(host) === 4 && host.startsWith('127.'));
}

export function startHttpServer(options = {}) {
  const port = Number(options.port ?? 4177);
  const host = options.host || process.env.LEHRO_MCP_HOST || '127.0.0.1';
  const token = options.token || process.env.LEHRO_MCP_TOKEN || '';
  const loopback = isLoopbackHost(host);
  if (!loopback && !token) {
    throw new Error('HTTP MCP requires --token or LEHRO_MCP_TOKEN when binding outside loopback.');
  }

  const server = createServer((req, res) => {
    if (loopback) {
      // Reject DNS-rebinding hosts and browser requests from remote origins.
      let requestHost;
      let originHost;
      try {
        requestHost = new URL(`http://${req.headers.host}`).hostname;
        if (req.headers.origin) originHost = new URL(req.headers.origin).hostname;
      } catch { json(res, 403, { error: 'invalid host or origin' }); return; }
      const localHost = (value) => isLoopbackHost(value === '[::1]' ? '::1' : value);
      if (!localHost(requestHost) || (originHost && !localHost(originHost))) {
        json(res, 403, { error: 'host or origin not allowed' }); return;
      }
    }
    if (req.method === 'GET' && req.url === '/health') {
      json(res, 200, { ok: true, name: 'lehrosol-cli', version: CORE_VERSION });
      return;
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'POST only' }); return; }
    if (!authorized(req, token)) { json(res, 401, { error: 'unauthorized' }); return; }
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
      json(res, 415, { error: 'application/json required' }); return;
    }

    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        chunks.length = 0;
        if (!res.headersSent) json(res, 413, { error: 'payload too large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (bytes > MAX_BODY_BYTES) return;
      let message;
      try { message = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch { json(res, 400, { error: 'invalid JSON' }); return; }
      const response = await handleRpc(message);
      json(res, 200, response);
    });
  });
  server.listen(port, host);
  return server;
}

export { handleRpc };
