// LehroSol Bench CLI command.
//
// Subcommands:
//   run [--layers=loop,mission,graph] [--prompt="..."]   run all/selected scorecards, persist, show delta vs prior
//   report [--layers=...] [--movers=N]                   pretty-print latest bench with per-layer breakdown + top movers
//   history [--limit=N] [--json]                         list persisted bench runs (newest first)
//   weights [--list|--set layer=N]                       show or change per-layer scoring weights
//   forget [--testId=...]                                clear a per-test correction
//   note --adapter=ID --note="..."                       record a free-form adapter observation
//
// Mirrors the existing mission.js command style so it slots cleanly into
// bin/lehrosol.js, the MCP tool registry, and the TUI quick-actions.

import { ui } from '../core/ui.js';
import { runBench, benchSummary, topMovers, resolveLayers } from '../bench/benchCore.js';
import {
  LAYER_IDS,
  listRuns,
  loadPrefs,
  setLayerWeight,
  recordCorrection,
  forgetCorrection,
  recordAdapterNote,
  correctionFor,
  adapterNotesFor,
} from '../bench/benchStore.js';

const SUBCOMMANDS = ['run', 'report', 'history', 'weights', 'forget', 'note'];

function layerGlyph(score) {
  if (score >= 90) return ui.highlight(score + '%');
  if (score >= 70) return ui.warning(score + '%');
  return ui.error ? ui.error(score + '%') : score + '%';
}

function directionGlyph(direction) {
  if (direction === 'improved') return ui.highlight('+ ' + direction);
  if (direction === 'regressed') return ui.error ? ui.error('- ' + direction) : '- ' + direction;
  return direction;
}

function renderScorecardRow(layer, card) {
  return [layer, layerGlyph(card.score), String(card.passed) + '/' + String(card.total), String(card.failed) + ' failed'];
}

async function runBenchRun(flags, logger) {
  const layers = resolveLayers(flags);
  ui.sectionHeader('LehroSol Bench');
  ui.keyValue('Layers', layers.join(', '));
  ui.keyValue('Prompt', flags.prompt ? String(flags.prompt).slice(0, 80) : '(not supplied)');
  const prefs = loadPrefs();
  ui.keyValue('Weights', Object.entries(prefs.weights).map(([k, v]) => `${k}=${v}`).join('  '));

  const spinner = ui.createSpinner(`Running ${layers.length} scorecard(s)...`);
  spinner.start();
  const result = await runBench({ layers: layers.join(','), prompt: flags.prompt, triggeredBy: 'cli' });
  spinner.stop();

  if (flags.json) {
    logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    return result;
  }

  ui.divider();
  ui.sectionHeader('Scorecards');
  ui.table(
    ['Layer', 'Score', 'Pass/Total', 'Failed'],
    layers.map((layer) => renderScorecardRow(layer, result.scorecards[layer])),
  );
  ui.keyValue('Weighted Score', layerGlyph(result.weightedScore));
  ui.keyValue('Total', `${result.totals.passed}/${result.totals.tests} passed (${result.totals.failed} failed)`);

  if (result.deltas && Object.keys(result.deltas).length) {
    ui.sectionHeader('Delta vs Prior Run');
    ui.table(
      ['Layer', 'Direction', 'Δ pct', 'Δ passed', 'Prior Run'],
      Object.entries(result.deltas).map(([layer, d]) => [
        layer,
        directionGlyph(d.direction),
        String(d.deltaPct),
        String(d.deltaPassed),
        (d.priorRunId || '').slice(0, 24),
      ]),
    );
  } else {
    ui.info('No prior runs to compare against — this is your baseline.', 'Run the bench again after changes to see deltas.');
  }

  ui.nextSteps([
    `Inspect history: lehrosol bench history --limit 10`,
    `Drill into movers: lehrosol bench report --movers 5`,
    `Tune weights: lehrosol bench weights --list`,
    `Run again on a real goal: lehrosol bench run --prompt "${(flags.prompt || 'improve agentic loop').slice(0, 60)}"`,
  ]);
  return result;
}

async function runBenchReport(flags, logger) {
  const summary = benchSummary({ limit: Number(flags.limit || 10) });
  if (flags.json) {
    const moversArg = Math.max(1, Math.min(Number(flags.movers || 5), 20));
    summary.moversByLayer = {};
    for (const layer of (summary.latest && summary.latest.layers ? summary.latest.layers : ['loop', 'mission', 'graph'])) {
      summary.moversByLayer[layer] = topMovers(layer, { limit: moversArg }).movers;
    }
    logger.json ? logger.json(summary) : console.log(JSON.stringify(summary, null, 2));
    return summary;
  }
  ui.sectionHeader('LehroSol Bench — Report');
  if (!summary.runs) {
    ui.info('No bench runs yet', 'Run one: lehrosol bench run');
    return summary;
  }
  const latest = summary.latest;
  ui.keyValue('Latest Run', latest.id);
  ui.keyValue('Latest At', latest.createdAt);
  ui.keyValue('Weighted Score', layerGlyph(latest.weightedScore || 0));
  ui.keyValue('Layers', (latest.layers || []).join(', '));
  ui.sectionHeader('Latest Scorecards');
  const rows = LAYER_IDS.filter((l) => latest.scorecards && latest.scorecards[l]).map((layer) => renderScorecardRow(layer, latest.scorecards[layer]));
  ui.table(['Layer', 'Score', 'Pass/Total', 'Failed'], rows);

  const moverLimit = Math.max(1, Math.min(Number(flags.movers || 5), 20));
  ui.sectionHeader(`Top Movers (last ${moverLimit} per layer)`);
  for (const layer of (latest.layers || LAYER_IDS)) {
    const movers = topMovers(layer, { limit: moverLimit });
    if (!movers.movers.length) continue;
    ui.keyValue(layer, movers.movers.map((m) => `${directionGlyph(m.direction)} ${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct}`).join('  '));
  }

  // Surface the user's active corrections so they see what they've tuned.
  const prefs = loadPrefs();
  const corrEntries = Object.entries(prefs.corrections || {});
  if (corrEntries.length) {
    ui.sectionHeader('Active Test Corrections');
    ui.table(
      ['Test ID', 'Multiplier', 'Reason'],
      corrEntries.map(([id, mult]) => [
        id,
        String(Number(mult).toFixed(2)),
        ((prefs.notes && prefs.notes['correction:' + id]) || []).slice(-1)[0] || '-',
      ]),
    );
  }
  return summary;
}

