export * from './modelProfiles.js';
export * from './favorites.js';
export * from './config.js';
export * from './pathSafety.js';
export * from './pluginLoader.js';
export * from './logger.js';
import { readFileSync } from 'node:fs';

// Single source of truth for the reported version: package.json. The fallback
// only triggers when the file is unreadable (e.g. exotic embedding), so the
// MCP serverInfo / HTTP /health / banner never drift from the npm version.
let CORE_VERSION = '0.0.0-dev';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  if (pkg && typeof pkg.version === 'string') CORE_VERSION = pkg.version;
} catch { /* keep fallback */ }

export { CORE_VERSION };
