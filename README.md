# LehroSol CLI

**Short alias: `lehr-sol`**

[CI](https://github.com/LehroSolutions/lehrosol-cli/actions/workflows/ci.yml) · [npm package](https://www.npmjs.com/package/@lehrosolutions/cli) · [GitHub releases](https://github.com/LehroSolutions/lehrosol-cli/releases) · [Release guide](RELEASING.md)

The current release line is **3.2 beta**. Use the explicit `@beta` install command below; a stable release has not been promoted yet.

An open-source (**Apache-2.0**), zero-dependency-core Node.js CLI that unifies **loop engineering** (Ralph-style self-improving loops), **harness engineering** (policy/OWASP verification gates with a built-in scanner), and **orchestration engineering** (git-worktree multi-agent supervision) behind one MCP control plane, so any existing coding agent (Claude Code, Codex CLI, Gemini CLI, OpenCode, Aider, Goose, Hermes Agent) can be driven, scored, and orchestrated from either the terminal or a GUI, with seamless handoff between the two.

## Install

```bash
npm install -g @lehrosolutions/cli@beta
# or
bun install -g @lehrosolutions/cli@beta
```

**Windows:** use the same npm command, or run the installer script from a cloned repository:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
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

The dashboard is currently available from a source checkout; it is not included in the npm package. `lehrosol gui` starts the JSON-RPC control plane, while the separate Vite command starts the dashboard. The GUI (Doctor / Loop Engine / Adapters / Sessions / Orchestrator / Policy panels) is another client of the same MCP tool registry the terminal and any MCP-connected agent CLI use, so a loop started in one shows up in the other. See `gui/README.md`.

The HTTP control plane binds to loopback by default and accepts JSON requests (`Content-Type: application/json`). Binding to a network interface with `mcp start --http --host …` requires `--token` or `LEHRO_MCP_TOKEN`; clients must send `Authorization: Bearer <token>`.

## Agent adapters

`local` (dry-run, default), `claude-code`, `codex`, `opencode`, `gemini-cli`, `aider`, `goose`, `hermes-agent`. Run `lehrosol adapters` to see which are installed. See `docs/01-architecture.md` for exact invocations.

## Why

See `AGENTS.md` for the project's own operating instructions, and `docs/01-architecture.md` and `docs/02-competitors.md` for the full architecture and competitive positioning.

## License

Maintainers: see [RELEASING.md](RELEASING.md) for package verification, first publication, and npm trusted publishing.

Apache License 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

> **Note:** releases ≤ 3.1.0 were distributed under GPL-3.0-or-later; from 3.2.0 onward the project is Apache-2.0 (see ADR-0012 in `docs/12-adr.md`).
