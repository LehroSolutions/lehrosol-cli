import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEHRO_HOME } from './config.js';

export const RUNS_DIR = join(LEHRO_HOME, 'runs');
function ensureDir() { mkdirSync(RUNS_DIR, { recursive: true, mode: 0o700 }); }
function safeId(id) { const value = String(id || '').replace(/[^A-Za-z0-9._-]/g, '-'); if (!value) throw new Error('Run id is required.'); return value; }
function runPath(id) { return join(RUNS_DIR, safeId(id) + '.json'); }
function write(path, value) { ensureDir(); const temp = path + '.' + process.pid + '.tmp'; writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }); renameSync(temp, path); }
export function createRun(record) { const now = new Date().toISOString(); const run = { status: 'pending', events: [], ...record, createdAt: record.createdAt || now, updatedAt: now }; write(runPath(run.id), run); return run; }
export function loadRun(id) { const path = runPath(id); if (!existsSync(path)) return null; try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function updateRun(id, patch) { const current = loadRun(id); if (!current) throw new Error(`Run not found: ${id}`); const next = { ...current, ...patch, updatedAt: new Date().toISOString() }; write(runPath(id), next); return next; }
export function appendRunEvent(id, event) { const current = loadRun(id); if (!current) throw new Error(`Run not found: ${id}`); const entry = { at: new Date().toISOString(), ...event }; current.events = [...(current.events || []), entry]; current.updatedAt = entry.at; write(runPath(id), current); return entry; }
export function listRuns({ limit = 30 } = {}) { ensureDir(); return readdirSync(RUNS_DIR).filter((name) => name.endsWith('.json')).map((name) => { try { return JSON.parse(readFileSync(join(RUNS_DIR, name), 'utf8')); } catch { return null; } }).filter(Boolean).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.max(1, Math.min(Number(limit)||30, 200))); }
