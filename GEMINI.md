# GEMINI.md — Gemini CLI entry point

> Gemini CLI auto-loads `GEMINI.md` from the repo root as hierarchical memory/context on every session. Like `CLAUDE.md`, this file is a short pointer so Gemini CLI stays in sync with every other agent working on this repo instead of getting its own drifting copy of the rules.

**Read `AGENTS.md` first.** It is the canonical, tool-agnostic instruction set (project purpose, ground rules, common commands) shared by every agent and by the Loop Engine's own `AGENT.md` context (`src/loop/agentMd.js`).

For the full agent/skill map — which file every supported coding agent reads, and where each baked-in workflow skill lives — see **`docs/09-agents-and-skills.md`**.

## Gemini-CLI-specific notes

- When Gemini CLI is being driven *by* LehroSol as an agent adapter, it is invoked non-interactively as `gemini --prompt "<prompt>"` (see `src/loop/adapters/geminiCli.js`) — no follow-up turns, do the full unit of work in one pass.
- When you are editing *this repo directly*, follow `AGENTS.md`'s ground rules: keep `src/core`, `src/mcp`, `src/harness`, `src/loop`, `src/orchestrator` dependency-free (Node builtins only), only `gui/` may use npm packages, and every new capability should be reachable as a CLI subcommand + MCP tool (+ GUI action where relevant).
- Verify your own work before finishing: `node --check` on changed `.js` files, then `node bin/lehrosol.js doctor` and a `node bin/lehrosol.js loop run --prompt "smoke test"` if you touched `src/loop/*` or `src/harness/*`.

See also: [AGENTS.md](AGENTS.md) · [docs/09-agents-and-skills.md](docs/09-agents-and-skills.md)
