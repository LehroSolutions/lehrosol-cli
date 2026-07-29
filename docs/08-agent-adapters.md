# 08 · Agent Adapters

> ← [07 · GUI Dashboard](07-gui-dashboard.md) · [Docs home](README.md) · Next: [09 · Agents & Skills Map](09-agents-and-skills.md)

## The shared contract

Every adapter in `src/loop/adapters/` is built from one factory, `makeCliAdapter.js`, so the [Loop Engine](03-loop-engineering.md) never needs to know which specific CLI it's talking to — it just gets `{ changedFiles, policyInput, summary }` back from whichever adapter is selected.

```mermaid
%%{init: {'theme':'dark', 'themeVariables': {'primaryColor':'#0f1720','primaryTextColor':'#e6faff','primaryBorderColor':'#22d3ee','lineColor':'#22d3ee','secondaryColor':'#111827','tertiaryColor':'#05070a'}}}%%
flowchart LR
    LOOP["Loop Engine"] --> IDX["adapters/index.js\nADAPTERS registry"]
    IDX --> FACT["makeCliAdapter.js\n(shared factory)"]
    FACT --> C1[claudeCode.js]
    FACT --> C2[codex.js]
    FACT --> C3[opencode.js]
    FACT --> C4[geminiCli.js]
    FACT --> C5[aider.js]
    FACT --> C6[goose.js]
    FACT --> C7[hermesAgent.js]
    LOOP --> C8[local.js\n(always available, no exec)]
    C1 & C2 & C3 & C4 & C5 & C6 & C7 -->|execFile, arg array\nnever a shell string| BIN[("external CLI binary\non PATH")]
    BIN -->|git diff| DIFF["shared.js: deriveChangedFiles()"]
    DIFF --> POLICY["policyInput\n→ Harness"]
```

## Every adapter, side by side

