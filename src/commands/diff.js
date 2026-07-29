// `lehrosol diff` — inspect what the agent actually changed.
// Sources the git patch recorded at each loop iteration checkpoint.
//   lehrosol diff                     latest session with a recorded diff
//   lehrosol diff --id <session>      a specific session
//   lehrosol diff --iter 2            a specific iteration's snapshot
//   lehrosol diff --stat              summary only
//   lehrosol diff --raw / --json      uncolored patch / machine-readable
import { listSessions, getSession } from '../core/sessionStore.js';
import { colorizeDiff } from '../core/diffCapture.js';
import { ui } from '../core/ui.js';

function checkpointRecord(cp) {
  return (cp && (cp.data || cp)) || {};
}

function extractDiffs(session) {
  const checkpoints = session.checkpoints || [];
  return checkpoints
    .map((cp) => ({ iteration: cp.iteration || checkpointRecord(cp).iteration, diff: checkpointRecord(cp).diff }))
    .filter((entry) => entry.diff && !entry.diff.empty);
}

function findLatestSessionWithDiff() {
  for (const summary of listSessions({ limit: 30 })) {
    const session = getSession(summary.id);
    if (session && extractDiffs(session).length) return session;
  }
  return null;
}

export function runDiffCommand(flags = {}, logger = console) {
  const session = flags.id ? getSession(flags.id) : findLatestSessionWithDiff();
  if (!session) {
    if (flags.id) ui.error('No session found with id ' + flags.id, 'List sessions: lehrosol sessions list');
    else ui.info('No recorded diffs yet', 'Diffs are captured on live runs inside a git repo: lehrosol loop run --prompt "..." --dryRun=false');
    if (flags.id) process.exitCode = 1;
    return;
  }

  const diffs = extractDiffs(session);
  if (!diffs.length) {
    ui.info('No diff recorded for this session', 'The run was dry-run, made no changes, or ran outside a git repo.');
    return;
  }

  const wanted = flags.iter != null ? diffs.find((d) => Number(d.iteration) === Number(flags.iter)) : diffs[diffs.length - 1];
  if (!wanted) {
    ui.error('No diff at iteration ' + flags.iter, `Iterations with diffs: ${diffs.map((d) => d.iteration).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const diff = wanted.diff;

  if (flags.json) {
    logger.json({ sessionId: session.id, iteration: wanted.iteration, diff });
    return;
  }

  ui.sectionHeader('Workspace Diff');
  ui.keyValue('Session', session.id);
  ui.keyValue('Iteration', `#${wanted.iteration} (workspace state after this iteration)`);
  ui.keyValue('Captured', diff.capturedAt || '-');

  if (diff.stat) {
    ui.divider();
    console.log(diff.stat.split('\n').map((l) => '  ' + l).join('\n'));
  }

  if (!flags.stat && diff.patch && diff.patch.trim()) {
    ui.divider();
    const lines = flags.raw ? diff.patch.split('\n') : colorizeDiff(diff.patch);
    console.log(lines.map((l) => '  ' + l).join('\n'));
  }

  if (diff.untrackedFiles && diff.untrackedFiles.length) {
    ui.divider();
    ui.keyValue('New untracked files', String(diff.untrackedFiles.length));
    for (const f of diff.untrackedFiles.slice(0, 20)) console.log('    + ' + f);
    if (diff.untrackedFiles.length > 20) console.log(`    \u2026 and ${diff.untrackedFiles.length - 20} more`);
  }

  if (diff.truncated) ui.warning('Patch truncated for storage', 'Run git diff in the project for the complete patch.');

  ui.nextSteps([
    diffs.length > 1 ? `Other snapshots: --iter ${diffs.map((d) => d.iteration).join(' / --iter ')}` : 'Summary only: lehrosol diff --stat',
    `Full session: lehrosol sessions show --id ${session.id}`,
  ]);
}
