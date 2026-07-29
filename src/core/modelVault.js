// Model Vault — LehroSol's own view of every GGUF stored on this machine.
//
// The whole point of the harness is sovereignty over local models: the drive
// is the source of truth, not any one engine's catalog. The vault:
//   1. scans configured + auto-guessed roots (e.g. D:\AI Models) for *.gguf
//   2. groups multi-shard files and pairs mmproj companions with their model
//   3. finds a runnable `llama-server` binary — PATH, env override, or the
//      one already bundled inside an engine's data folder (Jan ships its own
//      under <data>/llamacpp/backends/**) — so hosting works even when the
//      engine app itself is struggling.
// Zero dependencies; pure fs walking with bounded depth.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, saveConfig } from './config.js';
import { resolveCommand } from '../loop/adapters/shared.js';

const GGUF_RE = /\.gguf$/i;
const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/i;
const FIRST_SHARD_RE = /-00001-of-\d{5}\.gguf$/i;
const MMPROJ_RE = /(^|[\\/\-_.])mmproj/i;
const GENERIC_BASE_RE = /^(model|ggml-model.*|weights?)$/i;

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// Quantization tag from a model file/folder name (Q4_K_M, IQ4_XS, BF16, …).
export function parseQuant(name) {
  const m = String(name || '').match(/\b(IQ\d+_[A-Z0-9]+|Q\d+_K_[A-Z0-9]+|Q\d+_K|Q\d+_\d+|Q\d+|BF16|F16|F32|MXFP4)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// Roots to scan, in priority order: LEHRO_MODELS_DIR (path-list), config
// vault.roots, then auto-guesses for common model homes (Jan data folders).
export function vaultRoots() {
  const candidates = [];
  const env = process.env.LEHRO_MODELS_DIR;
  if (env) for (const p of env.split(delimiter)) if (p.trim()) candidates.push(p.trim());
  try {
    const cfg = loadConfig();
    for (const p of (cfg.vault && Array.isArray(cfg.vault.roots) ? cfg.vault.roots : [])) candidates.push(p);
  } catch { /* config unreadable — guesses still apply */ }
  if (process.platform === 'win32') {
    for (const letter of ['C', 'D', 'E', 'F', 'G']) candidates.push(`${letter}:\\AI Models`);
  }
  candidates.push(join(homedir(), 'AI Models'), join(homedir(), 'jan'), join(homedir(), '.cache', 'llama.cpp'));
  const seen = new Set();
  const roots = [];
  for (const c of candidates) {
    let norm;
    try { norm = resolve(c); } catch { continue; }
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isDir(norm)) roots.push(norm);
  }
  return roots;
}

export function addVaultRoot(path) {
  const config = loadConfig();
  config.vault = config.vault || {};
  const roots = Array.isArray(config.vault.roots) ? config.vault.roots.slice() : [];
  const norm = resolve(String(path));
  if (!roots.some((r) => { try { return resolve(r).toLowerCase() === norm.toLowerCase(); } catch { return false; } })) {
    roots.push(norm);
  }
  config.vault.roots = roots;
  saveConfig(config);
  return roots;
}

function walk(root, onFile, maxDepth = 7) {
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let dirents = [];
    try { dirents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      const name = d.name;
      if (name.startsWith('.') || name === 'node_modules') continue;
      const full = join(dir, name);
      if (d.isDirectory()) {
        if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
      } else if (d.isFile()) {
        onFile(full, name);
      }
    }
  }
}

