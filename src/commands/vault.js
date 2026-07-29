// `lehrosol vault` — the Model Vault: every GGUF on your drive, rated against
// your hardware, servable in one command — no engine app required.
//
//   lehrosol vault                                     # scan + rate everything on disk
//   lehrosol vault serve --model qwopus --port 7000    # host straight from disk
//   lehrosol vault doctor                              # "why can't I host?" answered line by line
//   lehrosol vault add-root --path "E:\\More Models"
import { scanVault, vaultRoots, findLlamaServer, addVaultRoot, resolveVaultModel, recommendLaunch } from '../core/modelVault.js';
import { detectHardware, rateModelFit, suggestRole } from '../core/hardware.js';
import { normalizeResourceProfile, planResources } from '../core/resourcePlanner.js';
import { runServeCommand } from './serve.js';
import { ui } from '../core/ui.js';

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '?';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${Math.round(gb * 10) / 10} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

const FIT_RANK = { great: 0, tight: 1, unknown: 2, 'no-fit': 3 };

// Rate every vault entry against this machine and attach launch tuning.
export function ratedVault(entries, hw) {
  return entries
    .map((e) => {
      const fit = rateModelFit(e.sizeBytes, hw);
      return { ...e, ...fit, role: suggestRole(e.id, e.sizeBytes), launch: recommendLaunch(fit, hw) };
    })
    .sort((a, b) => (FIT_RANK[a.fit] - FIT_RANK[b.fit]) || ((b.sizeBytes || 0) - (a.sizeBytes || 0)));
}

