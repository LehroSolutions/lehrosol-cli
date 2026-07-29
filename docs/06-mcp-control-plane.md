# 06 · MCP Control Plane

> ← [05 · Orchestration Engineering](05-orchestration-engineering.md) · [Docs home](README.md) · Next: [07 · GUI Dashboard](07-gui-dashboard.md)

## Why MCP

The [Model Context Protocol](https://modelcontextprotocol.io) (JSON-RPC 2.0 over stdio or HTTP) is what lets LehroSol be driven by *any* MCP-aware agent, and what lets the [terminal](01-architecture.md) and [GUI](07-gui-dashboard.md) share one implementation instead of two. `src/mcp/tools.js` defines a single self-documenting tool registry; `src/mcp/server.js` exposes it over stdio (for agent CLIs that speak MCP) and HTTP (default port `4177`, for the GUI and any remote client).

## Tool registry

```mermaid
%%{init: {'theme':'dark', 'themeVariables': {'primaryColor':'#0f1720','primaryTextColor':'#e6faff','primaryBorderColor':'#22d3ee','lineColor':'#22d3ee','secondaryColor':'#111827','tertiaryColor':'#05070a'}}}%%
flowchart LR
    subgraph Registry["TOOL_DEFINITIONS — src/mcp/tools.js"]
        T1[doctor_check]
        T2[policy_evaluate]
        T3[loop_run]
        T4[adapters_list]
        T5[sessions_list]
        T6[sessions_show]
        T7[orchestrate_spawn]
        T8[orchestrate_list]
        T9[orchestrate_remove]
    end
    T1 --> doctorLogic["src/commands/doctorLogic.js"]
    T2 --> policy["src/harness/policy.js + owasp.js"]
    T3 --> loop["src/loop/loop.js"]
    T4 --> adapters["src/loop/adapters/index.js"]
    T5 & T6 --> store["src/core/sessionStore.js"]
    T7 & T8 & T9 --> worktree["src/orchestrator/worktree.js"]
```

| Tool | Backing module | Mirrors CLI command |
| --- | --- | --- |
| `doctor_check` | `src/commands/doctorLogic.js` | `lehrosol doctor` |
| `policy_evaluate` | `src/harness/policy.js`, `src/harness/owasp.js` | `lehrosol policy evaluate` |
| `loop_run` | `src/loop/loop.js` | `lehrosol loop run` |
| `adapters_list` | `src/loop/adapters/index.js` | `lehrosol adapters` |
| `sessions_list` / `sessions_show` | `src/core/sessionStore.js` | `lehrosol sessions list` / `show` |
| `orchestrate_spawn` / `_list` / `_remove` | `src/orchestrator/worktree.js` | `lehrosol orchestrate ...` |

This is the concrete mechanism behind "every capability is reachable three ways" (see [`AGENTS.md`](../AGENTS.md)): CLI subcommand, MCP tool, and GUI action all call the exact same underlying function — there's no separate GUI-only or CLI-only logic to drift out of sync.

## Request lifecycle

```mermaid
%%{init: {'theme':'dark', 'themeVariables': {'primaryColor':'#0f1720','primaryTextColor':'#e6faff','primaryBorderColor':'#22d3ee','lineColor':'#22d3ee','secondaryColor':'#111827','tertiaryColor':'#05070a'}}}%%
sequenceDiagram
    participant C as Client (GUI / agent CLI)
    participant S as src/mcp/server.js
    participant R as Tool registry
    participant F as Backing function

    C->>S: JSON-RPC { method: "initialize" }
    S-->>C: capabilities
    C->>S: JSON-RPC { method: "tools/list" }
    S->>R: listTools()
    R-->>S: 9 tool definitions (name, description, inputSchema)
    S-->>C: tools[]
    C->>S: JSON-RPC { method: "tools/call", params: { name, arguments } }
    S->>R: executeTool(name, arguments)
    R->>F: call backing function
    F-->>R: result
    R-->>S: result
    S-->>C: JSON-RPC result
```

## Transports

| Transport | Used by | Start command |
| --- | --- | --- |
| stdio | External MCP-aware agent CLIs (Claude Code, etc. when configured as an MCP client) | `lehrosol mcp start` |
| HTTP (`:4177` default) | [GUI dashboard](07-gui-dashboard.md), any remote script | `lehrosol mcp start --http` (also started implicitly by `lehrosol gui`) |

## See also

[07 · GUI Dashboard](07-gui-dashboard.md) · [03 · Loop Engineering](03-loop-engineering.md) · [05 · Orchestration Engineering](05-orchestration-engineering.md) · [09 · Agents & Skills Map](09-agents-and-skills.md)
