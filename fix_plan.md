# fix_plan.md

Running backlog for the LehroSol Loop Engine. One item per line.

- [ ] Loop exhausted budget for prompt: blank
- [ ] Add true checkpoint resume for `lehrosol code --continue` so it restores compact action state, not only the previous task text.
- [ ] Replace heuristic `done` validation with explicit completion evidence (changed files, verification commands, and blocker type) shared by code, loop, mission, MCP, and GUI surfaces.
- [ ] Add an end-to-end local-model test harness with a deterministic mock OpenAI-compatible server that exercises tool-step exhaustion and continuation across adapter passes.
- [ ] Profile and cache adapter readiness checks; the Windows full suite currently spends minutes repeatedly probing the same binaries/endpoints.
- [ ] Surface code-lane continuation controls and termination reasons in the GUI/TUI, not only CLI/JSON output.
