# AGENTS.md — LehroSol CLI (alias: lehr-sol)

This file is the living instruction set for any coding agent (human-directed or autonomous) working on this repo. It also doubles as the seed `AGENT.md` consumed by the built-in Ralph-style Loop Engine (`src/loop/agentMd.js`).

## What this project is

LehroSol CLI (short alias `lehr-sol`) is a free, open-source (Apache-2.0), zero-runtime-dependency Node.js CLI that unifies three previously-separate disciplines into one tool:

1. **Loop engineering** (Ralph-style self-improving loops) — `src/loop/`, driving 7 real agent-CLI adapters plus a `local` dry-run adapter, all sessions/checkpoints persisted via `src/core/sessionStore.js`. Deep dive: `docs/03-loop-engineering.md`.
2. **Harness engineering** (verification gates, policy, OWASP compliance) — `src/harness/`, with OWASP LLM Top-10 (2025) / Web Top-10 / ASVS rule packs and a built-in heuristic scanner (`scanOwaspBasics`). Deep dive: `docs/04-harness-engineering.md`.
3. **Orchestration engineering** (multi-agent, multi-CLI, git-worktree supervisor/worker) — `src/orchestrator/`. Deep dive: `docs/05-orchestration-engineering.md`.

All three are exposed as MCP tools (`src/mcp/`, deep dive `docs/06-mcp-control-plane.md`) so any existing coding agent (Claude Code, Codex CLI, Gemini CLI, OpenCode, Aider, Goose, Hermes Agent, ...) can drive Lehro, and Lehro can drive them. A terminal session and a GUI dashboard (`gui/`, deep dive `docs/07-gui-dashboard.md`) share the same MCP control-plane and SQLite-backed session store, so work can be started in one and continued in the other.

Full docs set starts at `docs/README.md`.

## Blueprints this was assembled from

- `gidevo-api-tool` — commander-free-friendly CLI skeleton pattern, `doctor` (read-only health check) / `workflow` (validate-then-act) dual-mode UX, plugin contract (`name` / `initialize` / `run`), path-safety guard, local auth/secrets file under `~/.lehro/config.json`, `--json` automation output, ESM-first.
- `devTechish-loop-harness` — MCP JSON-RPC server shape (`initialize`, `tools/list`, `tools/call`, `resources/*`, `prompts/*`), self-documenting JSON-Schema tool registry, policy engine with severities/autofix hints, Loop Harness + adapter-aware Score Agent + OWASP scope, SSE streaming, session persistence, React/Vite/Tailwind dashboard.

## Ground rules for agents editing this repo

- Keep `src/core`, `src/mcp`, `src/harness`, `src/loop`, `src/orchestrator` dependency-free (Node builtins only: `node:http`, `node:fs`, `node:child_process`, `node:crypto`, `node:util`, `node:sqlite`). This is what makes `curl | bash`, `bunx`, and `npm i -g` all work instantly with no install step.
- The GUI (`gui/`) is the only place allowed to pull npm dependencies (React, Vite, Tailwind).
- Every new capability should be reachable three ways: as a CLI subcommand, as an MCP tool, and (when relevant) as a GUI action — same underlying function, three surfaces.
- Real agent-CLI adapters (`src/loop/adapters/`) must always shell out with `execFile`/`execFileAsync` and an argument array — never a shell string — and must degrade gracefully (`unavailableResult`) when the binary isn't on PATH instead of throwing.
- Any bug you notice but don't fix now: record it in `fix_plan.md` at the repo root (create if missing) instead of losing the thought.
- When you learn a non-obvious fact about how to build/run/test this project, update this file briefly.
- Never weaken `src/core/pathSafety.js` checks silently — path escapes must be opt-in and logged.
- When you add/change a doc under `docs/`, follow `docs/skills/docs-authoring.skill.md` and run `npm run docs:build` so the `.json`/`.html` counterparts stay in sync.

## Docs & agent-file map

