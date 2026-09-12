// LehroSol Serve — run local models through an external engine binary and
// wire the endpoint straight into LehroSol's adapter registry. This is the
// "own the harness, rent the engine" wrapper: the engine is an unmodified
// upstream CLI on PATH; every workflow decision (profiles, preferred adapter,
// loop wiring) stays in LehroSol.
//
// Engines:
//   jan       — Jan (jan.ai) `jan serve`; models managed in Jan's data folder
//   llamacpp  — llama.cpp `llama-server`; point --model at any GGUF file or
//               a folder containing one (e.g. D:\AI Models\llamacpp\models\...)
//
//   lehrosol serve start --model jan-code-4b --use
//   lehrosol serve start --engine llamacpp --model "D:\AI Models\llamacpp\models\Qwopus3_5-4B-Coder-Fable5-v1-Q4_K_M" --use
//   lehrosol serve status | stop | models
//
// Engine-agnostic by design: adding another engine (vLLM, LM Studio CLI, …)
// is one more entry in ENGINES — no other file changes.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, readdirSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { detectHardware, rateModelFit, estimateRequiredGB } from '../core/hardware.js';
import { homedir } from 'node:os';
import { resolveCommand, launchSpec } from '../loop/adapters/shared.js';
import { saveAdapterConfig } from '../core/config.js';
import { findLlamaServer, resolveVaultModel } from '../core/modelVault.js';
import { setPreferredAdapter } from '../core/favorites.js';
import { listAdapters } from '../loop/adapters/index.js';
import { ui } from '../core/ui.js';

// If given a folder, find the GGUF inside it (multi-part GGUFs resolve to the
// -00001-of- shard, which is the one llama-server must be pointed at).
export function resolveGgufModel(input) {
  if (!input) return null;
  const raw = String(input);
  if (/\.gguf$/i.test(raw)) return raw;
  try {
    if (statSync(raw).isDirectory()) {
      const ggufs = readdirSync(raw).filter((f) => /\.gguf$/i.test(f)).sort();
      if (!ggufs.length) return raw;
      const firstShard = ggufs.find((f) => /-00001-of-\d+\.gguf$/i.test(f));
      return join(raw, firstShard || ggufs[0]);
    }
  } catch { /* not a local path; pass through untouched */ }
  return raw;
}

// Best-effort on-disk size of a resolved GGUF. Multi-part GGUFs are loaded
// shard by shard — the -00001-of-N file alone understates by N× — so sum all.
function modelDiskBytes(modelPath) {
  try {
    const st = statSync(modelPath);
    if (!st.isFile()) return null;
    const m = String(modelPath).match(/-00001-of-(\d+)\.gguf$/i);
    if (!m) return st.size;
    const total = Number(m[1]);
    const dir = dirname(modelPath);
    let sum = 0;
    for (const f of readdirSync(dir)) {
      if (new RegExp(`-\\d{5}-of-${total}\\.gguf$`, 'i').test(f)) sum += statSync(join(dir, f)).size;
    }
    return sum || st.size;
  } catch { return null; }
}

