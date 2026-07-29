import { startStdioServer, startHttpServer } from '../mcp/server.js';
import { ui } from '../core/ui.js';

export function runMcpCommand(subcommand, flags, logger) {
  if (subcommand === 'start') {
    if (flags.http) {
      const port = flags.port ? Number(flags.port) : 4177;
      const host = flags.host || '127.0.0.1';
      const token = flags.token || process.env.LEHRO_MCP_TOKEN || '';
      const endpoint = 'http://' + host + ':' + port;
      startHttpServer({ port, host, token });
      ui.success(
        'LehroSol MCP server listening',
        `${token ? 'Authenticated ' : ''}POST JSON-RPC 2.0 messages to ${endpoint}`,
      );
      ui.info('HTTP transport', 'GET /health for readiness; POST JSON-RPC 2.0 for MCP tools');
      if (!token) {
        ui.warning(
          'Local-only HTTP MCP',
          'Bound to 127.0.0.1 by default. Use --token or LEHRO_MCP_TOKEN for authenticated HTTP.',
        );
      }
    } else {
      startStdioServer();
      ui.info(
        'LehroSol MCP server started on stdio',
        'Point your agent CLI (Claude Code, Codex CLI, Gemini CLI, etc.) at this process.',
      );
    }
    return;
  }
  ui.error('Unknown mcp subcommand: ' + subcommand, 'Try: lehrosol mcp start [--http] [--host 127.0.0.1] [--port 4177] [--token <secret>]');
  process.exitCode = 1;
}
