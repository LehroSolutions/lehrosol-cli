// Preferred / favorite adapters for the HELIX cockpit.
// Stored under ~/.lehro/config.json as { favorites: { preferredAdapter, adapters[] } }.
import { loadConfig, saveConfig, normalizeAdapterId } from './config.js';

export function getFavorites() {
  const config = loadConfig();
  const fav = config.favorites || {};
  return {
    preferredAdapter: fav.preferredAdapter || null,
    adapters: Array.isArray(fav.adapters) ? fav.adapters : [],
  };
}

export function setPreferredAdapter(id, options = {}) {
  const config = loadConfig();
  const key = normalizeAdapterId(id);
  const allowed = Array.isArray(options.allowedIds) ? options.allowedIds : null;
  if (!key || (allowed && !allowed.includes(key))) {
    throw new Error(`Unknown adapter: ${id}`);
  }
  config.favorites = Object.assign({}, config.favorites || {}, {
    preferredAdapter: key,
    adapters: Array.from(new Set([...(config.favorites?.adapters || []), key])),
    updatedAt: new Date().toISOString(),
  });
  saveConfig(config);
  return getFavorites();
}

export function toggleFavoriteAdapter(id) {
  const config = loadConfig();
  const key = normalizeAdapterId(id);
  const current = Array.isArray(config.favorites?.adapters) ? config.favorites.adapters.slice() : [];
  const idx = current.indexOf(key);
  if (idx >= 0) current.splice(idx, 1);
  else current.push(key);
  config.favorites = Object.assign({}, config.favorites || {}, {
    adapters: current,
    preferredAdapter: config.favorites?.preferredAdapter === key && idx >= 0
      ? (current[0] || null)
      : (config.favorites?.preferredAdapter || null),
    updatedAt: new Date().toISOString(),
  });
  saveConfig(config);
  return getFavorites();
}
