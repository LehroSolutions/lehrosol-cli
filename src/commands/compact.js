// lehrosol compact — the Engram Distillery (smart session compaction).
// lehrosol engrams — browse the distilled long-term memory.
import { ui } from '../core/ui.js';
import { compactSessions, loadEngrams } from '../core/engrams.js';
import { backend, storeSizeBytes, listSessions } from '../core/sessionStore.js';

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function verdictLabel(v) {
  if (v === 'stop-success') return 'PASS';
  if (v === 'stop-budget-exhausted') return 'BUDGET';
  if (v === 'stop-adapter-error') return 'ERROR';
  if (v === 'stop-adapter-unavailable') return 'OFFLINE';
  return v || '-';
}

export function runCompactCommand(flags, logger) {
  const apply = flags.apply === true;
  const keep = flags.keep != null ? Number(flags.keep) : 8;

  ui.sectionHeader('Engram Distillery');
  console.log(`  Store: ${backend()} · ${fmtBytes(storeSizeBytes())} · ${listSessions({ limit: 200 }).length} session(s) on disk`);
  console.log(`  Policy: keep the newest ${keep} full session(s), distill the rest into engrams (lessons).`);
  console.log();

  const report = compactSessions({ keep, apply });

  if (!report.distilled) {
    console.log('  Nothing to distill — every finished session is inside the keep window.');
    ui.nextSteps([
      'Shrink the window: lehrosol compact --keep 3 --apply',
      'Browse existing memory: lehrosol engrams',
    ]);
    return;
  }

  ui.table(
    ['Session', 'Project', 'Adapter', 'Verdict', 'Lesson'],
    report.engrams.map((e) => [
      String(e.id).slice(0, 8),
      (e.project || '-').slice(0, 24),
      e.adapter,
      verdictLabel(e.finalVerdict),
      e.lesson.length > 54 ? e.lesson.slice(0, 54) + '…' : e.lesson,
    ])
  );

  console.log();
  if (report.applied) {
    console.log(`  ${ui.highlight('Distilled:')} ${report.distilled} session(s) → engrams · store ${fmtBytes(report.bytesBefore)} → ${fmtBytes(report.bytesAfter)}`);
    console.log(`  ${ui.highlight('Memory book:')} ${report.engramsTotal} engram(s) total — lessons now feed future runs as field notes.`);
    ui.nextSteps([
      'Browse the memory book: lehrosol engrams',
      'Run in a known project to see field notes injected: lehrosol loop run --prompt "..."',
    ]);
  } else {
    console.log(`  ${ui.highlight('Preview only')} — ${report.distilled} session(s) would be distilled, ${report.keptFull} kept in full.`);
    ui.nextSteps([
      `Execute the distillation: lehrosol compact --apply --keep ${keep}`,
      'Browse existing memory: lehrosol engrams',
    ]);
  }
}

export function runEngramsCommand(flags, logger) {
  const emit = (payload) => {
    if (logger && logger.json) logger.json(payload);
    else console.log(JSON.stringify(payload, null, 2));
  };
  const row = (e) => ({
    id: e.id,
    project: e.project,
    adapter: e.adapter,
    finalVerdict: e.finalVerdict,
    diffSummary: e.diffSummary,
    lesson: e.lesson,
    distilledAt: e.distilledAt,
  });
  const book = loadEngrams();
  const limit = Math.max(1, Number(flags.limit || 15));
  const recent = [...book]
    .sort((a, b) => String(b.distilledAt || '').localeCompare(String(a.distilledAt || '')))
    .slice(0, limit);

  // Machine-readable form (the GUI dashboard's memory panel consumes this).
  if (flags.json) {
    return emit({ ok: true, engrams: recent.map(row), total: book.length });
  }

  ui.sectionHeader('Engram Memory');
  if (!book.length) {
    console.log('  No engrams yet. Distill finished sessions into lessons with: lehrosol compact --apply');
    ui.nextSteps(['Preview what would be distilled: lehrosol compact']);
    return;
  }

  ui.table(
    ['Project', 'Adapter', 'Verdict', 'Changed', 'Lesson'],
    recent.map((e) => [
      (e.project || '-').slice(0, 24),
      e.adapter,
      verdictLabel(e.finalVerdict),
      (e.diffSummary || '-').slice(0, 24),
      e.lesson.length > 50 ? e.lesson.slice(0, 50) + '…' : e.lesson,
    ])
  );
  console.log();
  console.log(`  ${book.length} engram(s) in the memory book. The newest lessons per project auto-inject into loop runs as FIELD NOTES.`);
  ui.nextSteps([
    'Distill more history: lehrosol compact --apply',
    'See memory working: lehrosol loop run --prompt "..." (check the Field Notes row)',
  ]);
}
