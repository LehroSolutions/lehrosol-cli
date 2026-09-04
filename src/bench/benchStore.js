// LehroSol Bench — persistent memory layer.
//
// The bench has three output streams that must survive across runs so the
// system can keep improving:
//
//   1. runs/      — every bench run (the scorecards it produced, the prompt
//                   that triggered it, the adapter(s) it probed, what layer
//                   deltas it observed vs the previous run). Used by
//                   `benchHistory` and `benchDeltaVsPrior`.
//   2. weights    — per-layer scoring weights the user can tune. Default is
//                   balanced (loop 0.4, mission 0.4, graph 0.2). Persisted
//                   in ~/.lehro/bench/preferences.json under {weights}.
//   3. corrections — every time the user passes --reward or --penalize after a
//                   bench run, that becomes a persistent multiplier on that
//                   specific testId for every future run. This is the
//                   "learns continuously from user input" loop: the user's
//                   notes and corrections stay applied until they say so.
//   4. notes      — free-form user observations per adapter (e.g. "claude-code
//                   is slow on coding prompts"). Surfaced as warnings on every
//                   future run that touches that adapter.
//
// All persistence is plain JSON in ~/.lehro/bench/ — matches runRegistry.js
// style (atomic write, mode 0o600) and stays dependency-free like the rest of
// the core. No network, no DB — the CLI is a single offline tool by design.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEHRO_HOME } from '../core/config.js';

export const BENCH_DIR = join(LEHRO_HOME, 'bench');
export const PREFS_PATH = join(BENCH_DIR, 'preferences.json');

export const DEFAULT_WEIGHTS = Object.freeze({
  loop: 0.4,
  mission: 0.4,
  graph: 0.2,
});

export const LAYER_IDS = ['loop', 'mission', 'graph'];

function ensureDir() {
  if (!existsSync(BENCH_DIR)) mkdirSync(BENCH_DIR, { recursive: true, mode: 0o700 });
}

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'bench';
}

function atomicWrite(path, value) {
  const temp = path + '.' + process.pid + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

// ---------------------------------------------------------------------------
// preferences.json: weights + corrections + notes. One file, atomic.
// ---------------------------------------------------------------------------

function defaultPrefs() {
  return {
    version: 1,
    weights: { ...DEFAULT_WEIGHTS },
    corrections: {},   // { [testId]: number }   multiplicative (default 1.0; >1 reward, <1 penalize)
    notes: {},         // { [adapterId]: string[] }
    updatedAt: new Date().toISOString(),
  };
}

export function loadPrefs() {
  ensureDir();
  if (!existsSync(PREFS_PATH)) return defaultPrefs();
  try {
    const parsed = JSON.parse(readFileSync(PREFS_PATH, 'utf8'));
    // Forward-compat: fill any layer added later with its default weight.
    const weights = { ...DEFAULT_WEIGHTS, ...(parsed.weights || {}) };
    return Object.assign(defaultPrefs(), parsed, { weights });
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(prefs) {
  ensureDir();
  const next = Object.assign({}, prefs, { updatedAt: new Date().toISOString() });
  atomicWrite(PREFS_PATH, next);
  return next;
}

export function setLayerWeight(layer, value) {
  if (!LAYER_IDS.includes(layer)) throw new Error(`Unknown bench layer: ${layer}. Use one of: ${LAYER_IDS.join(', ')}.`);
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) throw new Error(`Layer weight must be a number between 0 and 1, got: ${value}`);
  const prefs = loadPrefs();
  prefs.weights[layer] = numeric;
  return savePrefs(prefs);
}

export function recordCorrection(testId, delta, reason) {
  if (!testId) throw new Error('recordCorrection requires a testId.');
  const numeric = Number(delta);
  if (!Number.isFinite(numeric)) throw new Error(`Correction delta must be numeric, got: ${delta}`);
  // Clamp to a sane range so a typo can't make a test worth -100x or +100x.
  const clamped = Math.max(-0.9, Math.min(numeric, 1));
  const prefs = loadPrefs();
  const prev = Number(prefs.corrections[testId] || 1);
  // Multiplicative accumulation: each correction stacks onto the last one
  // until the user explicitly forgets it. That way repeated praise or blame
  // actually moves the needle.
  const next = Math.max(0.1, Math.min(prev + clamped, 2));
  prefs.corrections[testId] = next;
  if (reason) {
    prefs.notes[`correction:${testId}`] = [
      ...(prefs.notes[`correction:${testId}`] || []).slice(-9),
      `${new Date().toISOString()} ${reason}`,
    ];
  }
  return savePrefs(prefs);
}

export function forgetCorrection(testId) {
  const prefs = loadPrefs();
  delete prefs.corrections[testId];
  delete prefs.notes[`correction:${testId}`];
  return savePrefs(prefs);
}

export function recordAdapterNote(adapterId, note) {
  if (!adapterId) throw new Error('recordAdapterNote requires an adapterId.');
  const prefs = loadPrefs();
  prefs.notes[adapterId] = [...(prefs.notes[adapterId] || []).slice(-9), String(note || '').slice(0, 280)];
  return savePrefs(prefs);
}

export function adapterNotesFor(adapterId) {
  const prefs = loadPrefs();
  return (prefs.notes && prefs.notes[adapterId]) || [];
}

export function correctionFor(testId) {
  const prefs = loadPrefs();
  return Number(prefs.corrections[testId] || 1);
}

// ---------------------------------------------------------------------------
// runs/: one file per bench execution. Used to compute deltas.
// ---------------------------------------------------------------------------

function runPath(id) {
  return join(BENCH_DIR, safeId(id) + '.json');
}

export function saveRun(record) {
  ensureDir();
  const id = record.id || `bench-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const next = Object.assign({ id: id, createdAt: new Date().toISOString() }, record);
  atomicWrite(runPath(id), next);
  return next;
}

export function loadRun(id) {
  const path = runPath(id);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function listRuns({ limit = 30 } = {}) {
  ensureDir();
  return readdirSync(BENCH_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'preferences.json')
    .map((name) => { try { return JSON.parse(readFileSync(join(BENCH_DIR, name), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, Math.max(1, Math.min(Number(limit) || 30, 200)));
}

export function latestRun() {
  const all = listRuns({ limit: 1 });
  return all.length ? all[0] : null;
}

// For each layer, the prior run is the most recent run BEFORE the current one
// that contains a scorecard for that layer. This lets us cherry-pick the
// baseline per-layer even if layers ran at different times.
export function deltaVsPrior(currentRun, layer) {
  if (!currentRun) return null;
  const current = currentRun.scorecards && currentRun.scorecards[layer];
  if (!current) return null;
  const currentStamp = currentRun.createdAt;
  // Walk back through history, newest-first, until we find a run that has a
  // scorecard for the same layer and was created BEFORE the current one.
  for (const prior of listRuns({ limit: 50 })) {
    if (prior.id === currentRun.id) continue;
    if (String(prior.createdAt || '') >= String(currentStamp)) continue;
    const priorCard = prior.scorecards && prior.scorecards[layer];
    if (!priorCard) continue;
    const deltaPct = Number((current.score - priorCard.score).toFixed(2));
    const deltaPassed = current.passed - priorCard.passed;
    return {
      priorRunId: prior.id,
      priorCreatedAt: prior.createdAt,
      priorScore: priorCard.score,
      deltaPct: deltaPct,
      deltaPassed: deltaPassed,
      direction: deltaPct > 0 ? 'improved' : (deltaPct < 0 ? 'regressed' : 'unchanged'),
    };
  }
  return null;
}
