// Thin JSON-RPC 2.0 client for the Lehro MCP control plane. The GUI talks to
// the exact same tool registry the terminal/CLI and any agent CLI use
// (src/mcp/tools.js), which is what makes GUI <-> terminal handoff seamless.
let nextId = 1;

const BASE_URL = import.meta.env.VITE_LEHRO_CONTROL_PLANE_URL || '/rpc';

export async function rpcCall(method, params) {
  const id = nextId++;
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params || {} })
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || 'RPC error');
  return payload.result;
}

export async function callTool(name, args) {
  const result = await rpcCall('tools/call', { name: name, arguments: args || {} });
  return result && result.structuredContent !== undefined ? result.structuredContent : result;
}

export async function listTools() {
  const result = await rpcCall('tools/list', {});
  return (result && result.tools) || [];
}
