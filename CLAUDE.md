# CLAUDE.md — Claude Code entry point

> Claude Code auto-loads this file from the repo root on every session. This file is intentionally short — it points you at the canonical, shared instructions so Claude Code and every other agent stay in sync instead of drifting apart.

**Read `AGENTS.md` first.** It is the canonical, tool-agnostic instruction set for this repo (project purpose, ground rules, common commands) and is also fed to the Loop Engine as `AGENT.md` context (`src/loop/agentMd.js`). Everything in `AGENTS.md` applies to you.

For a deeper, Claude-Code-specific walkthrough (how the `claude-code` adapter shells out to you, permission modes, output-format contract, and troubleshooting), read **`docs/claude/AGENTS.md`**.

## Claude-Code-specific notes

- When you (Claude Code) are being driven *by* LehroSol as an agent adapter, you are invoked non-interactively as `claude --print --output-format json "<prompt>"` (see `src/loop/adapters/claudeCode.js`). Expect no TTY and no follow-up turns within that call — do the whole unit of work in one response.
- When you are editing *this repo directly* (i.e. a human is driving you in Claude Code against this codebase), you are the coding agent, not the adapter — follow `AGENTS.md`'s ground rules (dependency-free core, `execFile` not shell strings, update `fix_plan.md` for things you notice but don't fix).
- Prefer the built-in verification loop: after making a change, run `node --check <file>` on every `.js` you touched, and if you touched `src/harness/*` or `src/loop/*`, run `node bin/lehrosol.js doctor` and `node bin/lehrosol.js loop run --prompt "smoke test"` before considering the change done.
- Full agent/skill map (which file every supported LLM/CLI reads, and where each baked-in skill lives): `docs/09-agents-and-skills.md`.

See also: [AGENTS.md](AGENTS.md) · [docs/claude/AGENTS.md](docs/claude/AGENTS.md) · [docs/09-agents-and-skills.md](docs/09-agents-and-skills.md)
