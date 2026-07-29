# 18 — Agentic Missions & Guided Onboarding (v3.0.0)

v3.0.0 turns LehroSol from a set of agentic tools into an autonomous agent harness: you state a **goal**, the mission engine plans, executes, verifies, and adapts — with every step graded by the harness and persisted as evidence.

## The mission loop

```
goal → plan (phase graph) → execute (Loop Engine per phase) → verify (Score Agent gate) → adapt (retry → replan → escalate) → report
```

- **Plan** — `planMission()` decomposes the goal into a dependency-ordered phase graph: `recon → implement → verify` (plus optional `harden` and `document` via `--harden` / `--document`). Planning is deterministic and offline-safe.
- **Execute** — each phase runs through `runLoop()` on the selected adapter, so every phase inherits the full harness: tool calling, scoring, policy gates, and session records.
- **Verify** — a phase only passes when the Loop Engine finishes with `stop-success`. Anything else is a failed gate, not a shrug.
- **Adapt** — under `--autonomy full` (live runs), a failed phase climbs the recovery ladder: **retry** once, then **replan** with an amended prompt describing the violation. Adapter-level failures (missing binary/key) escalate immediately — recovery can't fix a missing API key.
- **Report** — missions persist to the run registry (`~/.lehro/runs`) with full event streams: `lehrosol mission status --id <id>`.

## Autonomy policy

| Level | Live execution | Recovery ladder | Use for |
| --- | --- | --- | --- |
| `readonly` | never — dry-run is forced | no | audits, rehearsals, untrusted goals |
| `guarded` (default) | allowed with `--dryRun=false` | fail-fast, no auto-retry | day-to-day supervised work |
| `full` | allowed | retry → replan → escalate | trusted, well-scoped goals |

`readonly` is a hard floor: even `--dryRun=false` cannot override it.

## Commands

```bash
lehrosol onboard                                  # guided first-run: doctor → adapters → recommendation → rehearsal mission
lehrosol mission plan --goal "add rate limiting"   # preview the phase graph
lehrosol mission run  --goal "add rate limiting"   # safe dry-run rehearsal (default)
lehrosol mission run  --goal "add rate limiting" --adapter grok --dryRun=false --autonomy full
lehrosol mission list
lehrosol mission status --id mission-abc123
```

Useful flags for `mission run`: `--adapter <id>`, `--autonomy readonly|guarded|full`, `--maxIterations <n>` (per phase, cap 12), `--harden`, `--document`, `--owaspScope a01,a03`, `--capabilityTier`, `--json`.

## Guided onboarding

`lehrosol onboard` is the world-class first-run path: it runs the doctor, inventories adapter readiness, recommends the best next model (a configured live adapter if you have one, else Grok, else free local Ollama), and finishes by running your **first agentic mission** as a safe readonly rehearsal — zero configuration required. It ends with copy-paste next steps to go live.

## TUI & MCP surfaces

- **HELIX TUI** — `Run agentic mission` is the first quick action in every tier; it prompts for a goal and streams phase progress. Mission history is part of the cockpit snapshot.
- **MCP** — external agents (Claude, Cursor, etc.) get `mission_run` (dry-run by default), `mission_plan`, and `mission_list`, so LehroSol itself becomes a delegable autonomous sub-agent.

## Design guarantees

- Dry-run by default everywhere; live execution is always an explicit opt-in.
- Unknown adapters and autonomy levels fail loudly with fix-it hints — no silent fallbacks.
- Missions are ≤ 5 phases, phases are sequential (`concurrency: 1`), per-phase iterations are capped, and all writes go through the same policy/path-safety layers as `loop`.
- Every mission is replayable evidence: phases, verdicts, sessions, recovery actions, and event timelines are stored atomically in the run registry.
