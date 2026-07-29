// `lehrosol recommend` — hardware-aware model recommendations.
// Reads the machine's RAM/CPU/GPU, discovers local models (Jan CLI catalog
// first, live OpenAI-compatible endpoints as fallback), and rates each model:
// does it fit, does it accelerate, and what role should it play in the loop.
import { execFileSync } from 'node:child_process';
import { resolveCommand, launchSpec } from '../loop/adapters/shared.js';
import { detectHardware, rateModelFit, suggestRole } from '../core/hardware.js';
import { getAdapterConfig } from '../core/config.js';
import { listAdapters } from '../loop/adapters/index.js';
import { ui } from '../core/ui.js';

const GB = 1024 ** 3;
const round1 = (n) => Math.round(n * 10) / 10;

export function janCliModels() {
  const bin = process.env.LEHRO_JAN_BIN || 'jan';
  if (!resolveCommand(bin).ok) return null;
  try {
    const spec = launchSpec(bin, ['models', 'list']);
    const out = execFileSync(spec.file, spec.args, { encoding: 'utf8', timeout: 30000 });
    const start = out.indexOf('[');
    const end = out.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(out.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    return arr
      .filter((m) => m && m.id)
      .map((m) => ({ id: String(m.id), sizeBytes: Number(m.size_bytes) || null, source: 'jan' }));
  } catch {
    return null;
  }
}

async function endpointModels(adapterId, baseUrl, apiKey) {
  try {
    const res = await fetch(String(baseUrl).replace(/\/$/, '') + '/models', {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const data = Array.isArray(json && json.data) ? json.data : [];
    return data
      .filter((m) => m && m.id)
      .map((m) => ({ id: String(m.id), sizeBytes: Number(m.size_bytes) || null, source: adapterId }));
  } catch {
    return [];
  }
}

export async function runRecommendCommand(flags = {}, logger = console) {
  const hw = detectHardware();

  // Discover models: Jan CLI catalog gives sizes; live local endpoints fill gaps.
  const seen = new Map();
  for (const m of janCliModels() || []) seen.set(m.id, m);
  const localHttp = listAdapters().filter((a) => a.kind === 'http' && a.local);
  const probes = await Promise.all(localHttp.map((a) => {
    const cfg = getAdapterConfig(a.id);
    return endpointModels(a.id, cfg.baseUrl || a.baseUrl, cfg.apiKey || null);
  }));
  for (const list of probes) {
    for (const m of list) if (!seen.has(m.id)) seen.set(m.id, m);
  }
  const models = Array.from(seen.values());

  const rated = models.map((m) => {
    const fit = rateModelFit(m.sizeBytes, hw);
    return { ...m, ...fit, role: suggestRole(m.id, m.sizeBytes) };
  });
  const fitRank = { great: 0, tight: 1, unknown: 2, 'no-fit': 3 };
  rated.sort((a, b) => (fitRank[a.fit] - fitRank[b.fit]) || ((b.sizeBytes || 0) - (a.sizeBytes || 0)));

  const coder = rated.find((r) => (r.fit === 'great' || r.fit === 'tight') && /coding/.test(r.role));
  const planner = rated.find((r) => (r.fit === 'great' || r.fit === 'tight') && /planning/.test(r.role));
  const generalist = rated.find((r) => (r.fit === 'great' || r.fit === 'tight') && /general/.test(r.role));

  if (flags.json) {
    logger.json({ hardware: hw, models: rated, picks: { coder: coder?.id || null, planner: planner?.id || null, generalist: generalist?.id || null } });
    return;
  }

  ui.sectionHeader('Your Machine');
  ui.keyValue('CPU', `${hw.cpuModel} (${hw.cpuCores} logical threads \u2014 inference tuned to ${hw.recommendedThreads})`);
  ui.keyValue('RAM', `${hw.totalMemGB} GB total, ${hw.freeMemGB} GB free right now`);
  ui.keyValue('GPU', hw.gpu ? (hw.gpu.integrated ? `${hw.gpu.name} \u2014 integrated: shares system RAM, CPU is the inference path` : `${hw.gpu.name} (${hw.gpu.vramGB} GB VRAM)`) : 'none detected \u2014 CPU inference budget assumed');

  if (!rated.length) {
    ui.warning('No local models discovered', 'Install models in Jan (data folder) or start a local server, then re-run. Jan CLI on PATH lets this command read the full catalog with sizes.');
    return;
  }

  ui.sectionHeader('Model Fit Report');
  const fitLabel = { great: 'FITS WELL', tight: 'TIGHT', 'no-fit': 'TOO BIG', unknown: 'UNKNOWN' };
  ui.table(
    ['Model', 'Size', 'Needs', 'Fit', 'Runs on', 'Best role'],
    rated.map((r) => [
      r.id.length > 38 ? r.id.slice(0, 35) + '\u2026' : r.id,
      r.sizeBytes ? `${round1(r.sizeBytes / GB)} GB` : '?',
      r.requiredGB != null ? `~${r.requiredGB} GB` : '?',
      fitLabel[r.fit],
      r.fit === 'unknown' ? '?' : (r.accelerated ? 'GPU' : 'CPU'),
      r.role,
    ]),
  );

  ui.sectionHeader('Recommended Setup');
  if (coder) ui.keyValue('Coding loop', coder.id);
  if (planner && planner.id !== (coder && coder.id)) ui.keyValue('Planning/review', planner.id);
  if (generalist && ![coder && coder.id, planner && planner.id].includes(generalist.id)) ui.keyValue('Generalist', generalist.id);
  if (!coder && !planner && !generalist) ui.keyValue('Note', 'No model comfortably fits \u2014 prefer smaller quants (IQ4_XS/Q4_K_M) of 4B-class models.');
  const first = coder || generalist || planner;
  ui.nextSteps([
    first ? `Serve it: lehrosol serve start --model ${first.id} --use` : 'Add a 4B-class Q4 coder model in Jan, then re-run: lehrosol recommend',
    'Free RAM first: close stale servers (lehrosol serve stop) and heavy apps for a bigger budget.',
    'Then: lehrosol loop run --prompt "..." --agentAdapter jan --dryRun=false',
  ]);
}