export const ENGINES = Object.freeze({
  jan: {
    id: 'jan',
    label: 'Jan (jan.ai)',
    binEnv: 'LEHRO_JAN_BIN',
    bin: 'jan',
    defaultPort: 6767,
    adapterId: 'jan',
    detach: 'native',
    requiresModel: false,
    preferServerModelId: false,
    // Jan enforces API-key auth on /v1/chat/completions even when no key is
    // passed at launch. Always start it with an explicit key and wire the
    // same key into the adapter so loop requests authenticate.
    defaultApiKey: 'lehro-local',
    installHint: 'Install the Jan desktop app or CLI first: https://www.jan.ai/docs/desktop/cli',
    serveArgs: ({ model, port, apiKey, detach }) => {
      const args = ['serve'];
      if (model) args.push(String(model));
      args.push('--port', String(port));
      if (apiKey) args.push('--api-key', String(apiKey));
      if (detach) args.push('--detach');
      return args;
    },
    modelsArgs: () => ['models', 'list'],
  },
  llamacpp: {
    id: 'llamacpp',
    label: 'llama.cpp (llama-server)',
    binEnv: 'LEHRO_LLAMACPP_BIN',
    bin: 'llama-server',
    defaultPort: 8080,
    adapterId: 'llamacpp',
    detach: 'spawn',
    requiresModel: true,
    preferServerModelId: true,
    installHint: 'Run `lehrosol vault doctor` — LehroSol auto-discovers the llama-server bundled inside your model folder (e.g. Jan\u2019s data dir). Or install llama.cpp / set LEHRO_LLAMACPP_BIN: https://github.com/ggml-org/llama.cpp',
    // Accept a GGUF path, a folder, or a bare model NAME resolved against the
    // Model Vault (every GGUF on disk) — hosting no longer needs full paths.
    resolveModel: (input) => {
      const direct = resolveGgufModel(input);
      if (!input || /[\\/]/.test(String(input)) || existsSync(String(direct))) return direct;
      const entry = resolveVaultModel(input);
      return entry ? entry.path : direct;
    },
    // --jinja enables the chat-template engine that powers OpenAI-style tool
    // calling — required for LehroSol's function-calling loop.
    serveArgs: ({ model, port, apiKey, ctxSize, gpuLayers, mmproj, threads, features }) => {
      // Jan bundles different llama.cpp revisions. Older revisions exit
      // immediately when given newer optional flags, so only pass a flag when
      // its own --help output says it is supported.
      const args = ['-m', String(model), '--port', String(port)];
      if (!features || features.jinja) args.push('--jinja');
      if (apiKey && (!features || features.apiKey)) args.push('--api-key', String(apiKey));
      if (ctxSize) args.push('-c', String(ctxSize));
      if (gpuLayers != null && gpuLayers !== '') args.push('-ngl', String(gpuLayers));
      if (mmproj) args.push('--mmproj', String(mmproj));
      if (threads) args.push('-t', String(threads));
      return args;
    },
    modelsArgs: null, // no catalog CLI; running model is visible via `lehrosol serve status`
  },
});

function lehroHome() {
  return process.env.LEHRO_HOME || join(homedir(), '.lehro');
}

function stateFile() {
  return join(lehroHome(), 'serve.json');
}

export function readState() {
  try { return JSON.parse(readFileSync(stateFile(), 'utf8')); } catch { return null; }
}

function writeState(state) {
  mkdirSync(lehroHome(), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function clearState() {
  try { if (existsSync(stateFile())) rmSync(stateFile()); } catch { /* best effort */ }
}

function engineFor(flags) {
  const key = String(flags.engine || 'jan').trim().toLowerCase();
  return ENGINES[key] || null;
}

function engineBin(engine) {
  return process.env[engine.binEnv] || engine.bin;
}

async function probeEndpoint(baseUrl, timeoutMs = 1500, apiKey = null) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(String(baseUrl).replace(/\/$/, '') + '/models', {
      signal: controller.signal,
      ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
    });
    clearTimeout(timer);
    // A key-protected engine answers 401/403 instead of refusing the
    // connection: that is a LIVE engine holding the wrong key, which must
    // count as occupied. A keyless pre-flight used to read those statuses as
    // "something answered" or even "port free", then 401-flooded for minutes.
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, models: [], unauthorized: true };
    if (!res.ok) return { ok: false, status: res.status, models: [] };
    const json = await res.json().catch(() => null);
    const models = Array.isArray(json?.data) ? json.data.map((m) => m && m.id).filter(Boolean) : [];
    return { ok: true, status: res.status, models };
  } catch {
    return { ok: false, status: null, models: [] };
  }
}

async function waitForReady(baseUrl, totalMs, apiKey = null) {
  const deadline = Date.now() + totalMs;
  let last = { ok: false, models: [] };
  while (Date.now() < deadline) {
    last = await probeEndpoint(baseUrl, 1500, apiKey);
    if (last.ok) return last;
    // Polling a key-protected engine keylessly 401-spams llama-server's log
    // once per second for the whole ready window. Send the key we launched
    // with; a mismatch surfaces once, here, instead of flooding the log.
    if (last.unauthorized) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return last;
}

// Stop an orphaned listener when serve.json is stale or a detached process was
// launched outside this CLI. This is deliberately only used for an explicit
// `serve stop --force --port …` request or a GUI-requested model switch.
export function forceStopPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      const pids = [];
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const cols = line.trim().split(/\s+/);
        if (cols.length < 5 || !(cols[1] || '').endsWith(`:${port}`)) continue;
        const pid = Number(cols.at(-1));
        if (Number.isFinite(pid) && pid > 0 && !pids.includes(pid)) pids.push(pid);
      }
      for (const pid of pids) {
        try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* best effort */ }
      }
      return pids;
    }
    const out = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
    const pids = out.split(/\s+/).map(Number).filter((pid) => Number.isFinite(pid) && pid > 0);
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* best effort */ } }
    return [...new Set(pids)];
  } catch { return []; }
}

