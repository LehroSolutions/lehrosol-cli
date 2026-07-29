# 17 · Phase 4, Phase 5 & Full-Potential Layer

> [Docs home](README.md) · [Orchestration](05-orchestration-engineering.md) · [MCP](06-mcp-control-plane.md)

## Phase 4 — supervisor scale-out

- `supervise plan|run|list|status`: validates a dependency DAG, computes execution waves, bounds concurrency, persists events/results under `~/.lehro/runs`, and can isolate tasks in git worktrees.
- `panes plan|launch`: builds safe command-array pane plans and launches tiled tmux sessions without shell-string interpolation.
- `marketplace list|info|install|installed`: reviewed built-in catalog plus checksum-mandatory local plugin installation. Catalog receipts never download or execute code implicitly.
- MCP tools: `supervise_plan`, `marketplace_list`, and existing orchestration tools.

```bash
lehrosol supervise plan
lehrosol supervise run --spec graph.json --adapter grok --dryRun=false --worktrees
lehrosol panes launch --count 3 --adapter grok --prompt "try three approaches"
lehrosol marketplace list
```

## Phase 5 — trusted distribution and editor handoff

- `release manifest|verify|formula|sign`: SHA-256 checksums, CycloneDX SBOM, in-toto/SLSA-style provenance, Homebrew formula generation, optional detached GPG signatures.
- `scripts/release.mjs`: one-command `npm pack` plus integrity bundle.
- `.github/workflows/ci.yml` and `release.yml`: test/package/release automation with npm provenance.
- `completions bash|zsh|fish|powershell`.
- `ide install --editor vscode|zed|jetbrains|all` creates project-local tasks/MCP settings.
- Bundled `extensions/vscode/` companion commands for HELIX, doctor, and supervisor.

## Beyond the roadmap

- `learn report`: deterministic session analytics, adapter success rates, recurring violations, and improvement recommendations.
- `support create`: redacted support bundle with runtime, doctor, adapter, session, worktree, and config context plus SHA-256.
- HELIX advanced Quick Actions expose supervisor plans, marketplace, learning reports, and release integrity.
- Task and marketplace safety limits: max graph size/concurrency, fail-fast DAG execution, root-contained local plugins, mandatory SHA-256 verification, and no implicit remote code execution.

## Verification

```bash
npm run check
npm test
npm run docs:build
npm pack --dry-run
node scripts/release.mjs dist
```
