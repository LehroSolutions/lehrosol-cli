# LehroSol CLI

**Short alias: `lehr-sol`**

A free, GPL-3.0-or-later, zero-dependency-core Node.js CLI that unifies **loop engineering** (Ralph-style self-improving loops), **harness engineering** (policy/OWASP verification gates with a built-in scanner), and **orchestration engineering** (git-worktree multi-agent supervision) behind one MCP control plane, so any existing coding agent (Claude Code, Codex CLI, Gemini CLI, OpenCode, Aider, Goose, Hermes Agent) can be driven, scored, and orchestrated from either the terminal or a GUI, with seamless handoff between the two.

## Install

```bash
npm install -g lehrosol-cli
# or
bun install -g lehrosol-cli
# or
curl -fsSL https://get.lehro.dev/install | bash
```

Both `lehrosol` and `lehr-sol` point at the same binary.

## Quick start

```bash
lehrosol up                                       # zero → serving: best-fit local model hosted on :7000
lehrosol try qwopus                               # test-bench chat REPL — latency + tok/s after every reply
lehrosol try --prompt "2+2?"                      # one-shot, scriptable
lehrosol arena --count 2                          # same prompt across your top models — tok/s scoreboard
lehrosol scan --path "D:\\AI Models"              # zero-setup GGUF discovery
lehrosol doctor                                   # read-only health check
lehrosol init                                     # scaffold AGENTS.md / fix_plan.md / .lehrorc.json
lehrosol adapters                                 # which agent CLIs are installed on this machine
lehrosol loop run --prompt "harden the auth endpoint"                 # dry-run by default
lehrosol loop run --prompt "harden the auth endpoint" --agent-adapter claude-code --dry-run=false
lehrosol sessions list                            # every loop run, persisted to ~/.lehro/sessions.sqlite
lehrosol sessions show --id <session-id>
lehrosol orchestrate spawn --count 3              # spawn git-worktree agent workers
lehrosol policy evaluate --branch feature/x --hasTests --reviewCount 1 --owasp-scope llm,web
lehrosol mcp start                                # MCP JSON-RPC server over stdio
lehrosol gui                                      # shared HTTP control plane for terminal <-> GUI handoff
```

Running from a local checkout without installing:

```bash
node bin/lehrosol.js doctor
```

## The GUI dashboard

```bash
lehrosol gui                # starts the shared control plane on :4177
cd gui && npm install && npm run dev   # Vite dev server on :5173
```

The GUI (Doctor / Loop Engine / Adapters / Sessions / Orchestrator / Policy panels) is just another client of the same MCP tool registry the terminal and any MCP-connected agent CLI use, so a loop started in one shows up in the other. See `gui/README.md`.

## Agent adapters

`local` (dry-run, default), `claude-code`, `codex`, `opencode`, `gemini-cli`, `aider`, `goose`, `hermes-agent`. Run `lehrosol adapters` to see which are installed. See `docs/01-architecture.md` for exact invocations.

## Why

See `AGENTS.md` for the project's own operating instructions, and `docs/01-architecture.md` and `docs/02-competitors.md` for the full architecture and competitive positioning.

## License

GPL-3.0-or-later. See `LICENSE`.
