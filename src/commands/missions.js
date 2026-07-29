// `lehrosol missions` — the code lane's history, replay, and undo surface.
// Everything here reads the mission journal written by src/commands/code.js.
import { ui } from '../core/ui.js';
import { readJournal, undoMission, journalStats, suggestTuning } from '../core/journal.js';

function emit(result, flags, logger) {
  if (flags.json) {
    if (logger && logger.json) logger.json(result);
    else console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

function findMission(journal, id) {
  if (!id || id === 'last') return journal.missions[0] || null;
  return journal.missions.find((m) => m.id === id) || null;
}

export async function runMissionsCommand(sub = 'list', flags = {}, logger = console) {
  const journal = readJournal();

  if (sub === 'list') {
    const limit = Number(flags.limit || 10);
    const rows = journal.missions.slice(0, limit);
    if (flags.json) return emit({ ok: true, missions: rows, stats: journalStats(journal), tuning: suggestTuning(journal) }, flags, logger);
    ui.sectionHeader('MISSION JOURNAL');
    if (!rows.length) { ui.warning('No missions recorded yet', 'Run one: lehrosol code "describe the task"'); return { ok: true, missions: [] }; }
    for (const m of rows) {
      const mark = m.ok ? '\u2713' : '\u2717';
      console.log(`  ${mark} ${m.id}  ${String(m.at).slice(0, 16).replace('T', ' ')}  [${m.steps ?? '?'} step(s), ${m.durationMs ? (m.durationMs / 1000).toFixed(1) + 's' : '?'}]  ${String(m.task || '').slice(0, 64)}`);
    }
    const tuning = suggestTuning(journal);
    if (tuning.contextMode) ui.keyValue('Adaptive tuning', tuning.reason);
    ui.nextSteps(['Details: lehrosol missions show --id <id>', 'Undo a mission: lehrosol missions undo --id <id>', 'Re-run the last task: lehrosol code --continue']);
    return { ok: true, missions: rows };
  }

  if (sub === 'show') {
    const mission = findMission(journal, flags.id);
    if (!mission) { if (!flags.json) ui.error('No such mission', 'List them: lehrosol missions list'); process.exitCode = 1; return emit({ ok: false, reason: 'not-found' }, flags, logger); }
    if (flags.json) return emit({ ok: true, mission }, flags, logger);
    ui.sectionHeader(`MISSION ${mission.id.toUpperCase()}`);
    ui.keyValue('Task', String(mission.task || ''));
    ui.keyValue('Outcome', mission.ok ? 'completed' : `failed${mission.error ? ` — ${mission.error}` : ''}`);
    ui.keyValue('Steps', String(mission.steps ?? '?'));
    ui.keyValue('Duration', mission.durationMs ? `${(mission.durationMs / 1000).toFixed(1)}s` : '?');
    ui.keyValue('Context mode', `${mission.contextMode || '?'}${mission.contextModeSource === 'adaptive' ? ' (adaptive)' : ''}`);
    ui.keyValue('Resource profile', mission.resourceProfile || '?');
    ui.keyValue('Retries', String(mission.retries || 0));
    ui.keyValue('Project', mission.root || '?');
    ui.keyValue('Files changed', (mission.changedFiles || []).join(', ') || '(none)');
    if (mission.summary) ui.keyValue('Summary', String(mission.summary).slice(0, 300));
    return { ok: true, mission };
  }

  if (sub === 'undo') {
    const mission = findMission(journal, flags.id);
    if (!mission) { if (!flags.json) ui.error('No such mission', 'List them: lehrosol missions list'); process.exitCode = 1; return emit({ ok: false, reason: 'not-found' }, flags, logger); }
    const res = undoMission(mission.id);
    if (!res.ok) { if (!flags.json) ui.error('Nothing to undo', 'This mission has no backup (dry run, or no files were written).'); process.exitCode = 1; return emit({ ok: false, reason: res.reason }, flags, logger); }
    if (!flags.json) {
      ui.success(`Undid mission ${mission.id}`, `${res.restored.length} file(s) restored, ${res.deleted.length} created file(s) removed`);
      if (res.restored.length) ui.keyValue('Restored', res.restored.join(', '));
      if (res.deleted.length) ui.keyValue('Removed', res.deleted.join(', '));
    }
    return emit({ ok: true, ...res }, flags, logger);
  }

  if (sub === 'replay') {
    const mission = findMission(journal, flags.id);
    if (!mission) { if (!flags.json) ui.error('No such mission', 'List them: lehrosol missions list'); process.exitCode = 1; return emit({ ok: false, reason: 'not-found' }, flags, logger); }
    const { runCodeCommand } = await import('./code.js');
    if (mission.root) { try { process.chdir(mission.root); } catch { /* stay in cwd */ } }
    if (!flags.json) ui.keyValue('Replaying', `${mission.id} — ${String(mission.task || '').slice(0, 80)}`);
    return runCodeCommand(mission.task, { ...(mission.flags || {}), ...flags, id: undefined }, logger);
  }

  if (!flags.json) ui.error(`Unknown missions subcommand "${sub}"`, 'Try: list, show, undo, replay');
  process.exitCode = 1;
  return emit({ ok: false, reason: 'unknown-subcommand' }, flags, logger);
}
