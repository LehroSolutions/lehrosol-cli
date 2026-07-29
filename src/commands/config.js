import { CONFIG_PATH, getAdapterConfig, listAdapterConfigs, normalizeAdapterId, removeAdapterConfig, saveAdapterConfig } from '../core/config.js';
import { listAdapters } from '../loop/adapters/index.js';
import { ui } from '../core/ui.js';

const SECRET_KEYS = new Set(['apiKey', 'token', 'password']);

function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 8) return '********';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

function safeEntry(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = SECRET_KEYS.has(k) ? mask(v) : v;
  return out;
}

function adapterById(id) {
  const key = normalizeAdapterId(id);
  return listAdapters().find((a) => a.id === key);
}

function setupHint(adapter) {
  if (!adapter) return 'Unknown adapter. Run: lehrosol adapters';
  if (adapter.kind === 'http') {
    if (adapter.id === 'grok') return 'lehrosol config set --adapter grok --apiKey <XAI_API_KEY> --model grok-4.5';
    if (adapter.id === 'nvidia') return 'lehrosol config set --adapter nvidia --apiKey <NVIDIA_API_KEY> --model <model>';
    return `lehrosol config set --adapter ${adapter.id} --baseUrl ${adapter.baseUrl || '<url>'} --model <model>`;
  }
  return `lehrosol config set --adapter ${adapter.id} --bin <path-or-command>`;
}

export function runConfigCommand(subcommand, flags, logger = console) {
  const cmd = subcommand || 'list';

  if (cmd === 'list') {
    const configs = listAdapterConfigs();
    const result = { path: CONFIG_PATH, adapters: Object.fromEntries(Object.entries(configs).map(([k, v]) => [k, safeEntry(v)])) };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader('LehroSol Configuration');
    ui.keyValue('Config file', CONFIG_PATH);
    const rows = Object.entries(result.adapters).map(([id, cfg]) => [ui.highlight(id), JSON.stringify(cfg)]);
    if (rows.length) ui.table(['Adapter', 'Saved config'], rows);
    else ui.info('No saved adapter config yet', 'Run: lehrosol config wizard');
    return result;
  }

  if (cmd === 'show') {
    const id = normalizeAdapterId(flags.adapter || flags.id || flags._ || '');
    if (!id) { ui.error('Missing adapter', 'Example: lehrosol config show --adapter nvidia'); process.exitCode = 1; return; }
    const result = { adapter: id, config: safeEntry(getAdapterConfig(id)) };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader(`Config — ${id}`);
    ui.keyValue('Config file', CONFIG_PATH);
    ui.keyValue('Saved config', JSON.stringify(result.config));
    return result;
  }

  if (cmd === 'set') {
    const id = normalizeAdapterId(flags.adapter || flags.id || flags._ || '');
    if (!id) { ui.error('Missing adapter', 'Example: lehrosol config set --adapter nvidia --apiKey <key> --model <model>'); process.exitCode = 1; return; }
    const values = {
      apiKey: flags.apiKey || flags.key,
      apiKeyEnv: flags.apiKeyEnv,
      baseUrl: flags.baseUrl || flags.url,
      model: flags.model,
      timeoutMs: flags.timeoutMs,
      bin: flags.bin || flags.command,
    };
    const saved = saveAdapterConfig(id, values);
    const result = { adapter: id, config: safeEntry(saved), path: CONFIG_PATH };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader(`Config saved — ${id}`);
    ui.keyValue('Config file', CONFIG_PATH);
    ui.keyValue('Saved', JSON.stringify(result.config));
    ui.nextSteps([
      `Check readiness: lehrosol adapters`,
      `Run live: lehrosol loop run --prompt "inspect this repo" --agentAdapter ${id} --dryRun=false`,
      `Open cockpit: lehrosol tui --mode advanced`,
    ]);
    return result;
  }

  if (cmd === 'unset' || cmd === 'remove' || cmd === 'delete') {
    const id = normalizeAdapterId(flags.adapter || flags.id || flags._ || '');
    if (!id) { ui.error('Missing adapter', 'Example: lehrosol config unset --adapter nvidia'); process.exitCode = 1; return; }
    removeAdapterConfig(id);
    const result = { adapter: id, removed: true, path: CONFIG_PATH };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.success(`Removed saved config for ${id}`, CONFIG_PATH);
    return result;
  }

  if (cmd === 'doctor' || cmd === 'check') {
    const adapters = listAdapters();
    const result = { adapters: adapters.map((a) => ({ id: a.id, label: a.label, kind: a.kind, configured: a.configured, target: a.kind === 'http' ? a.baseUrl : a.bin, model: a.model, setup: a.configured ? null : setupHint(a) })) };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader('Adapter Configuration Doctor');
    ui.table(['Adapter', 'Kind', 'Ready', 'Target / Setup'], result.adapters.map((a) => [
      ui.highlight(a.id), a.kind, a.configured ? ui.highlight('READY') : 'NOT READY', a.configured ? (a.target || '-') : a.setup,
    ]));
    return result;
  }

  if (cmd === 'wizard') {
    ui.sectionHeader('Adapter Setup Wizard');
    ui.info('Fast setup examples', 'Run one of these, then `lehrosol adapters`');
    ui.list([
      'Grok/xAI: lehrosol config set --adapter grok --apiKey <XAI_API_KEY> --model grok-4.5',
      'NVIDIA: lehrosol config set --adapter nvidia --apiKey <key> --model nvidia/llama-3.1-nemotron-70b-instruct',
      'Ollama:  lehrosol config set --adapter ollama --baseUrl http://localhost:11434/v1 --model qwen2.5-coder:7b',
      'LM Studio: lehrosol config set --adapter lmstudio --baseUrl http://localhost:1234/v1 --model local-model',
      'OpenCode custom path: lehrosol config set --adapter opencode --bin C:\\path\\to\\opencode.cmd',
      'Claude Code custom path: lehrosol config set --adapter claude-code --bin claude',
      'Codex custom path: lehrosol config set --adapter codex --bin codex',
    ], 'Recipes');
    return { path: CONFIG_PATH };
  }

  ui.error('Unknown config subcommand: ' + cmd, 'Try: list | set | show | unset | doctor | wizard');
  process.exitCode = 1;
}