This repo ships one canonical instruction file (this one) plus thin, agent-specific pointer files for every coding-agent CLI that auto-loads its own filename, so every agent's rules stay in sync instead of drifting:

| If you are... | You auto-load | Which points to |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` (repo root) | This file + `docs/claude/AGENTS.md` (Claude-specific deep dive) |
| Gemini CLI | `GEMINI.md` (repo root) | This file + Gemini-specific notes |
| Codex CLI / OpenCode | `AGENTS.md` (this file) — read natively | Nothing further needed |
| Aider / Goose / Hermes Agent | No fixed auto-discovered filename — point them at this file explicitly via their own config/flags | This file |

Full explanation and diagram: `docs/09-agents-and-skills.md`. That page also catalogs every **baked-in workflow skill** under `docs/skills/` (task-scoped `.md` guides for loop engineering, harness verification, orchestration, adapter authoring, GUI work, and docs authoring) — read the relevant skill file before starting focused work in that area.

## Live local-model testing notes (2026-09-07, i5-8265U / UHD-620 / 16 GB, CPU-only)

- Recent llama.cpp builds (WinGet `ggml.llamacpp`, 0.4.0-dev) auto-enable the Vulkan backend on ANY GPU, including integrated ones whose "VRAM" is shared RAM — pinning `-ngl 0` was worth 2–5x tok/s. `serve start` does this automatically on integrated-only machines.
- llama-server defaults to the model's native context; Qwen3-family GGUFs ship 262k, which tries to allocate a multi-GB KV cache and can OOM-exit before binding the port. `serve start` clamps to 4096 unless `--ctxSize` is given.
- Node's global fetch (undici) has a fixed 300 s headersTimeout — a ~5-minute CPU prompt eval dies with an opaque "fetch failed" that `AbortSignal.timeout` cannot prevent. That is why `makeHttpAdapter.js` uses a raw `node:http` request, not fetch.
- `IQ1_S`/`IQ2_XXS`-class quants are ~2.4x slower per token than `Q4_K_M` on AVX2-only CPUs (no AVX512): Qwen3-8B IQ1_S ≈ 1.8 tok/s vs qwen2.5-3B Q4_K_M ≈ 4.3 tok/s (same box, `-t 4`). Prefer Q4_K_M for CPU-only hosts; `vault` fit ratings already prefer it.
- Background load is the benchmark killer: a disguised miner (see fix_plan.md, 2026-09-07) at 100% CPU made a 9B model look 6x slower. Before benchmarking, check `Get-CimInstance Win32_Processor -Prop LoadPercentage` and scan for runaway processes. **Now automatic:** `arena` and `bench` sample CPU load across the run (`cpuLoadSample`) and flag skewed readings; the GUI Test Bench shows the same guard.

## Common commands

Run the suite with `npm test`: its preload gives each test process an isolated temporary `LEHRO_HOME`, and the parent runner cleans up after workers exit. Use `npm test -- test/production-readiness.test.js` for a focused run or `npm test -- --test-name-pattern=pattern` to filter the suite. Direct `node --test` runs must also include `--import ./test/setup.mjs` to avoid modifying the user's state.

Release preparation records the current Git revision and dirty state. Local
uncommitted candidates can be reviewed, but CI rejects source changes after the
prepack documentation build. Release verification also checks any accompanying
manifest's artifact names, byte counts and hashes; checksum-only directories
remain supported. Requested artifacts must be regular files with unique names.

```bash
node bin/lehrosol.js --help
node bin/lehrosol.js doctor
node bin/lehrosol.js adapters
node bin/lehrosol.js mcp start
node bin/lehrosol.js loop run --prompt "harden the auth endpoint"
node bin/lehrosol.js sessions list
node bin/lehrosol.js orchestrate spawn --count 3
node bin/lehrosol.js policy evaluate --hasTests --reviewCount 1 --owasp-scope llm,web
node bin/lehrosol.js gui
npm run docs:build
```
