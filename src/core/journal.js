// Mission journal — the CLI's self-improving memory. Every `lehrosol code`
// run is recorded to ~/.lehro/journal.json; before the next mission starts,
// suggestTuning() reads recent outcomes and adapts context settings so the
// tool gets measurably better on THIS machine over time. Backups of every
// file a mission overwrites live under ~/.lehro/backups/<mission-id>/ so any
// mission can be undone with `lehrosol missions undo`.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export const LEHRO_HOME = process.env.LEHRO_HOME || join(homedir(), '.lehro');
const MAX_ENTRIES = 200;

export function journalPath(home = LEHRO_HOME) {
  return join(home, 'journal.json');
}

export function readJournal(path = journalPath()) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data.missions) ? data : { missions: [] };
  } catch {
    return { missions: [] };
  }
}

export function newMissionId() {
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

export function recordMission(entry, path = journalPath()) {
  const journal = readJournal(path);
  const full = { id: entry.id || newMissionId(), at: new Date().toISOString(), ...entry };
  journal.missions.unshift(full);
  journal.missions = journal.missions.slice(0, MAX_ENTRIES);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(journal, null, 2));
  return full;
}

export function journalStats(journal = readJournal()) {
  const recent = journal.missions.slice(0, 10);
  const finished = recent.filter((m) => m.ok);
  return {
    total: journal.missions.length,
    recentCount: recent.length,
    recentFailures: recent.filter((m) => !m.ok).length,
    recentOverflows: recent.filter((m) => /context size|context window|exceeded/i.test(String(m.error || ''))).length,
    recentRetries: recent.reduce((n, m) => n + Number(m.retries || 0), 0),
    avgSteps: finished.length ? finished.reduce((n, m) => n + Number(m.steps || 0), 0) / finished.length : null,
  };
}

// Adaptive tuning: learn from recent missions on this machine.
// - Overflows or overflow-retries recently -> start compact (small ctx server).
// - Consistently quick clean finishes -> allow expanded reads for richer context.
// Explicit --contextMode always wins; this only fills the default.
export function suggestTuning(journal = readJournal()) {
  const s = journalStats(journal);
  if (s.recentOverflows > 0 || s.recentRetries >= 2) {
    return { contextMode: 'compact', reason: `recent context overflows on this machine (${s.recentOverflows} overflow(s), ${s.recentRetries} retry(ies)) — starting compact` };
  }
  if (s.recentCount >= 3 && s.recentFailures === 0 && s.avgSteps !== null && s.avgSteps <= 4) {
    return { contextMode: 'expanded', reason: `recent missions finish cleanly in ~${s.avgSteps.toFixed(1)} steps — allowing richer context` };
  }
  return { contextMode: null, reason: 'no adjustment needed' };
}

/* ---------------- backups & undo ---------------- */

export function backupDir(missionId, home = LEHRO_HOME) {
  return join(home, 'backups', missionId);
}

function manifestPath(missionId, home) {
  return join(backupDir(missionId, home), 'manifest.json');
}

function readManifest(missionId, home = LEHRO_HOME) {
  try { return JSON.parse(readFileSync(manifestPath(missionId, home), 'utf8')); } catch { return null; }
}

// Snapshot a file BEFORE a mission overwrites it. New files are recorded with
// existed:false so undo knows to delete them instead of restoring a blob.
export function backupFile(missionId, root, relPath, home = LEHRO_HOME) {
  const dir = backupDir(missionId, home);
  const manifest = readManifest(missionId, home) || { root, files: [] };
  if (manifest.files.some((f) => f.path === relPath)) return; // first snapshot wins
  const abs = join(root, relPath);
  const existed = existsSync(abs);
  if (existed) {
    const blob = join(dir, 'tree', relPath);
    mkdirSync(dirname(blob), { recursive: true });
    copyFileSync(abs, blob);
  } else {
    mkdirSync(dir, { recursive: true });
  }
  manifest.files.push({ path: relPath, existed });
  writeFileSync(manifestPath(missionId, home), JSON.stringify(manifest, null, 2));
}

// Restore every file a mission touched: overwritten files come back from the
// snapshot, files the mission created are deleted.
export function undoMission(missionId, home = LEHRO_HOME) {
  const manifest = readManifest(missionId, home);
  if (!manifest) return { ok: false, reason: 'no-backup', restored: [], deleted: [] };
  const restored = [];
  const deleted = [];
  for (const f of manifest.files) {
    const abs = join(manifest.root, f.path);
    if (f.existed) {
      const blob = join(backupDir(missionId, home), 'tree', f.path);
      if (existsSync(blob)) {
        mkdirSync(dirname(abs), { recursive: true });
        copyFileSync(blob, abs);
        restored.push(f.path);
      }
    } else if (existsSync(abs)) {
      rmSync(abs);
      deleted.push(f.path);
    }
  }
  return { ok: true, root: manifest.root, restored, deleted };
}