// Scan for GGUF models. Returns one entry per model:
//   { id, path, dir, root, sizeBytes, shards, quant, mmprojPath }
// - multi-shard models collapse into one entry (path = the -00001-of- shard,
//   which is what llama-server must be pointed at; sizeBytes = sum of shards)
// - mmproj*.gguf files are vision companions, attached to the model that
//   shares their folder instead of being listed as models themselves
export function scanVault({ roots } = {}) {
  const useRoots = roots && roots.length ? roots.map((r) => resolve(r)) : vaultRoots();
  const groups = new Map();
  const mmprojByDir = new Map();
  for (const root of useRoots) {
    walk(root, (full, name) => {
      if (!GGUF_RE.test(name)) return;
      let size = 0;
      try { size = statSync(full).size; } catch { /* unreadable file still listed */ }
      const dir = dirname(full);
      if (MMPROJ_RE.test(name)) {
        mmprojByDir.set(dir, full);
        return;
      }
      const base = name.replace(SHARD_RE, '').replace(GGUF_RE, '');
      const key = `${dir.toLowerCase()}::${base.toLowerCase()}`;
      const g = groups.get(key) || { dir, base, root, shards: 0, sizeBytes: 0, path: null };
      g.shards += 1;
      g.sizeBytes += size;
      // Servable path: the -00001-of- shard wins; otherwise first file seen.
      if (g.path == null || FIRST_SHARD_RE.test(name)) g.path = full;
      groups.set(key, g);
    });
  }
  const entries = [];
  for (const g of groups.values()) {
    const id = GENERIC_BASE_RE.test(g.base) ? basename(g.dir) : g.base;
    entries.push({
      id,
      path: g.path,
      dir: g.dir,
      root: g.root,
      sizeBytes: g.sizeBytes,
      shards: g.shards,
      quant: parseQuant(g.base) || parseQuant(basename(g.dir)),
      mmprojPath: mmprojByDir.get(g.dir) || null,
    });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

// Find a runnable llama-server binary without requiring any manual install:
//   1. LEHRO_LLAMACPP_BIN (explicit override)
//   2. `llama-server` on PATH
//   3. a binary bundled inside a vault root — Jan's data folder ships its own
//      llama.cpp backends under <data>/llamacpp/backends/<ver>/<variant>/build/bin
// Returns { bin, source: 'env' | 'path' | 'vault' } or null.
export function findLlamaServer({ roots } = {}) {
  const envBin = process.env.LEHRO_LLAMACPP_BIN;
  if (envBin) {
    if (existsSync(envBin) || resolveCommand(envBin).ok) return { bin: envBin, source: 'env' };
  }
  if (resolveCommand('llama-server').ok) return { bin: 'llama-server', source: 'path' };
  const useRoots = roots && roots.length ? roots.map((r) => resolve(r)) : vaultRoots();
  const hits = [];
  for (const root of useRoots) {
    walk(root, (full, name) => {
      const lower = name.toLowerCase();
      if (lower === 'llama-server' || lower === 'llama-server.exe') hits.push(full);
    }, 8);
  }
  if (!hits.length) return null;
  hits.sort(); // versioned backend folders sort ascending — take the newest
  return { bin: hits[hits.length - 1], source: 'vault' };
}

// Resolve a user-supplied model name against the vault: exact id match first,
// then substring of id, then substring of the file path.
export function resolveVaultModel(query, entries = null) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const list = entries || scanVault({});
  return (
    list.find((e) => e.id.toLowerCase() === q)
    || list.find((e) => e.id.toLowerCase().includes(q))
    || list.find((e) => String(e.path).toLowerCase().includes(q))
    || null
  );
}

// Launch settings that bring out the best of a model on THIS machine:
// roomy context when it fits with headroom, conservative when it's tight,
// full GPU offload only when the whole working set fits in VRAM.
// When hardware is provided, a physical-core thread count is included so
// CPU-bound boxes (integrated GPUs like Intel UHD) run at their real speed.
export function recommendLaunch(fitInfo, hw = null) {
  const fit = fitInfo && fitInfo.fit;
  const ctxSize = fit === 'great' ? 8192 : fit === 'tight' ? 4096 : 2048;
  const gpuLayers = fitInfo && fitInfo.accelerated ? 999 : 0;
  const launch = { ctxSize, gpuLayers };
  if (hw && Number.isFinite(hw.recommendedThreads)) launch.threads = hw.recommendedThreads;
  return launch;
}
