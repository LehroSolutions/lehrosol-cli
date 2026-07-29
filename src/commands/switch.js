// `lehrosol switch` — the HELIX Switchboard.
// One interactive sweep: MODE → AGENT ADAPTER → MODEL, with every adapter
// live-probed and models discovered from the provider's real endpoint
// (Jan's catalog, Ollama's tags, LM Studio, etc.). Also scriptable:
//   lehrosol switch --mode forge --adapter jan --model <id>
import { createInterface } from 'node:readline/promises';
import { listAdapters, probeAdapter } from '../loop/adapters/index.js';
import { getAdapterConfig, saveAdapterConfig } from '../core/config.js';
import { getFavorites, setPreferredAdapter } from '../core/favorites.js';
import { MODES, getMode, getPreferredMode, setPreferredMode } from '../core/modes.js';
import { ui } from '../core/ui.js';

async function fetchEndpointModels(baseUrl, apiKey) {
  try {
    const res = await fetch(String(baseUrl).replace(/\/$/, '') + '/models', {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const data = Array.isArray(json && json.data) ? json.data : [];
    return data.filter((m) => m && m.id).map((m) => String(m.id));
  } catch {
    return [];
  }
}

function summarize(mode, adapterId, model) {
  ui.sectionHeader('Switchboard \u2014 Locked In');
  ui.keyValue('Mode', mode ? `${mode.glyph} ${mode.label} (${mode.id})` : '(unchanged)');
  ui.keyValue('Adapter', adapterId || '(unchanged)');
  ui.keyValue('Model', model || '(adapter default)');
  ui.nextSteps([
    `Run: lehrosol loop run --prompt "..."${adapterId ? ` --agentAdapter ${adapterId}` : ''} --dryRun=false`,
    'Re-sweep any time: lehrosol switch',
  ]);
}

export async function runSwitchCommand(flags = {}, logger = console) {
  const allAdapters = listAdapters();
  const allowedIds = allAdapters.map((a) => a.id);

  // Scriptable fast path — no prompts.
  if (flags.mode || flags.adapter || flags.model) {
    let mode = null;
    if (flags.mode) {
      mode = getMode(flags.mode);
      if (!mode) { ui.error(`Unknown mode: ${flags.mode}`, `Valid: ${MODES.map((m) => m.id).join(', ')}`); process.exitCode = 1; return; }
      setPreferredMode(mode.id);
    }
    let adapterId = null;
    if (flags.adapter) {
      adapterId = String(flags.adapter);
      if (!allowedIds.includes(adapterId)) { ui.error(`Unknown adapter: ${adapterId}`, `Valid: ${allowedIds.join(', ')}`); process.exitCode = 1; return; }
      setPreferredAdapter(adapterId, { allowedIds });
    }
    let model = null;
    if (flags.model) {
      model = String(flags.model);
      const target = adapterId || getFavorites().preferredAdapter;
      if (!target) { ui.error('No adapter to attach the model to', 'Pass --adapter as well, or set a preferred adapter first.'); process.exitCode = 1; return; }
      saveAdapterConfig(target, { model });
    }
    if (flags.json) { logger.json({ ok: true, mode: mode?.id || null, adapter: adapterId, model }); return; }
    summarize(mode, adapterId, model);
    return;
  }

  // Interactive sweep.
  ui.sectionHeader('HELIX Switchboard');
  console.log('  Sweep through MODE \u2192 ADAPTER \u2192 MODEL. Press Enter to keep the current value.\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // ── 1. MODE ──
    const currentMode = getPreferredMode();
    console.log('  \u2500\u2500 MODE \u2500\u2500');
    MODES.forEach((m, i) => {
      const active = currentMode && currentMode.id === m.id ? '\u25cf' : ' ';
      console.log(`  ${active} [${i + 1}] ${m.glyph} ${m.label.padEnd(9)} ${m.tagline}`);
    });
    const modeAns = (await rl.question(`\n  Mode 1-${MODES.length} (Enter = ${currentMode ? currentMode.id : 'none'}): `)).trim();
    let mode = currentMode;
    if (modeAns) {
      const pick = MODES[Number(modeAns) - 1] || getMode(modeAns);
      if (pick) { mode = setPreferredMode(pick.id); }
      else console.log('  (unrecognized \u2014 keeping current mode)');
    }

    // ── 2. ADAPTER ── live probe of every registered adapter, in parallel.
    console.log('\n  \u2500\u2500 AGENT ADAPTER \u2500\u2500 (probing all live\u2026)');
    const probes = await Promise.all(allAdapters.map((a) => probeAdapter(a.id, { timeoutMs: 2500 }).catch(() => ({ ok: false, adapter: a.id, detail: 'probe failed' }))));
    const byId = new Map(probes.map((p) => [p.adapter, p]));
    const preferred = getFavorites().preferredAdapter;
    const ready = allAdapters.filter((a) => byId.get(a.id)?.ok);
    const offline = allAdapters.filter((a) => !byId.get(a.id)?.ok);
    ready.forEach((a, i) => {
      const star = preferred === a.id ? '\u25cf' : ' ';
      console.log(`  ${star} [${i + 1}] ${a.id.padEnd(14)} READY   ${a.label}`);
    });
    offline.forEach((a) => {
      const why = byId.get(a.id)?.detail || 'offline';
      console.log(`      -  ${a.id.padEnd(14)} OFFLINE (${String(why).slice(0, 48)})`);
    });
    if (!ready.length) console.log('  (no adapters are live \u2014 start one, e.g. lehrosol serve start --model <id> --use)');
    const adAns = ready.length ? (await rl.question(`\n  Adapter 1-${ready.length} (Enter = ${preferred || 'unchanged'}): `)).trim() : '';
    let adapterId = preferred;
    if (adAns) {
      const pick = ready[Number(adAns) - 1] || ready.find((a) => a.id === adAns.toLowerCase());
      if (pick) { adapterId = pick.id; setPreferredAdapter(pick.id, { allowedIds }); }
      else console.log('  (unrecognized \u2014 keeping current adapter)');
    }

    // ── 3. MODEL ── discovered live from the chosen provider's endpoint.
    let model = null;
    const chosen = allAdapters.find((a) => a.id === adapterId);
    if (chosen && chosen.kind === 'http') {
      const cfg = getAdapterConfig(chosen.id);
      const models = await fetchEndpointModels(cfg.baseUrl || chosen.baseUrl, cfg.apiKey || null);
      if (models.length) {
        console.log(`\n  \u2500\u2500 MODEL \u2500\u2500 (live from ${chosen.label})`);
        models.forEach((id, i) => {
          const star = (cfg.model || chosen.model) === id ? '\u25cf' : ' ';
          console.log(`  ${star} [${i + 1}] ${id}`);
        });
        const mAns = (await rl.question(`\n  Model 1-${models.length} (Enter = ${cfg.model || chosen.model || 'default'}): `)).trim();
        if (mAns) {
          const pick = models[Number(mAns) - 1] || models.find((id) => id === mAns);
          if (pick) { model = pick; saveAdapterConfig(chosen.id, { model: pick }); }
          else console.log('  (unrecognized \u2014 keeping current model)');
        }
      } else {
        console.log(`\n  (no models reported by ${chosen.label} \u2014 is its server running?)`);
      }
    }

    console.log('');
    summarize(mode, adapterId, model);
  } finally {
    rl.close();
  }
}
