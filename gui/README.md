# LehroSol Dashboard (Phase 3)

React + Vite + Tailwind client for the Lehro MCP control plane - the same tool registry the terminal, MCP-connected agent CLIs, and this GUI all share, so work can start in one and continue in the other.

## Run it

```bash
# 1. Start the control plane (from the repo root)
lehrosol gui
# or: lehrosol mcp start --http --port 4177

# 2. In another terminal, start the dashboard
cd gui
npm install
npm run dev
```

Open the printed Vite URL (default http://localhost:5173). The dev server proxies `/rpc` to the control plane at `http://localhost:4177` (override with `LEHRO_CONTROL_PLANE_URL`).

## Panels

- **Doctor** - read-only project health check.
- **Loop Engine** - run a prompt through the Ralph-style loop against any adapter.
- **Adapters** - which agent CLIs (Claude Code, Codex CLI, OpenCode, Gemini CLI, Aider, Goose, Hermes Agent) are installed.
- **Sessions** - browse persisted Loop Engine sessions/checkpoints (SQLite via `node:sqlite`, JSON-file fallback).
- **Orchestrator** - spawn/list/remove git-worktree agent workers.
- **Policy / OWASP** - run the harness policy gate manually.
