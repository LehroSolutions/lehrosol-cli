// Zero-dependency config + local auth/secrets store.
// Pattern borrowed from gidevo-api-tool's AuthService (~/.gidevo-api-tool/config.json)
// generalized to ~/.lehro/config.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const LEHRO_HOME = process.env.LEHRO_HOME || join(homedir(), '.lehro');
export const CONFIG_PATH = join(LEHRO_HOME, 'config.json');
export const CHECKPOINTS_DIR = join(LEHRO_HOME, 'checkpoints');
export const SESSIONS_DB = join(LEHRO_HOME, 'sessions.sqlite');

function ensureHome() {
  if (!existsSync(LEHRO_HOME)) mkdirSync(LEHRO_HOME, { recursive: true, mode: 0o700 });
}

export function loadConfig() {
  ensureHome();
  if (!existsSync(CONFIG_PATH)) return { version: 1, providers: {}, projects: {} };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { version: 1, providers: {}, projects: {} };
  }
}

export function saveConfig(config) {
  ensureHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* best effort on non-POSIX */ }
  return config;
}

export function readProjectConfig(cwd = process.cwd()) {
  const rcPath = join(cwd, '.lehrorc.json');
  if (!existsSync(rcPath)) return {};
  try {
    return JSON.parse(readFileSync(rcPath, 'utf8'));
  } catch {
    return {};
  }
}


export function normalizeAdapterId(id) {
  const raw = String(id || '').trim().toLowerCase();
  const aliases = {
    claude: 'claude-code',
    'claude_code': 'claude-code',
    'cloud-code': 'claude-code',
    cloudcode: 'claude-code',
    opencode: 'opencode',
    open_code: 'opencode',
    open: 'opencode',
    qwen: 'qwen',
    qwencoder: 'qwen',
    'qwen-coder': 'qwen',
    qodercode: 'qoder',
    qodercli: 'qoder',
    qoder: 'qoder',
    nvidia: 'nvidia',
    nim: 'nvidia',
    grok: 'grok',
    xai: 'grok',
    'x-ai': 'grok',
    'grok-4': 'grok',
    'grok-4.5': 'grok',
    ollama: 'ollama',
    lmstudio: 'lmstudio',
    'lm-studio': 'lmstudio',
    vllm: 'vllm',
    localai: 'localai',
    'local-ai': 'localai',
    codex: 'codex',
    cursor: 'cursor',
  };
  return aliases[raw] || raw;
}

export function getAdapterConfig(id) {
  const config = loadConfig();
  const key = normalizeAdapterId(id);
  const adapters = config.adapters || config.providers || {};
  return Object.assign({}, adapters[key] || {});
}

export function listAdapterConfigs() {
  const config = loadConfig();
  return Object.assign({}, config.adapters || config.providers || {});
}

export function saveAdapterConfig(id, values) {
  const config = loadConfig();
  const key = normalizeAdapterId(id);
  config.version = config.version || 1;
  config.adapters = config.adapters || {};
  const clean = Object.assign({}, config.adapters[key] || {});
  for (const [k, v] of Object.entries(values || {})) {
    if (v === undefined || v === null || v === '') continue;
    clean[k] = v;
  }
  clean.updatedAt = new Date().toISOString();
  config.adapters[key] = clean;
  return saveConfig(config).adapters[key];
}

export function removeAdapterConfig(id) {
  const config = loadConfig();
  const key = normalizeAdapterId(id);
  if (config.adapters) delete config.adapters[key];
  if (config.providers) delete config.providers[key];
  saveConfig(config);
  return true;
}
