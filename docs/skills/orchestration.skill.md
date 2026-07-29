# Skill: Orchestration

> ← [Skills index](README.md) · Full reference: [05 · Orchestration Engineering](../05-orchestration-engineering.md)

**Use this skill when:** working on `src/orchestrator/`, debugging a `git worktree` issue, or extending the supervisor's recovery strategies.

## Workflow

1. Read [05 · Orchestration Engineering](../05-orchestration-engineering.md) for the worktree lifecycle and supervisor strategy table.
2. Reproduce against a throwaway repo, never a real one:
   ```bash
   mkdir -p /tmp/orch-test && cd /tmp/orch-test && git init -q && git config user.email a@a.com && git config user.name a && echo hi > README.md && git add . && git commit -qm init
   node /path/to/lehrosol-cli/bin/lehrosol.js orchestrate spawn --count 2
   ```
3. If you change base-branch handling, verify against a repo whose default branch is **not** literally `main` (e.g. `master`) — `baseBranch` must be auto-detected via `git branch --show-current` when not explicitly passed, never hardcoded.
4. Always clean up: `lehrosol orchestrate remove --name <worker-name>` for every worker you spawned during testing, then confirm with `lehrosol orchestrate list`.
5. Run `node --check src/orchestrator/worktree.js src/orchestrator/supervisor.js`.
6. If you add a new recovery strategy to the supervisor, add it to the strategy table in [05 · Orchestration Engineering](../05-orchestration-engineering.md) and regenerate docs (`npm run docs:build`).

## Common pitfalls

- Hardcoding `main` as a default branch (this repo's own bug history — fixed by detecting the current branch instead).
- Forgetting `--force` is required for `git worktree remove` when the worktree has uncommitted changes; the registry should still be cleaned up in the CLI error path so it doesn't leak entries.
- Spawning workers against the real project repo instead of a scratch repo while testing.
