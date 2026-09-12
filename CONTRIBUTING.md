# Contributing to LehroSol CLI

Thanks for your interest in contributing! LehroSol is Apache-2.0 licensed and every contribution is welcome — bug reports, docs, adapters, and core features alike.

## Getting started

```bash
git clone https://github.com/LehroSolutions/lehrosol-cli.git
cd lehrosol-cli
node bin/lehrosol.js doctor     # read-only health check — never modifies files
npm test                        # full suite (~3 min)
npm run check                   # node --check over all source files
```

No `npm install` needed — the core is zero-runtime-dependency by design (Node ≥ 20, builtins only). The web GUI (`gui/`) is the only place allowed npm dependencies.

## Ground rules (enforced by review)

1. **Zero runtime dependencies in the core.** `src/core`, `src/mcp`, `src/harness`, `src/loop`, `src/orchestrator` may only use Node builtins. This is what makes `curl | bash`, `bunx`, and `npm i -g` all work with no install step.
2. **Every capability has three surfaces** where relevant: CLI subcommand, MCP tool, GUI action — same underlying function.
3. **Adapters shell out safely.** Real agent-CLI adapters must use `execFile`/`execFileAsync` with an argument array — never a shell string — and must degrade gracefully (`unavailableResult`) when the binary isn't on PATH.
4. **Never weaken `src/core/pathSafety.js`** silently. Path escapes must be opt-in and logged.
5. **Windows is a first-class target.** Avoid Unix-only shell constructs in scripts and tests; CI runs the full suite on both ubuntu and windows.
6. **Docs are generated.** Edit only `.md` files under `docs/`, then run `npm run docs:build` so the `.json`/`.html` counterparts stay in sync (see `docs/skills/docs-authoring.skill.md`).
7. **Bugs you notice but don't fix** go into `fix_plan.md` at the repo root, not into a lost thought.

## Testing your change

- `node --check` every `.js` you touched (or just run `npm run check`).
- Add or extend a regression test under `test/` for any bug fix — `node --test "test/*.test.js"` is plain Node, no test framework to install.
- If you touched `src/loop/*` or `src/harness/*`, run `node bin/lehrosol.js doctor` and a smoke `node bin/lehrosol.js loop run --prompt "smoke test"`.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
