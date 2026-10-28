# Changelog

All notable changes to LehroSol CLI are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Benchmark validity guard**: `arena` and `bench run` now sample background CPU load across the run (`cpuLoadSample`, `src/commands/quick.js`) and attach `cpuLoad` to their JSON payloads — with an explicit warning when load ≥ 60%, because a single runaway background process made a 9B model look 6x slower during live testing (see AGENTS.md notes). The GUI Test Bench in Lehrosol Code shows the same guard.

### Changed
- Publish the CLI as `@lehrosolutions/cli` under the npm organization; executable names remain `lehrosol` and `lehr-sol`. Beta installation instructions use `@beta` explicitly.
- `engrams` now supports `--json` (machine-readable `{ ok, engrams, total }`), consumed by the Lehrosol Code memory panel.

### Fixed
- HTTP MCP rejects remote browser origins and DNS-rebinding hosts on loopback, requires authentication for network bindings, bounds request bodies, and preserves UTF-8 across network chunks.
- Tests isolate state from the user's configuration and clean up worker state after SQLite handles close.
- Release preparation runs on Windows, selects only the newly packed tarball, and verifies checksums beside the artifact. CI publishes that exact tarball using the appropriate beta or stable channel.
- **The Apache-2.0 relicense was incomplete in every user-visible surface.** ADR-0012 and the 3.2.0-beta.1 entry below claim every SPDX identifier was updated in one sweep; that held only for `package.json`, the committed Homebrew formula, and the CLI banner. All 31 generated doc pages still footered `GPL-3.0` (hardcoded in `docs/tools/build-docs.mjs`), the GUI footered `GPL-3.0-or-later`, and both `source:'bundled'` first-party marketplace entries (VS Code companion, Homebrew generator) were labelled GPL-3.0-or-later. All now derive from `package.json`.
- `lehrosol release formula` wrote a hardcoded `license "GPL-3.0-or-later"` into the generated Homebrew formula, silently overwriting the correct committed Apache-2.0 file. It now derives the license from `package.json`.

### Added
- `test/license-compliance.test.js` — regression guard sweeping every shipped surface for surviving GPL identifiers, so a future relicense cannot half-land again. The earlier guard pinned only `pkg.license`, which is exactly why the above survived. Deliberately exempts legal history (`docs/12-adr.md`, this changelog, README, SECURITY) and the competitor license table.

## [3.2.0-beta.1] — 2026-09-06

First public open-beta. Focus: open-source readiness, Windows first-class support, and version consistency.

### Changed
- **Relicensed from GPL-3.0-or-later to Apache-2.0** (ADR-0012). Verbatim Apache 2.0 `LICENSE` with copyright appendix, new `NOTICE` file, and every SPDX identifier updated (`package.json`, Homebrew formula, VS Code extension manifest). Releases ≤ 3.1.0 remain GPL-3.0-or-later.
- **Long-task persistence for local models** — the #1 beta complaint ("local models quit after ~10–20 steps"). The loop harness now (1) challenges premature completions: a final answer with zero tool activity on an action-style task is pushed back (max 2, `BLOCKED:` escape hatch) instead of being accepted, (2) carries prior-pass summaries into each outer-loop iteration so models resume instead of redoing recon, and (3) raises step budgets to 64 steps/pass for local HTTP adapters (24 remote), bounded at 200, with a `LEHRO_TOOL_STEPS` machine-wide override. Backed by `test/loop-persistence.test.js` with a scripted OpenAI-compatible stub engine.
- **Text-form tool-call recovery** (found in live testing with qwen2.5-coder-3b on llama.cpp): small local models emit tool calls as fenced-JSON/`<tool_call>`/bare-JSON *text* instead of the parsed OpenAI `tool_calls` field. The adapter now parses, executes, and feeds results back as plain text — template-agnostic, so any model can act regardless of its chat template. Includes a brace-balanced JSON extractor (naive regex broke on nested arguments) and candidate deduplication.
- **Tool registry failures are honest now**: `read_file`/`edit_file`/`list_dir` on missing paths and `edit_file` with a no-match `find` previously returned `ok:true` with a failure string — the model had no signal to self-correct. They now throw, surfacing as real errors with self-correction hints (`call list_dir to discover the actual layout`).
- **Stall guard**: a model repeating the identical tool call 3× gets a `[HARNESS STALL WARNING]` injected into its conversation demanding a strategy change; runs report `stallWarnings`.
- **BLOCKED-quit abuse closed**: a bare `BLOCKED:` with zero tool activity on an action task is now challenged like any other premature quit (found in live testing — the model quit at step 1 with a fake blocker).
- **`loop run --json` is now machine-clean**: the banner/table/spinner are suppressed in JSON mode (previously stdout mixed UI text with the JSON payload, breaking automation).
- **`llamacpp` adapter auto-discovers a running `lehrosol serve`/`up` engine** from `~/.lehro/serve.json` — `lehrosol vault serve` + `loop run --agentAdapter llamacpp` now works with zero env setup.
- System prompt hardening: explicit COMPLETION CONTRACT, TASK FOCUS (inoculates small models against fix_plan.md fixation observed in live testing), `max_tokens` cap of 1024 per step (prevents context-window burn on rambling models).
- Score Agent default iteration budget aligned to the loop engine's default (8 → 12).
- Version reporting now derives from `package.json` as the single source of truth — the MCP `initialize` `serverInfo.version` (previously hardcoded `3.0.0`) and the CLI banner can no longer drift from the npm version.
- Open-source hygiene: added `CONTRIBUTING.md`, `SECURITY.md`, and this changelog.
- CI now runs the full suite on **both ubuntu and windows** runners (Windows is a first-class target).

### Fixed
- `npm run docs:build` hangs forever on any CRLF-checked-out `.md`: the md→html heading regex `^(#{1,6})\s+(.*)$` never matches when a line ends with `\r` (JS `.` does not match `\r`, so `$` cannot anchor before it). The builder now normalizes CRLF → LF when reading docs, so Windows-first checkouts build identically.
- The CLI banner still advertised `GPL-3.0-or-later` after the Apache-2.0 relicense. The displayed license is now derived from `package.json`'s `license` field (same single-source-of-truth pattern as the version string), so it can never drift again.
- `npm run check` used `find | xargs`, a Unix-only pipeline — it silently skipped the syntax gate on Windows. Replaced with a dependency-free Node script (`scripts/check-syntax.mjs`) that checks every `.js`/`.mjs` under `bin/`, `src/`, `docs/tools/`, and `scripts/` on any OS.
- Adapter readiness probes (`where`/`which` per binary) are now memoized per binary for 60s inside a process; the loop engine and MCP server re-probed the same adapters repeatedly, wasting whole minutes on Windows (fix_plan.md item).

### Added
- `install.ps1` — Windows installer (`-Global` for npm, otherwise a per-user launcher shim for a local clone).
- Windows install instructions in the README.

## [3.1.0] — and earlier

See git history (pre-changelog releases; distributed under GPL-3.0-or-later).
