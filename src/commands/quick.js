// `lehrosol up|try|arena|scan` — the fast lane. One-word commands for the
// daily loop: discover models, host the best one, and actually *feel* each
// model in a chat REPL with live latency + tok/s readouts.
//
//   lehrosol up                        # scan → best-fit model → serving on :7000
//   lehrosol try qwopus                # chat with a model right now (REPL + stats)
//   lehrosol try --prompt "2+2?"       # one-shot, scriptable
//   lehrosol arena --prompt "..."      # same prompt across your best models — scoreboard
//   lehrosol scan --path "D:\\AI Models"
import { cpus } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { recordUsage } from '../core/usage.js';

// CPU busy-percentage sample (0-100) over a short window. Benchmark validity
// guard: live testing (2026-09-07) showed a single runaway background process
// made a 9B model read 6x slower — every tok/s number this CLI reports for
// arena/bench carries this sample so skewed readings announce themselves.
export function cpuLoadSample(sampleMs = 400) {
  const snap = () => cpus().reduce((a, c) => {
    const t = c.times;
    return { idle: a.idle + t.idle, total: a.total + t.idle + t.user + t.nice + t.sys + t.irq };
  }, { idle: 0, total: 0 });
  const before = snap();
  return new Promise((resolve) => {
    setTimeout(() => {
      const after = snap();
      const dt = after.total - before.total;
      const idle = after.idle - before.idle;
      resolve(dt > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / dt) * 100))) : 0);
    }, Math.max(50, Number(sampleMs) || 400));
  });
}

import { scanVault, vaultRoots, resolveVaultModel } from '../core/modelVault.js';
import { detectHardware } from '../core/hardware.js';
import { ratedVault, runVaultCommand } from './vault.js';
import { runServeCommand, readState } from './serve.js';
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ui } from '../core/ui.js';

export const DEFAULT_PORT = 7000;
export const DEFAULT_KEY = 'lehro-local';

