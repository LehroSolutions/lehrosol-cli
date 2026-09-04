// LehroSol Bench — orchestrator. Runs all three scorecards (loop, mission,
// graph), computes the weighted total using the user's tuned weights,
// persists the run, and reports per-layer deltas vs the previous run. This
// is the file `lehrosol bench run` and the `bench_run` MCP tool call into.

import { runGraphBench } from './benchGraph.js';
import { runLoopBench } from './benchLoop.js';
import { runMissionBench } from './benchMission.js';
import { loadPrefs, savePrefs, saveRun, deltaVsPrior, listRuns, LAYER_IDS } from './benchStore.js';

const LAYER_RUNNERS = {
  graph: runGraphBench,
  loop: runLoopBench,
  mission: runMissionBench,
};

// Parse --layers=loop,mission,graph (or "all") from caller-supplied flags.
// Returns an ordered array of layer ids to run.
export function resolveLayers(flags) {
  const requested = String(flags && flags.layers || 'all').trim().toLowerCase();
  if (requested === 'all' || requested === '') return [...LAYER_IDS];
  const parts = requested.split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = parts.filter((p) => !LAYER_IDS.includes(p));
  if (unknown.length) throw new Error(`Unknown bench layer(s): ${unknown.join(', ')}. Use one or more of: ${LAYER_IDS.join(', ')}.`);
  // Preserve canonical order so the report layout is stable.
  return LAYER_IDS.filter((id) => parts.includes(id));
}

export async function runBench(flags = {}) {
  const layers = resolveLayers(flags);
  const prefs = loadPrefs();
  const scorecards = {};
  for (const layer of layers) {
    const runner = LAYER_RUNNERS[layer];
    scorecards[layer] = await runner();
  }

  // Weighted total using current preferences.
  const weightedTotal = layers.reduce((sum, layer) => {
    const w = Number(prefs.weights[layer] || 0);
    const card = scorecards[layer];
    return sum + (card ? card.score * w : 0);
  }, 0);
  const totalWeight = layers.reduce((s, l) => s + Number(prefs.weights[l] || 0), 0) || 1;
  const normalizedScore = Math.round(weightedTotal / totalWeight);

  // Per-layer deltas vs prior runs.
  const deltas = {};
  const placeholder = { id: 'pending', createdAt: new Date().toISOString(), scorecards: scorecards };
  for (const layer of layers) {
    const d = deltaVsPrior(placeholder, layer);
    if (d) deltas[layer] = d;
  }

  // Aggregate pass/fail counts across the requested layers.
  const totalTests = layers.reduce((s, l) => s + (scorecards[l] ? scorecards[l].total : 0), 0);
  const totalPassed = layers.reduce((s, l) => s + (scorecards[l] ? scorecards[l].passed : 0), 0);
  const totalFailed = layers.reduce((s, l) => s + (scorecards[l] ? scorecards[l].failed : 0), 0);

  const record = {
    layers: layers,
    weights: { ...prefs.weights },
    scorecards: scorecards,
    weightedScore: normalizedScore,
    deltas: deltas,
    totals: { tests: totalTests, passed: totalPassed, failed: totalFailed },
    prompt: flags.prompt || null,
    triggeredBy: flags.triggeredBy || 'cli',
    finishedAt: new Date().toISOString(),
  };

  const persisted = saveRun(record);
  return {
    id: persisted.id,
    createdAt: persisted.createdAt,
    layers: persisted.layers,
    scorecards: persisted.scorecards,
    weights: persisted.weights,
    weightedScore: persisted.weightedScore,
    deltas: persisted.deltas,
    totals: persisted.totals,
    prompt: persisted.prompt,
  };
}

export function benchSummary({ limit = 10 } = {}) {
  const runs = listRuns({ limit: Math.max(limit * 3, 20) });
  if (!runs.length) return { runs: 0, layers: {}, latest: null, trend: [] };
  const byLayer = {};
  for (const id of LAYER_IDS) byLayer[id] = [];
  for (const r of runs.slice().reverse()) {
    for (const id of LAYER_IDS) {
      const card = r.scorecards && r.scorecards[id];
      if (card) byLayer[id].push({ at: r.createdAt, score: card.score, runId: r.id });
    }
  }
  return {
    runs: runs.length,
    layers: byLayer,
    latest: runs[0],
    trend: runs.slice(0, limit).map((r) => ({ id: r.id, at: r.createdAt, score: r.weightedScore, layers: r.layers })),
  };
}

// Surface the top regressions and improvements across the persisted history
// of a given layer. Used by `lehrosol bench report` and the MCP `bench_summary`
// tool so the user sees what changed across their own corrections.
export function topMovers(layer, { limit = 5 } = {}) {
  if (!LAYER_IDS.includes(layer)) throw new Error(`Unknown layer: ${layer}`);
  const all = listRuns({ limit: 200 });
  const seen = [];
  for (let i = 1; i < all.length; i += 1) {
    const cur = all[i - 1];
    const prev = all[i];
    const curCard = cur.scorecards && cur.scorecards[layer];
    const prevCard = prev.scorecards && prev.scorecards[layer];
    if (!curCard || !prevCard) continue;
    seen.push({
      at: cur.createdAt,
      runId: cur.id,
      prevRunId: prev.id,
      prevScore: prevCard.score,
      score: curCard.score,
      deltaPct: Number((curCard.score - prevCard.score).toFixed(2)),
      direction: curCard.score > prevCard.score ? 'improved' : (curCard.score < prevCard.score ? 'regressed' : 'unchanged'),
    });
  }
  const sorted = seen.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return { layer, movers: sorted.slice(0, Math.max(1, Math.min(Number(limit) || 5, 50))) };
}
