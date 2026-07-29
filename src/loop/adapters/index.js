// Adapter registry: every agent Lehro can drive from the Loop Engine — the
// `local` dry-run adapter, real agent CLIs (Claude Code, Codex, Cursor, Qwen,
// Qoder, Zencoder, Amp, Aider, Goose, Gemini, opencode, Hermes), OpenAI-
// compatible HTTP endpoints (Ollama, NVIDIA NIM, xAI Grok, and any other), plus any
// user-defined adapters loaded from config. Each adapter shares one contract
// (see makeCliAdapter.js / makeHttpAdapter.js): given a loop context, return a
// summary, the files it changed, and a policyInput for the Score Agent.
import { execFileSync } from 'node:child_process';
import { commandExists, resolveCommand } from './shared.js';
import { getAdapterConfig } from '../../core/config.js';
import * as local from './local.js';
import * as claudeCode from './claudeCode.js';
import * as codex from './codex.js';
import * as opencode from './opencode.js';
import * as geminiCli from './geminiCli.js';
import * as aider from './aider.js';
import * as goose from './goose.js';
import * as hermesAgent from './hermesAgent.js';
import * as cursor from './cursor.js';
import * as qwen from './qwen.js';
import * as qoder from './qoder.js';
import * as zencoder from './zencoder.js';
import * as amp from './amp.js';
import * as ollama from './ollama.js';
import * as nvidia from './nvidia.js';
import * as grok from './grok.js';
import * as localai from './localai.js';
import * as vllm from './vllm.js';
import * as lmstudio from './lmstudio.js';
import * as jan from './jan.js';
import * as llamacpp from './llamacpp.js';
import { loadCustomAdapters } from './customAdapters.js';

const MODULES = [
  local,
  claudeCode, codex, opencode, geminiCli, aider, goose, hermesAgent,
  cursor, qwen, qoder, zencoder, amp,
  ollama, lmstudio, vllm, localai, nvidia, grok, jan, llamacpp,
];

export const ADAPTERS = {};
export const ADAPTER_META = {};

function register(mod) {
  if (!mod || !mod.meta || !mod.meta.id) return;
  ADAPTERS[mod.meta.id] = mod.run;
  ADAPTER_META[mod.meta.id] = mod.meta;
}

for (const mod of MODULES) register(mod);

// User-defined adapters (config) — do not override built-ins.
try {
  for (const a of loadCustomAdapters()) {
    if (!ADAPTERS[a.meta.id]) register(a);
  }
} catch { /* ignore config errors */ }

function localHttpEndpointReady(baseUrl) {
  if (!baseUrl || !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(String(baseUrl))) return true;
  if (process.env.LEHRO_ASSUME_LOCAL_HTTP_READY === '1') return true;
  try {
    const script = `
      const u = process.argv[1].replace(/\/$/, '') + '/models';
      const c = new AbortController();
      setTimeout(() => c.abort(), 650);
      fetch(u, { signal: c.signal }).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));
    `;
    execFileSync(process.execPath, ['-e', script, String(baseUrl)], { stdio: 'ignore', timeout: 1000 });
    return true;
  } catch { return false; }
}

// Is this adapter ready to run for real (vs. dry-run only)?
export function isAdapterConfigured(meta) {
  if (meta.kind === 'http') {
    const cfg = getAdapterConfig(meta.id);
    const apiKeyEnv = cfg.apiKeyEnv || meta.requiresEnv;
    if (apiKeyEnv && !(cfg.apiKey || process.env[apiKeyEnv])) return false;
    const baseUrl = cfg.baseUrl || meta.baseUrl;
    return meta.local ? localHttpEndpointReady(baseUrl) : true;
  }
  const cfg = getAdapterConfig(meta.id);
  const envKey = 'LEHRO_' + meta.id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_BIN';
  const bin = cfg.bin || process.env[envKey] || meta.bin;
  return bin ? commandExists(bin) : true;
}

export function listAdapters() {
  return Object.values(ADAPTER_META).map((meta) => {
    const cfg = getAdapterConfig(meta.id);
    const envKey = 'LEHRO_' + meta.id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_BIN';
    const runtimeBin = cfg.bin || process.env[envKey] || meta.bin;
    const runtimeBaseUrl = cfg.baseUrl || meta.baseUrl;
    const configured = isAdapterConfigured(meta);
    const publicCfg = Object.assign({}, cfg);
    if (publicCfg.apiKey) publicCfg.apiKey = '********';
    return Object.assign({}, meta, publicCfg, {
      bin: runtimeBin,
      baseUrl: runtimeBaseUrl,
      model: cfg.model || meta.model,
      kind: meta.kind || (meta.bin ? 'cli' : 'builtin'),
      installed: configured,
      configured,
      resolvedCommand: runtimeBin ? resolveCommand(runtimeBin).command : null,
      configuredVia: Object.keys(cfg).length ? 'saved-config' : 'environment/path',
    });
  });
}


export async function probeAdapter(id, options = {}) {
  const key = String(id || '').trim().toLowerCase();
  const meta = ADAPTER_META[key];
  if (!meta) return { ok: false, adapter: key, detail: 'unknown adapter' };
  const listed = listAdapters().find((a) => a.id === key);
  if (!listed) return { ok: false, adapter: key, detail: 'adapter not listed' };

  if (listed.kind === 'builtin') {
    return { ok: true, adapter: key, kind: 'builtin', target: 'in-process', detail: 'available' };
  }
  if (listed.kind === 'cli') {
    const resolved = resolveCommand(listed.bin);
    return {
      ok: Boolean(resolved.ok), adapter: key, kind: 'cli', target: resolved.command || listed.bin,
      detail: resolved.ok ? 'command resolved' : 'command not found',
    };
  }

  const cfg = getAdapterConfig(key);
  const baseUrl = cfg.baseUrl || listed.baseUrl;
  const apiKeyEnv = cfg.apiKeyEnv || listed.requiresEnv;
  const apiKey = cfg.apiKey || (apiKeyEnv ? process.env[apiKeyEnv] : null);
  if (apiKeyEnv && !apiKey) {
    return { ok: false, adapter: key, kind: 'http', target: baseUrl, model: cfg.model || listed.model, detail: `missing ${apiKeyEnv}` };
  }
  const timeoutMs = Math.max(250, Math.min(Number(options.timeoutMs || 5000), 30000));
  const url = `${String(baseUrl || '').replace(/\/$/, '')}/models`;
  try {
    const res = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    let detail = res.ok ? 'endpoint and credentials accepted' : `HTTP ${res.status}`;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (body) detail += `: ${body.slice(0, 180)}`;
    }
    return { ok: res.ok, adapter: key, kind: 'http', target: baseUrl, model: cfg.model || listed.model, status: res.status, detail };
  } catch (err) {
    return { ok: false, adapter: key, kind: 'http', target: baseUrl, model: cfg.model || listed.model, detail: String((err && err.message) || err) };
  }
}
