# Skills index

> ← [09 · Agents & Skills Map](../09-agents-and-skills.md) · [Docs home](../README.md)

Each file here is a short, task-scoped workflow (a "skill") any agent can be pointed at to do one specific job in this repo end to end, without needing the full [`AGENTS.md`](../../AGENTS.md) re-read every time. All skills assume `AGENTS.md`'s ground rules are already in effect.

```mermaid
%%{init: {'theme':'dark', 'themeVariables': {'primaryColor':'#0f1720','primaryTextColor':'#e6faff','primaryBorderColor':'#22d3ee','lineColor':'#22d3ee','secondaryColor':'#111827','tertiaryColor':'#05070a'}}}%%
flowchart LR
    AGENTS["AGENTS.md\n(ground rules)"] --> S1[loop-engineering.skill.md]
    AGENTS --> S2[harness-verification.skill.md]
    AGENTS --> S3[orchestration.skill.md]
    AGENTS --> S4[adapter-authoring.skill.md]
    AGENTS --> S5[gui-dashboard.skill.md]
    AGENTS --> S6[docs-authoring.skill.md]
```

| Skill | File |
| --- | --- |
| Loop engineering | [loop-engineering.skill.md](loop-engineering.skill.md) |
| Harness verification | [harness-verification.skill.md](harness-verification.skill.md) |
| Orchestration | [orchestration.skill.md](orchestration.skill.md) |
| Adapter authoring | [adapter-authoring.skill.md](adapter-authoring.skill.md) |
| GUI dashboard | [gui-dashboard.skill.md](gui-dashboard.skill.md) |
| Docs authoring | [docs-authoring.skill.md](docs-authoring.skill.md) |
