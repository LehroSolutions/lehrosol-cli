# Skill: Adapter Authoring

> ← [Skills index](README.md) · Full reference: [08 · Agent Adapters](../08-agent-adapters.md)

**Use this skill when:** adding a new agent-CLI adapter (adapter #9 and beyond) to `src/loop/adapters/`.

## Workflow

1. Read [08 · Agent Adapters](../08-agent-adapters.md) for the shared-contract diagram and the 7 existing examples.
2. Confirm the target CLI has a **non-interactive, single-shot** invocation mode (flags like `--print`, `exec`, `run`, `-p`) — the Loop Engine calls adapters once per iteration and does not manage a multi-turn session inside a single call.
3. Create `src/loop/adapters/<name>.js` using `makeCliAdapter.js`'s factory, following the pattern in `claudeCode.js` or `codex.js`:
   - `bin`: the executable name to look for on `PATH`.
   - `buildArgs(prompt, context)`: return an **argument array**, never a shell string.
   - Reuse `shared.js` for detecting installation and deriving `changedFiles`/`policyInput` from `git diff`.
4. Register it in `src/loop/adapters/index.js`'s `ADAPTERS` map with a stable `id`.
5. Add it to `src/mcp/tools.js`'s `loop_run.inputSchema.properties.agentAdapter.enum` so it's discoverable over MCP too.
6. Verify:
   ```bash
   node bin/lehrosol.js adapters            # confirm it's listed (installed or not)
   node bin/lehrosol.js loop run --prompt "smoke test" --agentAdapter <id> --dryRun=false
   ```
   Test both with the binary present **and** absent from `PATH` — the absent case must degrade gracefully (`unavailableResult`), not throw.
7. Run `node --check src/loop/adapters/<name>.js src/loop/adapters/index.js`.
8. Add a row to the adapter table in [08 · Agent Adapters](../08-agent-adapters.md), and if the tool has its own auto-discovered instructions filename (like `CLAUDE.md`/`GEMINI.md`), consider adding a root pointer file for it and a row in [09 · Agents & Skills Map](../09-agents-and-skills.md). Regenerate docs (`npm run docs:build`).

## Common pitfalls

- Using `exec`/a shell string instead of `execFile` with an argument array — this is exactly the OWASP `injection` check the [harness](../04-harness-engineering.md) flags in other people's code; don't reintroduce it here.
- Not handling the "binary not found" case, which crashes the whole loop instead of degrading one iteration.
- Forgetting the new adapter needs zero new runtime npm dependencies — `src/loop/` must stay dependency-free (see [`AGENTS.md`](../../AGENTS.md)).
