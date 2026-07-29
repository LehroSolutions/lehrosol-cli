import { listAdapters, probeAdapter } from '../loop/adapters/index.js';
import { findModelProfile, listModelProfiles } from '../core/modelProfiles.js';
import { getFavorites, setPreferredAdapter } from '../core/favorites.js';
import { saveAdapterConfig } from '../core/config.js';
import { ui } from '../core/ui.js';

function findAdapter(id) {
  return listAdapters().find((adapter) => adapter.id === String(id || '').trim().toLowerCase()) || null;
}

export async function runModelsCommand(subcommand, flags, logger = console) {
  const cmd = subcommand || 'list';

  if (cmd === 'list') {
    const profiles = listModelProfiles();
    const adapters = listAdapters();
    const favorites = getFavorites();
    const result = { preferredAdapter: favorites.preferredAdapter, profiles, adapters: adapters.filter((a) => a.kind === 'http') };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader('Model Profiles');
    ui.keyValue('Preferred adapter', favorites.preferredAdapter || '(none)');
    ui.table(['Profile', 'Adapter', 'Model', 'Capability'], profiles.map((p) => [ui.highlight(p.id), p.adapter, p.model, p.capability]));
    ui.nextSteps(['Select: lehrosol models use --profile grok-4.5 --apiKey <XAI_API_KEY>', 'Probe: lehrosol models test --adapter grok']);
    return result;
  }

  if (cmd === 'current') {
    const favorites = getFavorites();
    const adapter = favorites.preferredAdapter ? findAdapter(favorites.preferredAdapter) : null;
    const result = { preferredAdapter: favorites.preferredAdapter, adapter };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader('Current Model');
    ui.keyValue('Preferred adapter', favorites.preferredAdapter || '(none)');
    if (adapter) {
      ui.keyValue('Model', adapter.model || '(adapter default)');
      ui.keyValue('Target', adapter.baseUrl || adapter.bin || '-');
      ui.keyValue('Ready', adapter.configured ? 'yes' : 'no');
    }
    return result;
  }

  if (cmd === 'use') {
    const profile = flags.profile ? findModelProfile(flags.profile) : null;
    const adapterId = String(flags.adapter || profile?.adapter || '').trim().toLowerCase();
    const adapter = findAdapter(adapterId);
    if (!adapter) {
      ui.error('Unknown adapter/profile', 'Run `lehrosol models list` and choose a valid profile or adapter.');
      process.exitCode = 1;
      return { ok: false, reason: 'unknown-adapter' };
    }
    const values = {
      model: flags.model || profile?.model,
      baseUrl: flags.baseUrl || flags.url || profile?.baseUrl,
      apiKey: flags.apiKey || flags.key,
      apiKeyEnv: flags.apiKeyEnv,
    };
    saveAdapterConfig(adapter.id, values);
    setPreferredAdapter(adapter.id, { allowedIds: listAdapters().map((a) => a.id) });
    const result = { ok: true, preferredAdapter: adapter.id, profile: profile?.id || null, model: values.model || adapter.model, baseUrl: values.baseUrl || adapter.baseUrl };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.success(`Preferred model → ${adapter.id}`, result.model || '(adapter default)');
    ui.nextSteps([`Probe: lehrosol models test --adapter ${adapter.id}`, `Run: lehrosol loop run --prompt "inspect this repo" --agentAdapter ${adapter.id} --dryRun=false`, 'Open cockpit: lehrosol tui --mode advanced']);
    return result;
  }

  if (cmd === 'test' || cmd === 'probe') {
    const adapterId = String(flags.adapter || getFavorites().preferredAdapter || '').trim().toLowerCase();
    if (!adapterId) {
      ui.error('No adapter selected', 'Pass --adapter grok or set one with `lehrosol models use`.');
      process.exitCode = 1;
      return { ok: false, reason: 'missing-adapter' };
    }
    const result = await probeAdapter(adapterId, { timeoutMs: Number(flags.timeoutMs || 5000) });
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader(`Model Probe — ${adapterId}`);
    ui.keyValue('Ready', result.ok ? 'yes' : 'no');
    ui.keyValue('Kind', result.kind || '-');
    ui.keyValue('Target', result.target || '-');
    if (result.model) ui.keyValue('Model', result.model);
    if (result.status) ui.keyValue('HTTP status', String(result.status));
    if (result.detail) ui.keyValue('Detail', result.detail);
    if (!result.ok) process.exitCode = 1;
    return result;
  }

  ui.error('Unknown models subcommand: ' + cmd, 'Try: list | current | use | test');
  process.exitCode = 1;
  return null;
}
