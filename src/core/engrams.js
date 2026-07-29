// The Engram Distillery: LehroSol's answer to "session compaction".
//
// Most tools compact history by deleting it. LehroSol distills it instead:
// each old session is reduced to an *engram* — a tiny memory capsule that
// records what was attempted, how it went, what it physically changed, and
// the lesson learned. Engrams are nearly free to store, survive forever in
// ~/.lehro/engrams.json, and feed forward: future loop runs in the same
// project inject the freshest field notes into the agent's context, so the
// tool literally gets sharper the longer you use it.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LEHRO_HOME } from './config.js';
import { listSessions, getSession, deleteSessions, storeSizeBytes } from './sessionStore.js';
import { projectIdentity } from './projects.js';

const ENGRAMS_PATH = join(LEHRO_HOME, 'engrams.json');

export function loadEngrams() {
  if (!existsSync(ENGRAMS_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(ENGRAMS_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveEngrams(book) {
  if (!existsSync(LEHRO_HOME)) mkdirSync(LEHRO_HOME, { recursive: true, mode: 0o700 });
  writeFileSync(ENGRAMS_PATH, JSON.stringify(book, null, 2), 'utf8');
  try { chmodSync(ENGRAMS_PATH, 0o600); } catch { /* best effort */ }
}

// Sessions store the *effective* prompt (mode preamble + user goal + injected
// field notes). The engram should remember only the human's actual goal.
export function digestPrompt(prompt, max = 90) {
  const raw = String(prompt || '');
  const marker = raw.indexOf('# USER GOAL');
  let core = marker >= 0 ? raw.slice(marker + '# USER GOAL'.length) : raw;
  const notesIdx = core.indexOf('# FIELD NOTES');
  if (notesIdx >= 0) core = core.slice(0, notesIdx);
  return core.trim().replace(/\s+/g, ' ').slice(0, max);
}

function deriveLesson(e) {
  const goal = `'${e.promptDigest || '(no prompt)'}'`;
  if (e.finalVerdict === 'stop-success') {
    if (e.iterations <= 1) return `${goal} passed first try on ${e.adapter} — trust this setup for similar tasks.`;
    return `${goal} needed ${e.iterations} iterations on ${e.adapter} — consider splitting similar goals into smaller prompts.`;
  }
  if (e.finalVerdict === 'stop-adapter-error') return `${e.adapter} errored on ${goal}${e.errorSignature ? ` (${e.errorSignature})` : ''} — check adapter health before rerunning.`;
  if (e.finalVerdict === 'stop-adapter-unavailable') return `${e.adapter} was offline for ${goal} — probe adapters first: lehrosol switch.`;
  if (e.finalVerdict === 'stop-budget-exhausted') return `${goal} exhausted its iteration budget on ${e.adapter} — raise --maxIterations or decompose via supervise.`;
  return `${goal} ended with ${e.finalVerdict || 'no verdict'} on ${e.adapter}.`;
}

export function distillSession(session) {
  const checkpoints = (session.checkpoints || []).map((cp) => ({ iteration: cp.iteration, data: cp.data || cp }));
  const verdictTrail = checkpoints.map((c) => (c.data.score && c.data.score.verdict) || null).filter(Boolean);
  const lastDiff = [...checkpoints].reverse().map((c) => c.data.diff).find((d) => d && !d.empty) || null;
  const diffSummary = lastDiff && lastDiff.stat ? String(lastDiff.stat).trim().split('\n').pop().trim() : null;
  const finalVerdict = session.finalVerdict || verdictTrail[verdictTrail.length - 1] || null;

  let errorSignature = null;
  if (finalVerdict && finalVerdict.includes('adapter')) {
    const lastResult = [...checkpoints].reverse().map((c) => c.data.result).find((r) => r) || null;
    const raw = lastResult ? String(lastResult.error || lastResult.output || '') : '';
    errorSignature = raw ? raw.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  }

  let project = null;
  if (session.cwd) {
    try {
      const p = projectIdentity(session.cwd);
      project = `${p.sigil} ${p.codename} [${p.tag}]`;
    } catch { /* identity is cosmetic; never block distillation */ }
  }

  const engram = {
    id: session.id,
    cwd: session.cwd || null,
    project,
    adapter: session.adapter || 'unknown',
    promptDigest: digestPrompt(session.prompt),
    startedAt: session.startedAt || null,
    finishedAt: session.finishedAt || null,
    finalVerdict,
    iterations: Number(session.totalIterations || checkpoints.length || 0),
    verdictTrail: verdictTrail.slice(-8),
    diffSummary,
    errorSignature,
    distilledAt: new Date().toISOString(),
  };
  engram.lesson = deriveLesson(engram);
  return engram;
}

// Distill everything older than the newest `keep` finished sessions.
// Preview by default; pass apply=true to persist engrams and delete the
// original bulky session rows + checkpoints. Unfinished sessions (crashed or
// still running) are never touched.
export function compactSessions(options = {}) {
  const keep = Math.max(0, Number(options.keep != null ? options.keep : 8));
  const apply = options.apply === true;
  const bytesBefore = storeSizeBytes();
  const all = listSessions({ limit: 200 });
  const candidates = all.slice(keep).filter((s) => s.finishedAt);

  const engrams = [];
  for (const s of candidates) {
    const full = getSession(s.id);
    if (!full) continue;
    engrams.push(distillSession(full));
  }

  if (apply && engrams.length) {
    const book = loadEngrams();
    const known = new Set(book.map((e) => e.id));
    for (const e of engrams) if (!known.has(e.id)) book.push(e);
    saveEngrams(book);
    deleteSessions(engrams.map((e) => e.id));
  }

  return {
    scanned: all.length,
    keptFull: Math.min(keep, all.length),
    distilled: engrams.length,
    engrams,
    bytesBefore,
    bytesAfter: apply ? storeSizeBytes() : bytesBefore,
    applied: apply,
    engramsTotal: loadEngrams().length,
  };
}

// The feedback loop: freshest lessons learned in this exact project.
export function fieldNotesFor(cwd, limit = 3) {
  const target = resolve(String(cwd || '.'));
  return loadEngrams()
    .filter((e) => e.cwd && resolve(e.cwd) === target && e.lesson)
    .sort((a, b) => String(b.finishedAt || b.distilledAt || '').localeCompare(String(a.finishedAt || a.distilledAt || '')))
    .slice(0, Math.max(1, limit))
    .map((e) => e.lesson);
}
