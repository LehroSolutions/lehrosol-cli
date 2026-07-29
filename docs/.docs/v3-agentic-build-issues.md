# v3.0.0 agentic missions — build issue log

Loop-engineering log for the v3.0.0 pass (mission engine, autonomy policy, onboarding, TUI/MCP integration).

## Issue 1 — TUI quick-actions helper was not exported
- **Symptom:** `test/mission.test.js` failed to import `buildQuickActions` from `src/commands/tui.js` (no such export).
- **Cause:** the quick-action builder is an internal function named `quickActions(mode)`; the test guessed a name and signature.
- **Fix:** exported `quickActions` from `tui.js` and updated the test to call it with `mode` only.
- **Lesson:** verify real export names with `rg '^export'` before writing tests against a module.

## Issue 2 — readonly autonomy needed a hard floor
- **Symptom:** design review: `mission run --autonomy readonly --dryRun=false` could have gone live if dryRun was honored naively.
- **Fix:** `runMission` computes `dryRun = autonomy === 'readonly' ? true : options.dryRun !== false`, so readonly can never be overridden; covered by a dedicated regression test.
- **Lesson:** safety policies must be enforced in the engine, not in flag parsing.

## Issue 3 — recovery ladder must not fight adapter outages
- **Symptom:** retry/replan on `stop-adapter-unavailable` would burn attempts on an unfixable condition (missing key/binary).
- **Fix:** the mission runner breaks out of the recovery ladder immediately on any `stop-adapter*` verdict and escalates with the verdict preserved.
- **Lesson:** classify failures before applying recovery; infrastructure failures escalate, quality failures retry/replan.

## Verification
- `npm run check` clean; `npm test` 66/66 (59 baseline + 7 mission/onboarding/TUI/MCP tests).
- Smokes: `mission plan --json`, `mission run --json` (3 phases stop-success), `onboard --json` (rehearsal mission succeeded, Grok recommended), `mission list --json`.