function emit(result, flags, logger) {
  if (flags.json) {
    if (logger && logger.json) logger.json(result);
    else console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

function silentLogger() {
  return { json: () => {}, info: () => {}, error: () => {}, warn: () => {} };
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// --- Raw node:http helpers (not global fetch) --------------------------------
// Same rationale as makeHttpAdapter.postJson: undici's fixed 300 s
// headersTimeout aborts long local-model requests (≈5-minute CPU prompt evals
// are normal) with an opaque "fetch failed (ECONNRESET)". A raw request has no
// headers deadline, honors the explicit timeoutMs, and sends
// `connection: close` so no keep-alive socket is ever reused (some engines
// drop reused sockets mid-generation).
function rawRequest(method, url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { reject(new Error(`invalid endpoint URL: ${url}`)); return; }
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, {
      method,
      headers: body == null
        ? headers
        : Object.assign({ 'content-length': Buffer.byteLength(body) }, headers),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${Math.round(timeoutMs / 1000)}s (set LEHRO_HTTP_TIMEOUT_MS or --timeoutMs to raise it)`)));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// The /models catalog can answer without validating the API key on some
// llama.cpp revisions (or an older server may only protect chat). Before
// reusing an "already hot" engine, verify the key where it actually matters —
// /chat/completions — with a 1-token request, so an auth mismatch surfaces as
// one actionable error instead of a 401 flood mid-mission.
export async function verifyChatAuth(baseUrl, apiKey, timeoutMs = 8000) {
  try {
    const { status } = await rawRequest('POST', String(baseUrl).replace(/\/$/, '') + '/chat/completions', {
      'content-type': 'application/json',
      connection: 'close',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    }, JSON.stringify({ model: 'local', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }), timeoutMs);
    if (status === 401 || status === 403) {
      // The `unauthorized` flag is load-bearing: ensureServing's reuse guard
      // checks it to decide whether a "hot" engine can be kept. Without it a
      // key-rejecting engine was silently reused and 401-flooded the mission.
      return { ok: false, unauthorized: true, error: `HTTP ${status} — the engine rejected our API key` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// --- OpenAI-compatible one-shot chat with timing ---------------------------
// Long generations can outlive the engine's keep-alive window, so a reused
// socket dies and surfaces as a bare "fetch failed". Every request goes out
// on a fresh connection, and one clean retry covers the race without masking
// real outages.
export async function chatOnce(opts) {
  const first = await chatOnceAttempt(opts);
  if (first.ok || !first.network) return withUsage(first, opts);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const second = await chatOnceAttempt(opts);
  if (!second.ok) second.error = `${second.error} (after retry)`;
  return withUsage(second, opts);
}

function withUsage(result, opts) {
  if (result.ok) {
    const tracked = readState();
    const matches = tracked?.baseUrl === opts.baseUrl;
    result.usageRecord = recordUsage({ model: opts.model || (matches && tracked.model) || result.model || 'local', source: opts.source || 'cli-chat', usage: result.usage, ms: result.ms });
  }
  return result;
}

async function chatOnceAttempt({ baseUrl, apiKey, prompt, system, history = [], maxTokens = 512, temperature, timeoutMs = 600000 }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push(...history, { role: 'user', content: prompt });
  const started = Date.now();
  try {
    const { status, text } = await rawRequest('POST', String(baseUrl).replace(/\/$/, '') + '/chat/completions', {
      'content-type': 'application/json',
      connection: 'close',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    }, JSON.stringify({
      model: 'local',
      messages,
      max_tokens: maxTokens,
      ...(temperature == null ? {} : { temperature: Number(temperature) }),
      stream: false,
    }), timeoutMs);
    const ms = Date.now() - started;
    const json = safeJsonParse(text);
    if (status >= 400 || !json) {
      const detail = json && json.error ? ` — ${json.error.message || JSON.stringify(json.error)}` : (json ? '' : ` — ${String(text || '').slice(0, 200)}`);
      return { ok: false, ms, status, error: `HTTP ${status}${detail}` };
    }
    const content = json.choices?.[0]?.message?.content ?? '';
    const tokens = json.usage?.completion_tokens ?? Math.max(1, Math.round(content.length / 4));
    const promptTokens = Number(json.usage?.prompt_tokens || 0);
    const totalTokens = Number(json.usage?.total_tokens || (promptTokens + tokens));
    const tokPerSec = ms > 0 ? Math.round((tokens / (ms / 1000)) * 10) / 10 : tokens;
    return { ok: true, content, model: json.model, ms, tokens, completionTokens: tokens, promptTokens, totalTokens, tokPerSec, usage: json.usage || null };
  } catch (e) {
    if (/timed out/.test(String((e && e.message) || ''))) {
      return { ok: false, ms: Date.now() - started, error: String(e.message) };
    }
    const cause = e && e.cause && (e.cause.code || e.cause.message);
    const reason = `${String((e && e.message) || e)}${cause ? ` (${cause})` : ''}`;
    return { ok: false, network: true, ms: Date.now() - started, error: reason };
  }
}

export function formatStats({ ms, tokens, tokPerSec }) {
  const secs = Math.round(ms / 100) / 10;
  return `${secs}s · ${tokens} tok · ${tokPerSec} tok/s`;
}

async function probe(baseUrl, apiKey, timeoutMs = 1500) {
  try {
    const { status, text } = await rawRequest('GET', String(baseUrl).replace(/\/$/, '') + '/models', {
      connection: 'close',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    }, null, timeoutMs);
    if (status === 401 || status === 403) return { up: false, listening: true, models: [], unauthorized: true };
    if (status !== 200) return { up: false, listening: true, models: [] };
    const json = safeJsonParse(text);
    return { up: true, listening: true, models: Array.isArray(json?.data) ? json.data.map((m) => m && m.id).filter(Boolean) : [] };
  } catch {
    return { up: false, listening: false, models: [] };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Loading a model into RAM takes minutes on modest hardware, so keep polling
// /models until the engine answers instead of bailing after one probe.
export async function waitForEngine(baseUrl, apiKey, timeoutMs = 360000, { quiet = true, pollMs = 3000 } = {}) {
  const started = Date.now();
  let lastNote = 0;
  for (;;) {
    const state = await probe(baseUrl, apiKey, 2500);
    if (state.up) return state;
    // A key-protected engine rejects every poll — retrying just 401-spams the
    // server log. Surface the mismatch immediately with the actionable reason.
    if (state.unauthorized) return state;
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) return state;
    if (!quiet && elapsed - lastNote >= 15000) {
      lastNote = elapsed;
      ui.info(`Warming up… ${Math.round(elapsed / 1000)}s`, 'loading the model into RAM — first load can take a few minutes');
    }
    await sleep(Math.min(pollMs, timeoutMs - elapsed));
  }
}

// Parse `netstat -ano -p tcp` output and return the PIDs listening on a port.
export function parseNetstatPids(output, port) {
  const pids = new Set();
  for (const line of String(output).split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[1] || '';
    if (!local.endsWith(`:${port}`)) continue;
    const pid = Number(cols[cols.length - 1]);
    if (Number.isFinite(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

// Last resort for orphaned engines that serve.json no longer tracks: find
// whoever is listening on the port and kill the whole process tree.
function killPortListener(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      const pids = parseNetstatPids(out, port);
      for (const pid of pids) {
        try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* best effort */ }
      }
      return pids;
    }
    const out = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
    const pids = out.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* best effort */ }
    }
    return pids;
  } catch {
    return [];
  }
}

// After `serve stop`, Windows can hold the port for a beat before releasing
// it. Wait for the old listener to actually vanish so the next launch's
// port pre-flight check does not lose the race.
export async function waitForPortFree(baseUrl, apiKey, timeoutMs = 20000, pollMs = 500) {
  const started = Date.now();
  for (;;) {
    const state = await probe(baseUrl, apiKey, 1500);
    if (!state.listening) return true;
    if (Date.now() - started >= timeoutMs) return false;
    await sleep(pollMs);
  }
}

function ratedModels() {
  return ratedVault(scanVault({ roots: vaultRoots() }), detectHardware());
}

// Match the requested vault entry against what the engine reports as running.
// Engines echo the full model file path, and every vault model file can be
// literally named model.gguf — so a generic basename must NEVER count as a
// match. Match on the model id and its distinctive parent folder name only.
export function runningMatches(runningIds, entry) {
  if (!entry) return runningIds.length > 0;
  const needles = new Set();
  if (entry.id) needles.add(String(entry.id).toLowerCase());
  if (entry.path) {
    const parts = String(entry.path).toLowerCase().split(/[\\/]/).filter(Boolean);
    const base = parts[parts.length - 1];
    if (base && base !== 'model.gguf') needles.add(base);
    const parent = parts[parts.length - 2];
    if (parent) needles.add(parent);
  }
  return runningIds.some((rid) => {
    const low = String(rid).toLowerCase().replace(/\\/g, '/');
    return [...needles].some((n) => low.includes(n));
  });
}

// "D:\...\Jan-v3.5-4B-Q4_K_XL\model.gguf" → "Jan-v3.5-4B-Q4_K_XL".
export function displayModelName(id) {
  const parts = String(id || '').split(/[\\/]/).filter(Boolean);
  if (!parts.length) return String(id || 'local');
  const base = parts[parts.length - 1];
  if (/^model\.gguf$/i.test(base) && parts.length > 1) return parts[parts.length - 2];
  return base;
}

// A serve result is a real launch failure only when it carries a reason
// (port-in-use, engine-start-failed, ...). `ok: false` WITHOUT a reason just
// means the engine launched but was not ready within serve's own short
// timeout — the model is still loading, so the caller should keep waiting.
export function isLaunchFailure(res) {
  return Boolean(res && res.ok === false && res.reason);
}

// Make sure SOMETHING correct is serving on the port: reuse a matching live
// engine, otherwise stop the stale one and host the requested (or best-fit)
// vault model. Returns { ok, baseUrl, model, reused }.
export async function ensureServing({ model, port, apiKey, restart, showWarmup }, flags, logger) {
  // Prefer the engine serve.json actually tracks, even when it lives on a
  // different port: `vault serve` legitimately lands on a fallback port when
  // the default is busy at preflight. 2026-09-11 live incident (Qwen3.8-9B):
  // the 9B was hot on :8080 while `code` assumed :7000 — it launched a
  // duplicate IQ1_S engine, 401-flooded on a key mismatch, and squeezed free
  // RAM to 1.2 GB with two models resident. The tracked hot engine IS the
  // user's model choice; reuse it before assuming any port.
  if (!restart) {
    const tracked = readState();
    if (tracked && tracked.baseUrl && Number(tracked.port) !== Number(port) && tracked.pid != null) {
      const tProbe = await probe(tracked.baseUrl, apiKey);
      const entry = model ? resolveVaultModel(String(model), ratedModels()) : null;
      const matches = runningMatches(tProbe.models, entry);
      if (tProbe.up && !tProbe.unauthorized && (!model || matches)) {
        const auth = await verifyChatAuth(tracked.baseUrl, apiKey);
        if (auth.ok || !auth.unauthorized) {
          if (!flags.json) ui.info(`Reusing the tracked engine on :${tracked.port}`, `${displayModelName(tProbe.models[0] || 'local')} (already hot)`);
          return { ok: true, baseUrl: tracked.baseUrl, model: tProbe.models[0] || (entry && entry.id) || 'local', reused: true, trackedPort: tracked.port };
        }
      }
    }
  }
  const baseUrl = `http://localhost:${port}/v1`;
  const models = ratedModels();
  const entry = model ? resolveVaultModel(String(model), models) : null;
  if (model && !entry) {
    if (!flags.json) ui.error(`No vault model matches "${model}"`, `On disk: ${models.map((m) => m.id).join(', ') || '(none — run lehrosol scan)'}`);
    return { ok: false, reason: 'model-not-found' };
  }
  const state = await probe(baseUrl, apiKey);
  // A key-protected engine that rejects OUR key can never be reused — treat it
  // exactly like a stale engine and replace it (serve stop → force-kill →
  // relaunch with this key). 2026-09-10 live incident: an orphaned
  // llama-server on :7000 launched with a different key was reused as
  // "already hot" and 401-flooded every mission request.
  const authRejected = state.unauthorized === true;
  if (!authRejected && state.up && !restart && runningMatches(state.models, entry)) {
    // Some engines answer /models without validating the key but protect
    // /chat/completions — the only place auth actually matters. Verify with a
    // 1-token request before reusing; replace the engine on a key rejection.
    const auth = await verifyChatAuth(baseUrl, apiKey);
    if (auth.ok || !auth.unauthorized) {
      return { ok: true, baseUrl, model: state.models[0] || (entry && entry.id) || 'local', reused: true };
    }
  }
  if (authRejected || state.up || state.listening) {
    if (!flags.json && authRejected) {
      ui.info(`Engine on :${port} rejected our API key`, 'replacing it with a fresh launch using this key');
    }
    const prevExitCode = process.exitCode;
    await runServeCommand('stop', { json: true }, silentLogger());
    process.exitCode = prevExitCode; // best-effort stop must not taint our exit code
    let freed = await waitForPortFree(baseUrl, apiKey, 8000);
    if (!freed) {
      // serve.json lost track of it (orphaned engine) — kill by port instead.
      const pids = killPortListener(port);
      if (!flags.json && pids.length) ui.info(`Force-killed orphaned engine on :${port}`, `pid ${pids.join(', ')}`);
      freed = await waitForPortFree(baseUrl, apiKey, 12000);
    }
    if (!freed) {
      if (!flags.json) ui.error(`Port ${port} did not free up`, 'Another app may own it (Jan desktop?). Close it or pass --port.');
      return { ok: false, reason: 'port-still-busy' };
    }
  }
  // Duplicate-engine guard: if a live engine is tracked elsewhere, launching
  // here would host TWO models at once (2026-09-11 live incident: a stale
  // :7000 record led to a duplicate IQ1_S launch alongside the real 9B on
  // :8080 — free RAM dropped to 1.2 GB). Point the caller at the tracked
  // engine instead of silently doubling RAM.
  if (!restart) {
    const other = readState();
    if (other && other.pid != null && Number(other.port) !== Number(port)) {
      let alive = true;
      try { process.kill(other.pid, 0); } catch { alive = false; }
      if (alive) {
        if (!flags.json) ui.error(`A live engine (pid ${other.pid}) is already tracked on :${other.port}`, `Pass --port ${other.port} to use it, or lehrosol serve stop to end it.`);
        return { ok: false, reason: 'engine-elsewhere', trackedPort: other.port, trackedPid: other.pid };
      }
    }
  }
  // Keep serve's own ready-wait short; the quick lane owns the patient wait
  // below (with progress notes) so slow model loads are not treated as failures.
  const res = await runVaultCommand('serve', { ...flags, model: entry ? entry.id : undefined, port, apiKey, json: flags.json, readyTimeout: 10 }, logger);
  if (isLaunchFailure(res)) return res;
  const readyTimeout = Number(flags.readyTimeout || 360000);
  const after = await waitForEngine(baseUrl, apiKey, readyTimeout, { quiet: !showWarmup });
  return {
    ok: after.up,
    baseUrl,
    model: (after.models && after.models[0]) || (entry && entry.id) || 'local',
    reused: false,
    reason: after.up ? undefined : 'engine-not-responding',
  };
}

// --- lehrosol up ------------------------------------------------------------
export async function runUpCommand(flags = {}, logger = console) {
  const port = Number(flags.port || DEFAULT_PORT);
  const apiKey = flags.apiKey || flags.key || DEFAULT_KEY;
  const res = await runVaultCommand('serve', { ...flags, port, apiKey }, logger);
  if (res && res.ok !== false && !flags.json) {
    ui.nextSteps([
      'Chat now:       lehrosol try',
      'Benchmark:      lehrosol arena',
      'Wire the loop:  lehrosol loop run --prompt "..." --agentAdapter llamacpp --dryRun=false',
    ]);
  }
  return res;
}

// --- lehrosol scan ----------------------------------------------------------
export async function runScanCommand(flags = {}, logger = console) {
  if (flags.path || flags.root || flags.dir) {
    await runVaultCommand('add-root', { ...flags, json: flags.json }, flags.json ? silentLogger() : logger);
  }
  return runVaultCommand('list', flags, logger);
}

// --- lehrosol try -----------------------------------------------------------
export async function runTryCommand(model, flags = {}, logger = console) {
  const port = Number(flags.port || DEFAULT_PORT);
  const apiKey = flags.apiKey || flags.key || DEFAULT_KEY;
  const pick = model || flags.model || null;
  const oneShot = flags.prompt != null;
  if (!oneShot && !process.stdin.isTTY) {
    if (!flags.json) ui.error('No interactive terminal detected', 'For scripted use, pass a one-shot prompt: lehrosol try --prompt "..."');
    process.exitCode = 1;
    return emit({ ok: false, reason: 'repl-requires-tty' }, flags, logger);
  }
  const serving = await ensureServing({ model: pick, port, apiKey, restart: Boolean(flags.restart), showWarmup: !flags.json }, flags, logger);
  if (!serving.ok) {
    process.exitCode = 1;
    return emit(serving, flags, logger);
  }
  const baseUrl = serving.baseUrl;
  const system = flags.system || flags.sys || undefined;
  const maxTokens = Number(flags.maxTokens || 512);
  const timeoutMs = Number(flags.timeout || 600000);

  if (oneShot) {
    const res = await chatOnce({ baseUrl, apiKey, prompt: String(flags.prompt), system, maxTokens, timeoutMs });
    if (!flags.json) {
      if (res.ok) {
        console.log('\n' + res.content.trim() + '\n');
        ui.keyValue('model', serving.model);
        ui.keyValue('stats', formatStats(res));
      } else {
        ui.error('Chat failed', res.error);
      }
    }
    if (!res.ok) process.exitCode = 1;
    return emit({ ...res, model: serving.model }, flags, logger);
  }

  // Interactive test bench REPL.
  const shownModel = displayModelName(serving.model);
  ui.sectionHeader(`Test Bench — ${shownModel} on :${port}${serving.reused ? ' (already hot)' : ''}`);
  ui.keyValue('endpoint', `${baseUrl}  ·  key: ${apiKey}`);
  ui.keyValue('commands', '/exit · /clear (reset history) · /sys <text> (set system prompt)');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const history = [];
  let sys = system;
  for (;;) {
    let line;
    try {
      line = await rl.question('\n  you › ');
    } catch {
      break; // EOF / Ctrl-D
    }
    const text = String(line || '').trim();
    if (!text) continue;
    if (text === '/exit' || text === '/quit') break;
    if (text === '/clear') { history.length = 0; console.log('  (history cleared)'); continue; }
    if (text.startsWith('/sys ')) { sys = text.slice(5).trim(); console.log('  (system prompt set)'); continue; }
    const res = await chatOnce({ baseUrl, apiKey, prompt: text, system: sys, history, maxTokens, timeoutMs });
    if (!res.ok) { ui.error('Chat failed', res.error); continue; }
    history.push({ role: 'user', content: text }, { role: 'assistant', content: res.content });
    console.log('\n  ' + res.content.trim().replace(/\n/g, '\n  '));
    ui.keyValue('stats', formatStats(res));
  }
  rl.close();
  console.log('\n  Test bench closed.\n');
  return { ok: true, model: serving.model, turns: history.length / 2 };
}

// --- lehrosol arena ---------------------------------------------------------
export function formatArenaRows(rows) {
  return rows.map((r) => [
    r.model,
    r.ok ? `${Math.round(r.ms / 100) / 10}s` : '—',
    r.ok ? String(r.tokens) : '—',
    r.ok ? String(r.tokPerSec) : '—',
    r.ok ? (r.snippet || '') : `FAILED: ${r.error || 'could not serve'}`,
  ]);
}

export function arenaWinner(rows) {
  const ok = rows.filter((r) => r.ok);
  if (!ok.length) return null;
  const bySpeed = (list) => list.slice().sort((a, b) => (b.tokPerSec || 0) - (a.tokPerSec || 0));
  // A reply with no visible text (all tokens burned on hidden reasoning)
  // must not beat a model that actually answered.
  const withText = ok.filter((r) => r.hasText !== false);
  return bySpeed(withText.length ? withText : ok)[0];
}

export async function runArenaCommand(flags = {}, logger = console) {
  const port = Number(flags.port || DEFAULT_PORT);
  const apiKey = flags.apiKey || flags.key || DEFAULT_KEY;
  const prompt = String(flags.prompt || 'Write a JavaScript function that returns the nth Fibonacci number, then explain it in one sentence.');
  const maxTokens = Number(flags.maxTokens || 256);
  const timeoutMs = Number(flags.timeout || 600000);
  const all = ratedModels();
  let candidates;
  if (flags.models) {
    candidates = String(flags.models).split(',').map((s) => resolveVaultModel(s.trim(), all)).filter(Boolean);
  } else {
    candidates = all.filter((m) => m.fit === 'great' || m.fit === 'tight').slice(0, Number(flags.count || 3));
  }
  if (!candidates.length) {
    ui.error('No models to race', 'Run `lehrosol scan` first, or pass --models model-a,model-b');
    process.exitCode = 1;
    return emit({ ok: false, reason: 'no-models' }, flags, logger);
  }
  if (!flags.json) {
    ui.sectionHeader('Arena — same prompt, every model, one scoreboard');
    ui.keyValue('prompt', prompt.length > 80 ? prompt.slice(0, 77) + '…' : prompt);
    ui.keyValue('contenders', candidates.map((c) => c.id).join('  vs  '));
  }
  const loadPromise = cpuLoadSample(1000);
  const rows = [];
  let lastServed = null;
  for (const entry of candidates) {
    if (!flags.json) ui.info(`Serving ${entry.id}…`, 'first load can take a few minutes');
    const serving = await ensureServing({ model: entry.id, port, apiKey, restart: true, showWarmup: !flags.json }, { ...flags, json: true }, silentLogger());
    if (!serving.ok) {
      rows.push({ model: entry.id, ok: false, error: serving.reason || 'could not serve' });
      continue;
    }
    lastServed = entry.id;
    const res = await chatOnce({ baseUrl: serving.baseUrl, apiKey, prompt, maxTokens, timeoutMs });
    const snippet = res.ok ? res.content.trim().replace(/\s+/g, ' ').slice(0, 60) : undefined;
    rows.push({
      model: entry.id,
      ok: res.ok,
      ms: res.ms,
      tokens: res.tokens,
      tokPerSec: res.tokPerSec,
      hasText: res.ok ? snippet.length > 0 : undefined,
      snippet: res.ok && !snippet.length ? '(no visible text — all tokens spent reasoning; try --maxTokens 512)' : snippet,
      error: res.error,
    });
  }
  const cpuLoad = await loadPromise;
  const winner = arenaWinner(rows);
  if (!flags.json) {
    ui.table(['model', 'time', 'tokens', 'tok/s', 'first 60 chars / error'], formatArenaRows(rows));
    if (winner) ui.success(`Fastest: ${winner.model} at ${winner.tokPerSec} tok/s`);
    if (cpuLoad >= 60) ui.warning(`Background CPU load ${cpuLoad}%`, 'tok/s readings may be skewed by another process — close heavy apps and re-run.');
    ui.nextSteps([
      `Keep the winner hot: lehrosol try ${winner ? winner.model : '<model>'}`,
      lastServed
        ? `${lastServed} is still hot on :${port} — lehrosol serve stop to end it`
        : `Check what's on :${port}: lehrosol serve status`,
    ]);
  }
  return emit({ ok: rows.some((r) => r.ok), prompt, rows, winner: winner ? winner.model : null, cpuLoad }, flags, logger);
}