async function waitForPortFree(baseUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeEndpoint(baseUrl, 1000);
    if (!probe.ok && probe.status == null) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const probe = await probeEndpoint(baseUrl, 1000);
  return !probe.ok && probe.status == null;
}

// The embedded llama-server binary varies by Jan release. Probe its help once
// before launch rather than assuming a modern flag set. A failed probe is
// deliberately conservative: the essential -m/--port flags still work.
function llamaFeatures(bin) {
  try {
    const help = execFileSync(bin, ['--help'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    return {
      jinja: /(^|\s)--jinja(?:\s|,|$)/m.test(help),
      apiKey: /(^|\s)--api-key(?:\s|,|$)/m.test(help),
    };
  } catch {
    return { jinja: false, apiKey: false };
  }
}

function tailText(path, maxChars = 4000) {
  try {
    const text = readFileSync(path, 'utf8');
    return text.slice(-maxChars).trim();
  } catch { return ''; }
}

function wireAdapter(engine, { baseUrl, model, apiKey }) {
  const values = { baseUrl, model: model || undefined, apiKey: apiKey || undefined };
  saveAdapterConfig(engine.adapterId, values);
  setPreferredAdapter(engine.adapterId, { allowedIds: listAdapters().map((a) => a.id) });
}

function emit(result, flags, logger) {
  if (flags.json) {
    if (logger && logger.json) logger.json(result);
    else console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

export async function runServeCommand(subcommand, flags = {}, logger = console) {
  const cmd = subcommand || 'status';
  const engine = engineFor(flags);
  if (!engine) {
    ui.error('Unknown engine', `Supported engines: ${Object.keys(ENGINES).join(', ')}`);
    process.exitCode = 1;
    return { ok: false, reason: 'unknown-engine' };
  }
  let bin = engineBin(engine);
  // Local-hosting sovereignty: if llama-server isn't on PATH, hunt for a
  // binary bundled inside the model vault roots (Jan's data folder ships its
  // own llama.cpp backends) before giving up.
  if (engine.id === 'llamacpp' && !resolveCommand(bin).ok) {
    const found = findLlamaServer();
    if (found) bin = found.bin;
  }

  if (cmd === 'start') {
    if (!resolveCommand(bin).ok) {
      ui.error(`${engine.label} binary not found on PATH (\`${bin}\`)`, engine.installHint);
      process.exitCode = 1;
      return emit({ ok: false, reason: 'engine-not-installed', engine: engine.id, bin }, flags, logger);
    }
    const port = Number(flags.port || engine.defaultPort);
    const rawModel = flags.model ? String(flags.model) : null;
    const model = engine.resolveModel ? engine.resolveModel(rawModel) : rawModel;
    if (engine.requiresModel && !model) {
      ui.error('Missing --model', `Example: lehrosol serve start --engine ${engine.id} --model "D:\\AI Models\\llamacpp\\models\\<model-folder-or-file.gguf>"`);
      process.exitCode = 1;
      return emit({ ok: false, reason: 'missing-model', engine: engine.id }, flags, logger);
    }
    const apiKey = flags.apiKey || flags.key || engine.defaultApiKey || null;
    const baseUrl = `http://localhost:${port}/v1`;
    const foreground = Boolean(flags.foreground);

    // Pre-flight: if something already answers on this port, a fresh launch
    // will silently lose the bind race and requests will hit the OLD server
    // (whose API key will not match this launch). A 401/403 also means a live
    // engine is listening — fail loudly instead of 401-spamming it later.
    const existing = await probeEndpoint(baseUrl, 1500, apiKey);
    if (existing.ok || existing.unauthorized) {
      ui.error(
        `Port ${port} is already serving at ${baseUrl}`,
        (existing.unauthorized
          ? 'A live engine is listening there but rejects the API key for this launch — its key will not match. '
          : 'An older engine instance (or the Jan desktop app\u2019s local API server) is still running \u2014 its API key will not match this launch. ')
        + 'Stop it first: `lehrosol serve stop`, or kill the listener directly \u2014 '
        + `Windows PowerShell: Get-NetTCPConnection -LocalPort ${port} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } \u2014 `
        + `macOS/Linux: kill $(lsof -ti :${port}). Or start on a free port with --port.`,
      );
      process.exitCode = 1;
      return emit({ ok: false, reason: 'port-in-use', engine: engine.id, baseUrl, models: existing.models }, flags, logger);
    }

    const features = engine.id === 'llamacpp' ? llamaFeatures(bin) : null;

    // Offload + memory pre-flight (llamacpp). Recent llama.cpp builds ship
    // Vulkan/compute backends that auto-enable on ANY GPU — including Intel
    // UHD-class iGPUs whose "VRAM" is shared system RAM. Live benchmarking on
    // an i5-8265U/UHD-620 laptop measured llama-server silently routing
    // through the iGPU at 0.3–2.2 tok/s where the same model pinned to the
    // CPU runs 2×–5× faster. Unless the user pins --gpuLayers, force -ngl 0
    // on integrated-only machines, and warn up front when the model cannot
    // fit the RAM budget (page-thrashing measured ≈1 tok/s or worse).
    let resourceWarning = null;
    let gpuLayers = flags.gpuLayers ?? flags.ngl;
    if (engine.id === 'llamacpp') {
      const hw = detectHardware();
      const dedicated = Boolean(hw.gpu && !hw.gpu.integrated && Number.isFinite(hw.gpu.vramGB) && hw.gpu.vramGB > 0);
      if ((gpuLayers == null || gpuLayers === '') && !dedicated) gpuLayers = 0;
      const sizeBytes = modelDiskBytes(model);
      if (sizeBytes) {
        const fit = rateModelFit(sizeBytes, hw);
        // rateModelFit budgets against total RAM (a server-restart plan);
        // a launch pre-flight must also check what is free RIGHT NOW —
        // measured live: a 5.8 GB model in 3.7 GB free RAM pages to ~1 tok/s.
        const freeNow = Math.min(Number(hw.freeMemGB || 0), Number(fit.budgetGB || Infinity));
        const requiredGB = Number(fit.requiredGB || estimateRequiredGB(sizeBytes));
        // 0.85 margin: os.freemem() counts standby cache as available, which
        // evaporates the moment the engine actually touches those pages.
        if (fit.fit === 'no-fit' || requiredGB > freeNow * 0.85) {
          resourceWarning = `Model needs ~${requiredGB} GB but only ~${freeNow} GB is currently free (of ${hw.totalMemGB} GB) — expect heavy paging (≈1 tok/s or worse). Close memory-heavy apps, lower --ctxSize, or pick a smaller quant: \`lehrosol vault list\` rates every GGUF on your drive for this machine.`;
        }
      }
    }
    // KV-cache OOM guard: llama-server defaults to the model's native context
    // (some Qwen3 models ship 262k). Measured live: a 9B model without
    // --ctxSize tried to allocate an 8 GB KV cache and exited before binding
    // its port. Agentic loop prompts are small — clamp to the balanced profile
    // unless the user asks for more.
    const ctxRequested = flags.ctxSize || flags.ctx;
    const ctxSize = engine.id === 'llamacpp' ? Number(ctxRequested || 4096) : ctxRequested;
    if (engine.id === 'llamacpp' && !ctxRequested) {
      ui.keyValue('Context', '4096 (auto-clamped — models with huge native contexts can OOM the KV cache; override with --ctxSize)');
    }
    if (resourceWarning) ui.warning('Memory pressure risk', resourceWarning);
    if (engine.id === 'llamacpp' && (gpuLayers === 0 || gpuLayers === '0')) {
      ui.keyValue('GPU offload', 'pinned to CPU (integrated-only machine — use --gpuLayers to override)');
    }

    const spec = launchSpec(bin, engine.serveArgs({
      model, port, apiKey,
      detach: engine.detach === 'native' && !foreground,
      ctxSize, gpuLayers,
      mmproj: flags.mmproj,
      // llama.cpp defaults to all logical cores; physical cores are faster on
      // SMT laptops (Intel iGPU class), so auto-tune unless the user pins -t.
      threads: flags.threads ?? flags.t ?? (engine.id === 'llamacpp' ? detectHardware().recommendedThreads : undefined),
      features,
    }));
    if (!spec.ok) {
      ui.error('Could not resolve engine launch command', `bin: ${bin}`);
      process.exitCode = 1;
      return emit({ ok: false, reason: 'launch-spec-failed', engine: engine.id }, flags, logger);
    }

    if (foreground) {
      ui.sectionHeader(`Serving via ${engine.label} (foreground)`);
      ui.keyValue('Endpoint', baseUrl);
      const child = spawn(spec.file, spec.args, { stdio: 'inherit' });
      const code = await new Promise((resolve) => child.on('close', resolve));
      return emit({ ok: code === 0, engine: engine.id, baseUrl, exitCode: code }, flags, logger);
    }

    let pid = null;
    let logPath = null;
    if (engine.detach === 'spawn') {
      // Do not discard the only useful explanation when llama-server exits:
      // keep one rolling per-port log that is returned to both CLI and IDE.
      mkdirSync(lehroHome(), { recursive: true });
      logPath = join(lehroHome(), `llama-server-${port}.log`);
      const logFd = openSync(logPath, 'a');
      const child = spawn(spec.file, spec.args, { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true });
      closeSync(logFd);
      child.on('error', (err) => {
        // A bad/corrupt .exe otherwise emits an unhandled child-process error
        // and leaves the desktop UI with no explanation at all.
        try { writeFileSync(logPath, `[launcher] ${err.message}\n`, { flag: 'a' }); } catch { /* best effort */ }
      });
      child.unref();
      pid = child.pid ?? null;
    } else {
      let output = '';
      try {
        output = execFileSync(spec.file, spec.args, { encoding: 'utf8', timeout: Number(flags.timeout || 180) * 1000 });
      } catch (err) {
        // Jan's detached launcher can return its successful { pid, log,
        // model_id } handoff on a non-zero stream/exit. Treat a valid PID
        // response as a launched server and verify it below via /v1/models;
        // do not reject it before the actual readiness probe.
        output = [err.stdout, err.stderr].filter(Boolean).map(String).join('\n');
        const janDetached = engine.id === 'jan' && /"pid"\s*:\s*\d+/.test(output);
        if (!janDetached) {
          ui.error('Engine failed to start', String(output || err.message).trim().slice(0, 400));
          process.exitCode = 1;
          return emit({ ok: false, reason: 'engine-start-failed', engine: engine.id }, flags, logger);
        }
      }
      const pidMatch = String(output).match(/"pid"\s*:\s*(\d+)/i) || String(output).match(/pid\D{0,5}(\d+)/i) || String(output).match(/\b(\d{2,7})\b/);
      pid = pidMatch ? Number(pidMatch[1]) : null;
    }

    // Loading a multi-GB GGUF from an HDD on a CPU-only laptop often exceeds
    // 60 seconds. The GUI itself waits ten minutes, so the CLI must not fail
    // first and create a false "serve failed" result.
    const readySeconds = Number(flags.readyTimeout || (engine.id === 'llamacpp' ? 300 : 60));
    const ready = await waitForReady(baseUrl, readySeconds * 1000, apiKey);
    const serverModel = ready.models.length === 1 ? ready.models[0] : null;
    const resolvedModel = engine.preferServerModelId ? (serverModel || model) : (model || serverModel);
    const state = {
      engine: engine.id, bin, pid, port, baseUrl,
      model: resolvedModel, requestedModel: rawModel,
      // Persist the key so `serve status|models` and IDE integrations can
      // authenticate against the engine they did not launch themselves.
      apiKey: apiKey || undefined,
      startedAt: new Date().toISOString(), logPath,
    };
    writeState(state);

    const wire = Boolean(flags.use);
    if (wire && ready.ok) wireAdapter(engine, { baseUrl, model: resolvedModel, apiKey });

    const diagnostic = ready.ok ? null : (logPath
      ? (tailText(logPath) || `llama-server did not become ready within ${readySeconds}s; log: ${logPath}`)
      : `Engine did not become ready within ${readySeconds}s`);
    const result = { ok: ready.ok, ...state, models: ready.models, wiredAsPreferred: wire && ready.ok, diagnostic, ...(engine.id === 'llamacpp' ? { ctxSize } : {}), ...(resourceWarning ? { resourceWarning } : {}) };
    if (!flags.json) {
      ui.sectionHeader(`Serving via ${engine.label}`);
      ui.keyValue('Endpoint', baseUrl);
      if (/[\\/]/.test(String(bin))) ui.keyValue('Engine bin', String(bin));
      if (model) ui.keyValue('Model', String(model));
      ui.keyValue('PID', pid != null ? String(pid) : '(unknown — see engine logs)');
      ui.keyValue('Ready', ready.ok ? 'yes' : `no — log: ${logPath || 'not available'}`);
      if (ready.models.length) ui.keyValue('Served as', ready.models.join(', '));
      if (result.wiredAsPreferred) ui.keyValue('Adapter', `${engine.adapterId} configured + set as preferred`);
      ui.nextSteps([
        `Run the loop: lehrosol loop run --prompt "..." --agentAdapter ${engine.adapterId} --dryRun=false`,
        'Check health: lehrosol serve status',
        'Stop engine:  lehrosol serve stop',
      ]);
    }
    return emit(result, flags, logger);
  }

  if (cmd === 'status') {
    const state = readState();
    const baseUrl = state?.baseUrl || `http://localhost:${engine.defaultPort}/v1`;
    const probe = await probeEndpoint(baseUrl, 1500, state?.apiKey);
    const result = { running: probe.ok, unauthorized: probe.unauthorized === true, baseUrl, models: probe.models, state };
    if (!flags.json) {
      ui.sectionHeader('Local Model Server');
      ui.keyValue('Endpoint', baseUrl);
      ui.keyValue('Running', probe.ok ? 'yes' : 'no');
      if (state?.engine) ui.keyValue('Engine', state.engine);
      if (state?.pid != null) ui.keyValue('PID', String(state.pid));
      if (probe.models.length) ui.keyValue('Models', probe.models.join(', '));
      if (!probe.ok) ui.nextSteps(['Start it: lehrosol serve start --model <id> --use']);
    }
    return emit(result, flags, logger);
  }

  if (cmd === 'stop') {
    const state = readState();
    const stopPort = Number(flags.port || state?.port || engine.defaultPort);
    if ((!state || state.pid == null) && !flags.force) {
      if (!flags.json) {
        ui.error(
          'No tracked server',
          'Nothing recorded in ' + stateFile() + '. If an engine is still running, kill the port listener directly \u2014 '
          + `Windows PowerShell: Get-NetTCPConnection -LocalPort ${stopPort} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force } \u2014 `
          + `macOS/Linux: kill $(lsof -ti :${stopPort}).`,
        );
        process.exitCode = 1;
      }
      return emit({ ok: false, reason: 'no-tracked-server' }, flags, logger);
    }
    let stopped = false;
    if (state?.pid != null) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(state.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(state.pid);
        stopped = true;
      } catch { /* already gone */ }
    }
    const forcedPids = flags.force ? forceStopPort(stopPort) : [];
    const freed = flags.force ? await waitForPortFree(`http://localhost:${stopPort}/v1`) : true;
    clearState();
    const result = { ok: freed, stopped, pid: state?.pid ?? null, forcedPids, port: stopPort };
    if (!flags.json) {
      ui.sectionHeader('Local Model Server');
      ui.keyValue('Stopped', forcedPids.length ? `yes (forced pid ${forcedPids.join(', ')})` : (stopped ? `yes (pid ${state?.pid})` : 'no tracked process found'));
    }
    return emit(result, flags, logger);
  }

  if (cmd === 'models') {
    if (!engine.modelsArgs) {
      const state = readState();
      const baseUrl = state?.baseUrl || `http://localhost:${engine.defaultPort}/v1`;
      const probe = await probeEndpoint(baseUrl, 1500, state?.apiKey);
      const result = { ok: probe.ok, unauthorized: probe.unauthorized === true, engine: engine.id, models: probe.models };
      if (!flags.json) {
        ui.sectionHeader(`${engine.label} — served models`);
        if (probe.unauthorized) ui.warning('Key-protected engine on this port', 'Its API key rejects this probe — see `lehrosol serve status` for the tracked key.');
        if (probe.models.length) probe.models.forEach((m) => console.log('  ' + m));
        else console.log('  (no server running — llama.cpp serves one GGUF at a time; see `lehrosol serve start --engine llamacpp`)');
      }
      return emit(result, flags, logger);
    }
    if (!resolveCommand(bin).ok) {
      ui.error(`${engine.label} binary not found on PATH (\`${bin}\`)`, engine.installHint);
      process.exitCode = 1;
      return emit({ ok: false, reason: 'engine-not-installed', engine: engine.id, bin }, flags, logger);
    }
    const spec = launchSpec(bin, engine.modelsArgs());
    try {
      const out = execFileSync(spec.file, spec.args, { encoding: 'utf8', timeout: 30000 });
      if (!flags.json) console.log(out.trimEnd());
      return emit({ ok: true, engine: engine.id, output: out }, flags, logger);
    } catch (err) {
      ui.error('Could not list engine models', String(err.stderr || err.message).trim().slice(0, 400));
      process.exitCode = 1;
      return emit({ ok: false, reason: 'models-list-failed', engine: engine.id }, flags, logger);
    }
  }

  ui.error('Unknown serve subcommand', 'Use: lehrosol serve start|stop|status|models');
  process.exitCode = 1;
  return { ok: false, reason: 'unknown-subcommand' };
}
