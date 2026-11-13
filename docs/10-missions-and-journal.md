# Missions, the Journal, and Self-Tuning

> ← [10 · How to use](10-how-to-use.md) · [Docs home](README.md) · Next: [11 · Improving your workflow](11-improving-your-workflow.md)

Every `lehrosol code` run is a **mission**. Since v3.1.0 each mission is
recorded in a journal at `~/.lehro/journal.json` (cap: 200 entries, newest
first) together with per-file backups, so the agent can learn from its own
history and every run can be rolled back.

## The journal

Each entry stores: mission id, task, ok/failed, steps, duration, retries,
context mode (and whether it was chosen adaptively), changed files, flags,
and the project root.

```
lehrosol missions list            # recent missions
lehrosol missions show --id last  # full detail for one mission
lehrosol missions undo --id last  # restore backups / remove created files
lehrosol missions replay --id m…  # re-run a mission with its saved flags
```

All subcommands accept `--json` for machine-readable output (the IDE's
Missions view is built on `missions list --json`).

## Backups and undo

Before the code agent writes or deletes any file, the ORIGINAL bytes are
snapshotted under `~/.lehro/backups/<mission-id>/`. `missions undo` restores
overwritten files and deletes files the mission created. The first snapshot
wins, so undo always returns the file to its pre-mission state.

## Adaptive context (self-tuning)

When you do not pass `--contextMode` explicitly, the CLI inspects the recent
journal before each mission:

- recent context overflows or repeated retries -> **compact** context
- a healthy streak of short successful missions -> **expanded** context
- otherwise -> **normal**

The chosen mode and its source (`explicit`, `adaptive`, `default`) are
printed in the mission header and recorded in the journal. Overflow errors
are additionally retried in-mission with shrunken observations.

## Plan-first mode

`--plan` (automatic with `--reasoning deep`) asks the model for a short plan
before step 1 so long missions stay on-task. Disable with `--plan=false`.

## Event output and measured usage (unreleased)

`lehrosol code "Inspect this project" --dryRun --events` emits one versioned JSON
record per line. Records include `start`, optional `plan`, `request`, `action`,
`recovery`, and a final `result`; ordinary banners are suppressed. Existing
`--json` output remains a single result object. The desktop can consume these
events when paired with this source version; the published 3.2.0-beta.2 package
does not include this contract.

`lehrosol usage --days 30 --json` reads measured input/output token counts for
instrumented chats, coding missions, and HTTP adapters. The same read-only
result is available through MCP `model_usage`. Records stay in
`LEHRO_HOME/usage/YYYY-MM-DD.jsonl` (default `~/.lehro/usage`), with model,
timestamp, source, counts, and timing. Prompts, answers, and credentials are
excluded. Missing provider counts stay unknown. Reads cover at most 30 UTC
calendar days and 2 MiB per day; `truncated` identifies partial totals and
`invalidRows` identifies skipped records. Cumulative counts do not represent
current context occupancy.

## See also

- [MCP control plane](06-mcp-control-plane.md)
- [How to use](10-how-to-use.md)
- [GUI dashboard](07-gui-dashboard.md)
