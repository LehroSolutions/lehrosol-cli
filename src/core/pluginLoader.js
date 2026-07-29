// Plugin/adapter loader, generalized from gidevo-api-tool's plugin-design.md.
// Two plugin kinds share one contract: { name, initialize(options), run(...args) }
//   - "capability" plugins: policy rules, generators, scanners
//   - "agent adapter" plugins: wrap an external coding-agent CLI (Claude Code,
//     Codex, Gemini CLI, OpenCode, Aider, Goose, Hermes Agent, ...) so the
//     orchestrator can spawn/drive it uniformly.
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SAFE_JS_NAME = /^[a-zA-Z0-9_-]+\.(mjs|js)$/;

export async function loadPlugins(dir) {
  const plugins = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return plugins;
  }
  const approvedRoot = resolve(dir);
  for (const entry of entries) {
    if (!SAFE_JS_NAME.test(entry)) continue;
    const fullPath = join(dir, entry);
    let real;
    try {
      real = realpathSync(fullPath);
    } catch {
      continue;
    }
    if (!real.startsWith(approvedRoot)) continue; // reject symlink escapes
    if (!statSync(real).isFile()) continue;
    const mod = await import(pathToFileURL(real).href);
    const exported = mod.default ?? mod;
    const instance = typeof exported === 'function' ? new exported() : exported;
    if (instance && typeof instance.run === 'function' && instance.name) {
      plugins.push(instance);
    }
  }
  return plugins;
}

export function findPlugin(plugins, name) {
  const needle = name.toLowerCase();
  return plugins.find((p) => p.name.toLowerCase() === needle);
}
