// Load user-defined agent adapters so LehroSol is usable with ANY open-source
// agent — no code change required. Adapters can be declared in either:
//   • <project>/.lehrorc.json   ->  { "adapters": [ … ] }
//   • ~/.lehro/adapters.json    ->  [ … ]  or  { "adapters": [ … ] }
//
// Each entry:
//   {
//     "id": "my-agent",           // required, unique
//     "label": "My Agent",
//     "kind": "cli" | "http",     // default "cli"
//     // cli:
//     "bin": "my-agent",
//     "args": ["run", "--prompt", "{prompt}"],   // {prompt} is substituted
//     // http (OpenAI-compatible):
//     "baseUrl": "http://localhost:8000/v1",
//     "model": "my-model",
//     "apiKeyEnv": "MY_API_KEY",  // omit for keyless/local endpoints
//     "local": true,
//     "docs": "https://…"
//   }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createCliAdapter } from './makeCliAdapter.js';
import { createHttpAdapter } from './makeHttpAdapter.js';

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function collectDefs(cwd) {
  const defs = [];
  const home = process.env.LEHRO_HOME || join(homedir(), '.lehro');
  const homeFile = join(home, 'adapters.json');
  if (existsSync(homeFile)) {
    const j = readJson(homeFile);
    if (Array.isArray(j)) defs.push(...j);
    else if (j && Array.isArray(j.adapters)) defs.push(...j.adapters);
  }
  const rc = join(cwd, '.lehrorc.json');
  if (existsSync(rc)) {
    const j = readJson(rc);
    if (j && Array.isArray(j.adapters)) defs.push(...j.adapters);
  }
  return defs;
}

export function loadCustomAdapters(cwd = process.cwd()) {
  const out = [];
  for (const def of collectDefs(cwd)) {
    if (!def || !def.id) continue;
    try {
      if ((def.kind || 'cli') === 'http') {
        const a = createHttpAdapter({
          id: def.id, label: def.label || def.id,
          baseUrl: def.baseUrl, model: def.model,
          apiKeyEnv: def.apiKeyEnv, local: def.local, docs: def.docs,
        });
        a.meta.custom = true;
        out.push(a);
      } else {
        const args = Array.isArray(def.args) && def.args.length ? def.args : ['{prompt}'];
        const a = createCliAdapter({
          id: def.id, label: def.label || def.id, bin: def.bin, docs: def.docs,
          buildArgs: (ctx) => args.map((x) => (x === '{prompt}' ? ctx.prompt : String(x))),
        });
        a.meta.custom = true;
        out.push(a);
      }
    } catch { /* skip malformed definitions */ }
  }
  return out;
}