async function runBenchHistory(flags, logger) {
  const limit = Math.max(1, Math.min(Number(flags.limit || 20), 200));
  const runs = listRuns({ limit: limit });
  if (flags.json) {
    const payload = { count: runs.length, runs: runs.map((r) => ({ id: r.id, createdAt: r.createdAt, layers: r.layers, weightedScore: r.weightedScore, totals: r.totals })) };
    logger.json ? logger.json(payload) : console.log(JSON.stringify(payload, null, 2));
    return payload;
  }
  if (!runs.length) {
    ui.info('No bench runs yet', 'Run one: lehrosol bench run');
    return { count: 0, runs: [] };
  }
  ui.sectionHeader(`Bench History (${runs.length} run${runs.length === 1 ? '' : 's'})`);
  ui.table(
    ['Run ID', 'At', 'Score', 'Layers', 'Passed'],
    runs.map((r) => [r.id.slice(0, 30), (r.createdAt || '').slice(0, 19), layerGlyph(r.weightedScore || 0), (r.layers || []).join(','), `${r.totals?.passed || 0}/${r.totals?.tests || 0}`]),
  );
  ui.nextSteps(['Show details: lehrosol bench report']);
  return { count: runs.length, runs: runs };
}

async function runBenchWeights(flags, logger) {
  const prefs = loadPrefs();
  if (flags.list || (!flags.set && !flags.layer)) {
    if (flags.json) {
      logger.json ? logger.json(prefs.weights) : console.log(JSON.stringify(prefs.weights, null, 2));
      return prefs.weights;
    }
    ui.sectionHeader('Bench Layer Weights');
    ui.table(['Layer', 'Weight'], LAYER_IDS.map((l) => [l, String(prefs.weights[l])]));
    ui.info('Tune a weight', 'lehrosol bench weights --layer loop --value 0.5  (values 0..1)');
    return prefs.weights;
  }
  if (!flags.layer) { ui.error('bench weights requires --layer loop|mission|graph', 'Or pass --list.'); process.exitCode = 1; return null; }
  if (flags.value == null) { ui.error('bench weights --set requires --value 0..1'); process.exitCode = 1; return null; }
  const updated = setLayerWeight(String(flags.layer), Number(flags.value));
  ui.success('Updated weight', `${flags.layer}=${updated.weights[flags.layer]}`);
  return updated.weights;
}

async function runBenchForget(flags, logger) {
  if (!flags.testId) { ui.error('bench forget requires --testId <id>', 'Find ids via lehrosol bench report.'); process.exitCode = 1; return null; }
  const prefs = forgetCorrection(String(flags.testId));
  ui.success('Forgotten correction', String(flags.testId));
  return prefs;
}

async function runBenchNote(flags, logger) {
  if (!flags.adapter) { ui.error('bench note requires --adapter <id>', 'Example: lehrosol bench note --adapter claude-code --note "slow on coding prompts"'); process.exitCode = 1; return null; }
  if (!flags.note) { ui.error('bench note requires --note "..."'); process.exitCode = 1; return null; }
  const prefs = recordAdapterNote(String(flags.adapter), String(flags.note));
  const notes = (prefs.notes && prefs.notes[flags.adapter]) || [];
  ui.success('Recorded adapter note', `${flags.adapter}: ${notes[notes.length - 1]}`);
  return { adapter: flags.adapter, notes: notes };
}

export async function runBenchCommand(subcommand, flags, logger = console) {
  const cmd = subcommand || 'run';
  if (!SUBCOMMANDS.includes(cmd)) {
    ui.error('Unknown bench subcommand: ' + cmd, 'Try: ' + SUBCOMMANDS.join(' | '));
    process.exitCode = 1;
    return null;
  }
  // Reward / penalize short-circuits: --reward foo --reason "..." adds a +0.1
  // correction; --penalize foo --reason "..." adds a -0.1. Both run a quick
  // bench first so the user sees immediate effect on their preferred scores.
  if (flags.reward || flags.penalize) {
    const target = String(flags.reward || flags.penalize);
    const delta = flags.reward ? 0.1 : -0.1;
    const reason = flags.reason || (flags.reward ? 'user reward' : 'user penalize');
    const out = recordCorrection(target, delta, reason);
    const payload = { testId: target, delta, reason, corrections: out.corrections, notes: out.notes };
    if (flags.json) {
      logger.json ? logger.json(payload) : console.log(JSON.stringify(payload, null, 2));
      return payload;
    }
    ui.success(flags.reward ? 'Rewarded test' : 'Penalized test', `${target} ${delta > 0 ? '+' : ''}${delta} (${reason})`);
    return payload;
  }

  switch (cmd) {
    case 'run': return runBenchRun(flags, logger);
    case 'report': return runBenchReport(flags, logger);
    case 'history': return runBenchHistory(flags, logger);
    case 'weights': return runBenchWeights(flags, logger);
    case 'forget': return runBenchForget(flags, logger);
    case 'note': return runBenchNote(flags, logger);
  }
}