| id | bin | invocation | notes |
| --- | --- | --- | --- |
| `local` | (none) | n/a | Always-on dry-run/demo adapter; no external process |
| `claude-code` | `claude` | `claude --print --output-format json "<prompt>"` | See [docs/claude/AGENTS.md](claude/AGENTS.md) for the deep dive |
| `codex` | `codex` | `codex exec "<prompt>"` | |
| `opencode` | `opencode` | `opencode run "<prompt>"` | 75+ underlying model providers |
| `gemini-cli` | `gemini` | `gemini --prompt "<prompt>"` | |
| `aider` | `aider` | `aider --message "<prompt>" --yes-always` | Aider auto-commits; the loop's `fix_plan.md` bookkeeping coexists with Aider's own git workflow |
| `goose` | `goose` | `goose run --text "<prompt>"` | Best-effort flag, Rust-based non-Node agent runtime |
| `hermes-agent` | `hermes` | `hermes send "<prompt>"` | Chat/channel-first; its retry/replan/decompose ideas also inform the [Orchestrator's supervisor](05-orchestration-engineering.md) |

Run `lehrosol adapters` to see which are actually installed on the current machine.

## Graceful degradation

If an adapter's binary isn't found on `PATH`, it returns an `unavailableResult` instead of throwing — the loop iteration becomes a no-op with a clear "not found" summary rather than crashing. This is deliberate: a partially-installed machine (e.g. only `claude` installed, not `aider`) should still be able to run `lehrosol doctor` and `lehrosol loop run --agentAdapter local` without errors.

## Safety

Every real adapter shells out with `execFile`/`execFileAsync` and an **argument array**, never a shell string — this is exactly the OWASP `injection` check from [04 · Harness Engineering](04-harness-engineering.md) applied to LehroSol's own code, not just the code it grades.

## Adding a new adapter

See [skills/adapter-authoring.skill.md](skills/adapter-authoring.skill.md) for the step-by-step workflow any agent (or human) can follow to add adapter #9.

## See also

[03 · Loop Engineering](03-loop-engineering.md) · [09 · Agents & Skills Map](09-agents-and-skills.md) · [docs/claude/AGENTS.md](claude/AGENTS.md)

## Adapter kinds: CLI, HTTP, and custom

As of the interactivity upgrade, adapters come in three kinds and are all listed by `lehrosol adapters` and inside the HELIX cockpit's **Agent Adapters** panel:

| Kind | Factory | Examples | Ready when |
| --- | --- | --- | --- |
| `cli` | `makeCliAdapter.js` | `claude-code`, `codex`, `opencode`, `gemini-cli`, `aider`, `goose`, `hermes-agent`, `cursor`, `qwen`, `qoder`, `zencoder`, `amp` | the adapter is launchable from the current shell (npm/Windows shims included) |
| `http` | `makeHttpAdapter.js` | `ollama` (local, keyless), `nvidia` (NIM), plus any OpenAI-compatible endpoint | local server reachable, or the API key env var is set |
| `builtin` | `local.js` | `local` (dry-run engine) | always |

### OpenAI-compatible HTTP adapters (Ollama, NVIDIA, and any endpoint)

`makeHttpAdapter.js` speaks the OpenAI `/chat/completions` protocol with **function/tool calling**, so it drives essentially any open-source stack:

- **Ollama** — run Llama, Qwen, DeepSeek, Mistral, Gemma locally. Keyless. Env: `LEHRO_OLLAMA_URL` (default `http://localhost:11434/v1`), `LEHRO_OLLAMA_MODEL` (default `qwen2.5-coder:7b`).
- **NVIDIA NIM** — Nemotron / Llama-Nemotron / DeepSeek / Qwen from `build.nvidia.com`. Env: `NVIDIA_API_KEY`, `LEHRO_NVIDIA_URL`, `LEHRO_NVIDIA_MODEL`.
- **Anything else** — vLLM, LM Studio, llama.cpp server, Groq, Together, Mistral, Fireworks, OpenRouter — declare a custom adapter (below).

The adapter runs a bounded tool-calling loop: it advertises the [tool registry](#frontier-tool-calling) to the model, executes each requested tool inside the project sandbox, feeds results back, and repeats until the model returns a final answer or the step budget is exhausted — then derives a `policyInput` from the git diff for the Score Agent, exactly like the CLI adapters.

### Custom adapters — usable with ANY open-source agent

No code change is needed to add an agent. Declare adapters in `<project>/.lehrorc.json` (`{ "adapters": [ ... ] }`) or `~/.lehro/adapters.json`:

```json
{
  "adapters": [
    { "id": "my-cli",  "label": "My Agent", "kind": "cli",  "bin": "my-agent", "args": ["run", "--prompt", "{prompt}"] },
    { "id": "my-llm",  "label": "My Model", "kind": "http", "baseUrl": "http://localhost:8000/v1", "model": "my-model", "apiKeyEnv": "MY_API_KEY" }
  ]
}
```

`{prompt}` is substituted at run time. Custom adapters appear alongside the built-ins everywhere.

## Frontier tool calling

`src/loop/tools/registry.js` is a zero-dependency, cwd-sandboxed tool surface exposed to any tool-calling model in OpenAI schema form. Every filesystem tool is guarded by `assertInsideRoot()` (path-escape attempts are refused), and shell execution is **deny-by-default**:

| Tool | Purpose | Guardrail |
| --- | --- | --- |
| `read_file` / `write_file` / `edit_file` | inspect + modify project files | root-sandboxed, size-capped |
| `list_dir` / `search_text` | navigate the codebase | root-sandboxed, result-capped |
| `git_diff` | review pending changes | read-only |
| `run_tests` | run `npm test` | timeout + buffer cap |
| `run_command` | arbitrary shell | **disabled** unless `LEHRO_TOOLS_ALLOW_EXEC=1` |

Run a local OSS model with tool calling end-to-end:

```bash
ollama serve &                       # or LM Studio / vLLM / llama.cpp
lehrosol loop run --prompt "add a test for the parser" --agentAdapter ollama --dryRun=false
```


## Adapter correctness audit — live means live

After testing the HELIX cockpit against real adapters, the adapter layer was corrected so the UI no longer reports a fake live run when the selected adapter is not actually ready.

### Fixes from the live-adapter audit

| Issue seen in cockpit | Root cause | Fix |
| --- | --- | --- |
| NVIDIA NIM ran a local dry-run when no `NVIDIA_API_KEY` was set | The TUI silently converted unconfigured live adapters into smoke tests | The adapter panel now shows setup instructions and refuses to pretend a live run happened |
| OpenCode showed `CONFIGURED` but failed with `spawn opencode ENOENT` | PATH detection found a command name, but `execFile()` could fail on npm/Windows shim launch | CLI adapters now resolve the actual command and launch npm `.cmd`/`.bat` shims through `cmd.exe` on Windows |
| Qwen Code used the wrong headless flag | Current Qwen Code docs use `qwen -p "..."` | The adapter now runs `qwen -p "<prompt>"` |
| Qoder was confused with Qodo | Qoder's real CLI is `qodercli`, installed via `@qoder-ai/qodercli` | The default adapter is now `qoder` → `qodercli -p "<prompt>"`; the unverified Qodo adapter was removed from the default registry |

### Current researched defaults

| Adapter | Install | Live/headless command |
| --- | --- | --- |
| OpenCode | follow OpenCode installer / npm/bun/brew | `opencode run "<prompt>"` |
| Qwen Code | `npm install -g @qwen-code/qwen-code@latest` | `qwen -p "<prompt>"` |
| Qoder CLI | `npm install -g @qoder-ai/qodercli` | `qodercli -p "<prompt>"` |
| Ollama | `ollama serve` plus a pulled model | OpenAI-compatible `/v1/chat/completions` with tool calling |
| NVIDIA NIM | set `NVIDIA_API_KEY` | OpenAI-compatible `/v1/chat/completions` with tool calling |

If an adapter is not ready, LehroSol now surfaces the exact setup command instead of marking the attempt as a successful smoke test.

## First-class adapter configuration

LehroSol now has a real adapter configuration surface instead of relying only on environment variables or PATH guesses.

### Commands

```bash
lehrosol config wizard
lehrosol config doctor
lehrosol config list
lehrosol config show --adapter nvidia
lehrosol config set --adapter nvidia --apiKey <key> --model nvidia/llama-3.1-nemotron-70b-instruct
lehrosol config set --adapter opencode --bin C:\\path\\to\\opencode.cmd
lehrosol config set --adapter ollama --baseUrl http://localhost:11434/v1 --model qwen2.5-coder:7b
lehrosol config unset --adapter nvidia
```

Saved configuration lives in `~/.lehro/config.json` with `0600` permissions where supported. Human-facing command output masks secret values; the saved file intentionally stores the key locally so the adapter can run without forcing users to re-export environment variables every shell session.

### Supported local model endpoints

| Adapter | Default endpoint | Typical setup |
| --- | --- | --- |
| `ollama` | `http://localhost:11434/v1` | `ollama serve` and `ollama pull qwen2.5-coder:7b` |
| `lmstudio` | `http://localhost:1234/v1` | Start LM Studio local server |
| `vllm` | `http://localhost:8000/v1` | Start a vLLM OpenAI-compatible server |
| `localai` | `http://localhost:8080/v1` | Start LocalAI server |

All of these use the same OpenAI-compatible tool-calling adapter, so local models can call the LehroSol tool registry (`read_file`, `edit_file`, `run_tests`, etc.) within the project sandbox.

### CLI adapters with saved binary paths

If a command exists but the launcher rejects it, configure the exact executable/shim path:

```bash
lehrosol config set --adapter opencode --bin C:\\Users\\you\\AppData\\Roaming\\npm\\opencode.cmd
lehrosol config set --adapter codex --bin codex
lehrosol config set --adapter claude-code --bin claude
```

The adapter layer resolves saved paths first, then `LEHRO_<ADAPTER>_BIN`, then PATH.


## xAI Grok models

LehroSol includes a first-class **Grok** adapter against xAI's OpenAI-compatible API:

```bash
lehrosol config set --adapter grok --apiKey <XAI_API_KEY> --model grok-4.5
lehrosol loop run --prompt "inspect this repo and suggest one improvement" --agentAdapter grok --dryRun=false
```

| Setting | Default |
| --- | --- |
| Endpoint | `https://api.x.ai/v1` |
| Env key | `XAI_API_KEY` |
| Model | `grok-4.5` (override with `LEHRO_GROK_MODEL` or saved config) |
| Tool calling | yes — same sandboxed tool registry as Ollama/NVIDIA |

Aliases: `grok`, `xai`, `x-ai`, `grok-4`, `grok-4.5` all normalize to the `grok` adapter.


## Model profiles and endpoint probes (v1.2.0)

```bash
lehrosol models list
lehrosol models use --profile grok-4.5 --apiKey <XAI_API_KEY>
lehrosol models current
lehrosol models test --adapter grok
```

`models test` performs a bounded authenticated `GET /models` probe for HTTP providers. CLI adapters are checked through executable resolution. This separates **configured** from **actually reachable** without running an agent task or modifying project files.

Live loops now fail fast: unknown adapters are rejected, and unavailable/erroring adapters stop after one iteration with an explicit adapter verdict rather than entering the normal Score Agent loop.