function emit(result, flags, logger) {
  if (flags.json) {
    if (logger && logger.json) logger.json(result);
    else console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

export async function runVaultCommand(subcommand, flags = {}, logger = console) {
  const cmd = subcommand || 'list';

  if (cmd === 'add-root') {
    const p = flags.path || flags.root || flags.dir;
    if (!p) {
      ui.error('Missing --path', 'Example: lehrosol vault add-root --path "D:\\AI Models"');
      process.exitCode = 1;
      return emit({ ok: false, reason: 'missing-path' }, flags, logger);
    }
    const roots = addVaultRoot(p);
    if (!flags.json) {
      ui.sectionHeader('Model Vault — roots');
      roots.forEach((r) => ui.keyValue('root', r));
      ui.nextSteps(['Rescan: lehrosol vault']);
    }
    return emit({ ok: true, roots }, flags, logger);
  }

  const roots = vaultRoots();
  const hw = detectHardware();
  const models = ratedVault(scanVault({ roots }), hw);
  const server = findLlamaServer({ roots });

  if (cmd === 'list' || cmd === 'scan') {
    const result = { ok: true, roots, server, hardware: hw, models };
    if (!flags.json) {
      ui.sectionHeader('Model Vault — GGUF models on this machine');
      ui.keyValue('Roots', roots.length ? roots.join('  ·  ') : '(none found — lehrosol vault add-root --path "D:\\AI Models")');
      ui.keyValue('Engine', server ? `${server.bin} (${server.source})` : 'llama-server NOT found — see `lehrosol vault doctor`');
      ui.keyValue('Budget', `${hw.totalMemGB} GB RAM${hw.gpu ? (hw.gpu.integrated ? ` · ${hw.gpu.name} (integrated — shares RAM; CPU is the fast path)` : ` · ${hw.gpu.name} ${hw.gpu.vramGB} GB VRAM`) : ' · no GPU detected (CPU inference)'}`);
      ui.keyValue('CPU', `${hw.cpuModel} — ${hw.cpuCores} logical threads, inference tuned to ${hw.recommendedThreads}`);
      if (!models.length) ui.keyValue('Models', 'none found under the roots');
      for (const m of models) {
        const tag = m.fit === 'great' ? 'GREAT FIT' : m.fit === 'tight' ? 'TIGHT FIT' : m.fit === 'no-fit' ? 'NO FIT' : 'UNKNOWN';
        ui.keyValue(
          m.id,
          `${fmtBytes(m.sizeBytes)} · ${m.quant || 'gguf'}${m.shards > 1 ? ` · ${m.shards} shards` : ''}${m.mmprojPath ? ' · vision' : ''} · ${tag} (~${m.requiredGB ?? '?'} GB of ${m.budgetGB ?? '?'} GB) · ${m.role}`,
        );
      }
      ui.nextSteps([
        'Host one now:  lehrosol vault serve --model <name> --port 7000',
        'Health check:  lehrosol vault doctor',
        'Add a folder:  lehrosol vault add-root --path "D:\\AI Models"',
      ]);
    }
    return emit(result, flags, logger);
  }

  if (cmd === 'doctor') {
    const fitting = models.filter((m) => m.fit === 'great' || m.fit === 'tight');
    const checks = [
      { name: 'model-roots', ok: roots.length > 0, detail: roots.length ? `${roots.length} root(s): ${roots.join(', ')}` : 'no model folders found — lehrosol vault add-root --path "D:\\AI Models" (or set LEHRO_MODELS_DIR)' },
      { name: 'gguf-models', ok: models.length > 0, detail: models.length ? `${models.length} model(s) on disk` : 'no .gguf files under the roots' },
      { name: 'llama-server', ok: Boolean(server), detail: server ? `${server.bin} (source: ${server.source})` : 'not on PATH, no LEHRO_LLAMACPP_BIN, none bundled under the roots — install llama.cpp or point LEHRO_LLAMACPP_BIN at llama-server' },
      { name: 'fit-budget', ok: fitting.length > 0 || !models.length, detail: `${fitting.length}/${models.length} models fit this machine's ~${Math.round(hw.totalMemGB * 0.7)} GB budget` },
    ];
    const ok = checks.every((c) => c.ok);
    if (!flags.json) {
      ui.sectionHeader('Model Vault — hosting doctor');
      checks.forEach((c) => ui.keyValue(`${c.ok ? '✔' : '✖'} ${c.name}`, c.detail));
      if (ok) ui.nextSteps(['Everything needed for local hosting is present. Host: lehrosol vault serve --model <name>']);
    }
    if (!ok) process.exitCode = 1;
    return emit({ ok, checks, roots, server: server || null, models: models.length }, flags, logger);
  }

  if (cmd === 'serve') {
    if (!models.length) {
      ui.error('No GGUF models found', 'Scan roots with `lehrosol vault`, or add one: lehrosol vault add-root --path "D:\\AI Models"');
      process.exitCode = 1;
      return emit({ ok: false, reason: 'no-models' }, flags, logger);
    }
    const query = flags.model ? String(flags.model) : null;
    const entry = query
      ? resolveVaultModel(query, models)
      : models.find((m) => m.fit === 'great' || m.fit === 'tight') || models[0];
    if (!entry) {
      ui.error(`No vault model matches "${query}"`, `On disk: ${models.map((m) => m.id).join(', ')}`);
      process.exitCode = 1;
      return emit({ ok: false, reason: 'model-not-found', models: models.map((m) => m.id) }, flags, logger);
    }
    if (!server) {
      ui.error('No llama-server binary available', 'Run `lehrosol vault doctor` — install llama.cpp, or set LEHRO_LLAMACPP_BIN to a llama-server binary (Jan\u2019s data folder bundles one under llamacpp\\backends).');
      process.exitCode = 1;
      return emit({ ok: false, reason: 'no-engine' }, flags, logger);
    }
    if (server.source !== 'path') process.env.LEHRO_LLAMACPP_BIN = server.bin;
    const resourceProfile = normalizeResourceProfile(flags.resourceProfile || flags.ramProfile);
    const resourcePlan = planResources(hw, entry, resourceProfile);
    const ctxSize = flags.ctxSize || flags.ctx || resourcePlan.ctxSize;
    const gpuLayers = flags.gpuLayers ?? flags.ngl ?? resourcePlan.gpuLayers;
    const threads = flags.threads ?? flags.t ?? resourcePlan.threads;
    if (!flags.json) {
      ui.sectionHeader('Model Vault — hosting straight from disk');
      ui.keyValue('Model', `${entry.id} (${fmtBytes(entry.sizeBytes)} · ${entry.quant || 'gguf'} · ${entry.fit})`);
      ui.keyValue('File', String(entry.path));
      if (entry.mmprojPath) ui.keyValue('Vision', String(entry.mmprojPath));
      ui.keyValue('Engine', `${server.bin} (${server.source})`);
      ui.keyValue('Resource plan', `${resourcePlan.label}: ${resourcePlan.rationale}`);
      ui.keyValue('Tuning', `ctx ${ctxSize}${gpuLayers != null ? ` · gpu-layers ${gpuLayers}` : ''}${threads ? ` · threads ${threads}` : ''} · auto-picked for this machine`);
      if (resourcePlan.warning) ui.warning('Constrained memory', resourcePlan.warning);
    }
    return runServeCommand('start', {
      engine: 'llamacpp',
      model: entry.path,
      mmproj: entry.mmprojPath || undefined,
      port: flags.port,
      apiKey: flags.apiKey || flags.key,
      ctxSize,
      gpuLayers,
      threads,
      use: flags.use !== false,
      json: flags.json,
      readyTimeout: flags.readyTimeout,
      foreground: flags.foreground,
      resourcePlan,
    }, logger);
  }

  ui.error(`Unknown vault subcommand: ${cmd}`, 'Supported: list · scan · serve · doctor · add-root');
  process.exitCode = 1;
  return emit({ ok: false, reason: 'unknown-subcommand' }, flags, logger);
}
