// SQLite-backed session/checkpoint store for the Loop Engine (Phase 2).
// Uses Node's built-in node:sqlite (available Node 22.5+); falls back to a
// JSON file store on older Node runtimes or if node:sqlite is unavailable.
//
// Audit upgrade: Node 24 still prints an ExperimentalWarning for node:sqlite.
// The warning is technically correct, but it polluted every human-facing CLI
// command. We filter only that one warning by default; set
// LEHRO_SHOW_EXPERIMENTAL_WARNINGS=1 to see it again.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { LEHRO_HOME, SESSIONS_DB } from './config.js';

if (process.env.LEHRO_SHOW_EXPERIMENTAL_WARNINGS !== '1' && !process.__lehroSqliteWarningFilterInstalled) {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function filteredLehroWarning(warning, ...args) {
    const message = typeof warning === 'string' ? warning : (warning && warning.message) || '';
    const type = args.find((arg) => typeof arg === 'string') || (warning && warning.name) || '';
    if ((type === 'ExperimentalWarning' || message.includes('SQLite is an experimental feature')) && message.includes('SQLite')) return;
    return originalEmitWarning.call(process, warning, ...args);
  };
  process.__lehroSqliteWarningFilterInstalled = true;
}

let DatabaseSyncCtor = null;
try {
  const sqliteModule = await import('node:sqlite');
  DatabaseSyncCtor = sqliteModule.DatabaseSync;
} catch {
  DatabaseSyncCtor = null;
}

const JSON_FALLBACK_PATH = SESSIONS_DB.replace(/\.sqlite$/, '.json');

function ensureHome() {
  if (!existsSync(LEHRO_HOME)) mkdirSync(LEHRO_HOME, { recursive: true, mode: 0o700 });
}

let db = null;
function getDb() {
  if (!DatabaseSyncCtor) return null;
  if (db) return db;
  ensureHome();
  try {
    db = new DatabaseSyncCtor(SESSIONS_DB);
    db.exec(
      'CREATE TABLE IF NOT EXISTS sessions (' +
      'id TEXT PRIMARY KEY, prompt TEXT, adapter TEXT, cwd TEXT, startedAt TEXT, ' +
      'finishedAt TEXT, finalVerdict TEXT, totalIterations INTEGER, resultJson TEXT)'
    );
    db.exec(
      'CREATE TABLE IF NOT EXISTS checkpoints (' +
      'sessionId TEXT, iteration INTEGER, createdAt TEXT, dataJson TEXT)'
    );
  } catch {
    db = null;
  }
  return db;
}

function readJsonFallback() {
  if (!existsSync(JSON_FALLBACK_PATH)) return { sessions: {}, checkpoints: [] };
  try {
    return JSON.parse(readFileSync(JSON_FALLBACK_PATH, 'utf8'));
  } catch {
    return { sessions: {}, checkpoints: [] };
  }
}

function writeJsonFallback(data) {
  ensureHome();
  writeFileSync(JSON_FALLBACK_PATH, JSON.stringify(data, null, 2), 'utf8');
  try { chmodSync(JSON_FALLBACK_PATH, 0o600); } catch { /* best effort */ }
}

export function backend() {
  return getDb() ? 'sqlite (node:sqlite)' : 'json-file (~/.lehro/sessions.json)';
}

export function createSession(session) {
  const database = getDb();
  if (database) {
    const stmt = database.prepare('INSERT OR REPLACE INTO sessions (id, prompt, adapter, cwd, startedAt) VALUES (?, ?, ?, ?, ?)');
    stmt.run(session.id, session.prompt, session.adapter, session.cwd, session.startedAt);
    return session;
  }
  const data = readJsonFallback();
  data.sessions[session.id] = Object.assign({}, session);
  writeJsonFallback(data);
  return session;
}

export function recordCheckpoint(sessionId, iteration, checkpointData) {
  const createdAt = new Date().toISOString();
  const database = getDb();
  if (database) {
    const stmt = database.prepare('INSERT INTO checkpoints (sessionId, iteration, createdAt, dataJson) VALUES (?, ?, ?, ?)');
    stmt.run(sessionId, iteration, createdAt, JSON.stringify(checkpointData));
    return;
  }
  const data = readJsonFallback();
  data.checkpoints.push({ sessionId: sessionId, iteration: iteration, createdAt: createdAt, data: checkpointData });
  writeJsonFallback(data);
}

export function finalizeSession(sessionId, summary) {
  const finishedAt = new Date().toISOString();
  const database = getDb();
  if (database) {
    const stmt = database.prepare('UPDATE sessions SET finishedAt = ?, finalVerdict = ?, totalIterations = ?, resultJson = ? WHERE id = ?');
    stmt.run(finishedAt, summary.finalVerdict, summary.totalIterations, JSON.stringify(summary), sessionId);
    return;
  }
  const data = readJsonFallback();
  if (data.sessions[sessionId]) {
    Object.assign(data.sessions[sessionId], { finishedAt: finishedAt, finalVerdict: summary.finalVerdict, totalIterations: summary.totalIterations, result: summary });
  }
  writeJsonFallback(data);
}

export function listSessions(options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(Number(opts.limit || 20), 200));
  const database = getDb();
  if (database) {
    const rows = database.prepare('SELECT id, prompt, adapter, startedAt, finishedAt, finalVerdict, totalIterations FROM sessions ORDER BY startedAt DESC LIMIT ?').all(limit);
    return rows;
  }
  const data = readJsonFallback();
  return Object.values(data.sessions)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, limit)
    .map((s) => ({ id: s.id, prompt: s.prompt, adapter: s.adapter, startedAt: s.startedAt, finishedAt: s.finishedAt, finalVerdict: s.finalVerdict, totalIterations: s.totalIterations }));
}

export function getSession(id) {
  const database = getDb();
  if (database) {
    const session = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!session) return null;
    const checkpoints = database.prepare('SELECT iteration, createdAt, dataJson FROM checkpoints WHERE sessionId = ? ORDER BY iteration ASC').all(id);
    return Object.assign({}, session, {
      result: session.resultJson ? JSON.parse(session.resultJson) : null,
      checkpoints: checkpoints.map((c) => ({ iteration: c.iteration, createdAt: c.createdAt, data: JSON.parse(c.dataJson) }))
    });
  }
  const data = readJsonFallback();
  const session = data.sessions[id];
  if (!session) return null;
  return Object.assign({}, session, {
    checkpoints: data.checkpoints.filter((c) => c.sessionId === id)
  });
}

// Remove sessions and their checkpoints (used by the Engram Distillery after
// distilling them into lessons). Reclaims sqlite space with a best-effort
// VACUUM.
export function deleteSessions(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const database = getDb();
  if (database) {
    const delCheckpoints = database.prepare('DELETE FROM checkpoints WHERE sessionId = ?');
    const delSession = database.prepare('DELETE FROM sessions WHERE id = ?');
    for (const id of list) {
      delCheckpoints.run(id);
      delSession.run(id);
    }
    try { database.exec('VACUUM'); } catch { /* best effort */ }
    return list.length;
  }
  const data = readJsonFallback();
  for (const id of list) delete data.sessions[id];
  data.checkpoints = data.checkpoints.filter((c) => !list.includes(c.sessionId));
  writeJsonFallback(data);
  return list.length;
}

export function storeSizeBytes() {
  const file = getDb() ? SESSIONS_DB : JSON_FALLBACK_PATH;
  try { return statSync(file).size; } catch { return 0; }
}
