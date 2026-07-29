# Missions, the Journal, and Self-Tuning

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
