import { appendFileSync, mkdirSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const count = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const homeDir = () => process.env.LEHRO_HOME || join(homedir(), '.lehro');

export function recordUsage({ model, source = 'cli', usage, ms = 0 } = {}, home = homeDir()) {
  const row = { version: 1, id: randomUUID(), at: new Date().toISOString(), model: String(model || 'local').slice(0, 256), source: String(source).slice(0, 80), promptTokens: count(usage?.prompt_tokens), completionTokens: count(usage?.completion_tokens), ms: Math.max(0, Number(ms) || 0) };
  try {
    const dir = join(home, 'usage');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, row.at.slice(0, 10) + '.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
    return row;
  } catch { return null; }
}

export function readUsage({ days = 30, home = homeDir(), now = new Date() } = {}) {
  const periodDays = Math.min(30, Math.max(1, Math.floor(Number(days) || 30)));
  const models = new Map();
  const seen = new Set();
  let truncated = false;
  let invalidRows = 0;
  for (let d = periodDays - 1; d >= 0; d--) {
    const date = new Date(now); date.setUTCDate(date.getUTCDate() - d);
    let fd;
    try {
      fd = openSync(join(home, 'usage', date.toISOString().slice(0, 10) + '.jsonl'), 'r');
      const size = fstatSync(fd).size;
      const start = Math.max(0, size - 2 * 1024 * 1024);
      truncated ||= start > 0;
      const buffer = Buffer.alloc(size - start);
      const length = readSync(fd, buffer, 0, buffer.length, start);
      const lines = buffer.subarray(0, length).toString('utf8').split('\n');
      if (start > 0) lines.shift();
      for (const line of lines) {
        if (!line) continue;
        let row;
        try { row = JSON.parse(line); } catch { invalidRows++; continue; }
        if (!row || row.version !== 1 || typeof row.id !== 'string' || typeof row.model !== 'string' || !row.model || typeof row.at !== 'string') { invalidRows++; continue; }
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const model = models.get(row.model) || { model: row.model, requests: 0, promptTokens: 0, completionTokens: 0, unmeasuredRequests: 0, ms: 0, last: null, sources: [] };
        model.requests++;
        model.promptTokens += count(row.promptTokens) || 0;
        model.completionTokens += count(row.completionTokens) || 0;
        if (count(row.promptTokens) === null || count(row.completionTokens) === null) model.unmeasuredRequests++;
        model.ms += Math.max(0, Number(row.ms) || 0);
        model.last = row;
        if (!model.sources.includes(row.source)) model.sources.push(row.source);
        models.set(row.model, model);
      }
    } catch (err) { if (err.code !== 'ENOENT') invalidRows++; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  return { ok: true, version: 1, periodDays, truncated, invalidRows, models: [...models.values()].sort((a, b) => b.requests - a.requests) };
}
