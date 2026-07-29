# Skill: Loop Engineering

> ← [Skills index](README.md) · Full reference: [03 · Loop Engineering](../03-loop-engineering.md)

**Use this skill when:** you're adding or changing anything in `src/loop/`, tuning a loop run's behavior, or debugging why a loop stopped early/late.

## Workflow

1. Read [03 · Loop Engineering](../03-loop-engineering.md) for the state-machine and sequence diagrams.
2. Reproduce the current behavior first: `LEHRO_HOME=/tmp/lehro-test node bin/lehrosol.js loop run --prompt "repro" --agentAdapter local`.
3. Make your change in `src/loop/loop.js` (the loop shape), `src/loop/scoreAgent.js` (grading), or `src/loop/agentMd.js` (context assembly). Keep the module dependency-free (Node builtins only — see [`AGENTS.md`](../../AGENTS.md)).
4. Verify: `node --check src/loop/loop.js` (and any other file you touched), then re-run the repro command above and confirm the session persists: `node bin/lehrosol.js sessions show --id <id>`.
5. If you changed how iterations are scored, also run `node bin/lehrosol.js policy evaluate --branch test --hasTests --reviewCount 1` to confirm the [harness](../04-harness-engineering.md) side still agrees.
6. If the change affects the MCP-visible shape of `loop_run`, update its `inputSchema`/description in `src/mcp/tools.js` too — see [06 · MCP Control Plane](../06-mcp-control-plane.md).
7. Update [03 · Loop Engineering](../03-loop-engineering.md) (and its diagrams, if the state machine changed) and regenerate docs (`npm run docs:build`).

## Common pitfalls

- Forgetting to call `recordCheckpoint()` for a new code path — breaks the GUI's Sessions panel and `sessions show`.
- Bypassing `scanOwaspBasics()`/`evaluatePolicy()` and self-reporting a score instead — defeats the point of the harness gate.
- Adding a new adapter-facing field without updating `src/loop/adapters/shared.js`'s contract — see [skills/adapter-authoring.skill.md](adapter-authoring.skill.md).
