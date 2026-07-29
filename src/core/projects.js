// Project Constellation — every directory you run LehroSol in gets a
// deterministic identity: a codename, a sigil, and a hex tag derived from the
// path hash. Same folder = same identity, forever, on any machine.
// Registry persists in ~/.lehro/config.json under { projects }.
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig, saveConfig } from './config.js';

const ADJECTIVES = [
  'OBSIDIAN', 'CRIMSON', 'IRON', 'SOLAR', 'LUNAR', 'EMBER', 'COBALT', 'ONYX',
  'AMBER', 'VIOLET', 'GILDED', 'FERAL', 'SILENT', 'RADIANT', 'NOCTURNE', 'PRIME',
  'HOLLOW', 'ARCTIC', 'SCARLET', 'MIDNIGHT', 'TITAN', 'QUANTUM', 'VECTOR', 'NOVA',
];
const NOUNS = [
  'FALCON', 'LANTERN', 'CITADEL', 'SERPENT', 'FORGE', 'BEACON', 'RAVEN', 'ATLAS',
  'ORACLE', 'SPIRE', 'HARBOR', 'PHANTOM', 'MERIDIAN', 'CIPHER', 'GARRISON', 'COMET',
  'MONOLITH', 'TALON', 'VANGUARD', 'HELIX', 'ECLIPSE', 'BASTION', 'PYLON', 'ZENITH',
];
const SIGILS = ['\u25ec', '\u2b21', '\u2756', '\u2726', '\u25c9', '\u2b22', '\u25a3', '\u272a'];

export function projectIdentity(cwd) {
  const path = resolve(cwd || process.cwd());
  const h = createHash('sha256').update(path.toLowerCase()).digest();
  return {
    path,
    codename: `${ADJECTIVES[h[0] % ADJECTIVES.length]} ${NOUNS[h[1] % NOUNS.length]}`,
    sigil: SIGILS[h[2] % SIGILS.length],
    tag: h.subarray(3, 5).toString('hex').toUpperCase(),
  };
}

export function touchProject(cwd, info = {}) {
  const identity = projectIdentity(cwd);
  const config = loadConfig();
  const projects = config.projects || {};
  const prev = projects[identity.path] || { firstRun: new Date().toISOString(), runs: 0 };
  projects[identity.path] = {
    ...prev,
    ...identity,
    runs: (prev.runs || 0) + 1,
    lastRun: new Date().toISOString(),
    lastMode: info.mode ?? prev.lastMode ?? null,
    lastAdapter: info.adapter ?? prev.lastAdapter ?? null,
    lastVerdict: info.verdict ?? prev.lastVerdict ?? null,
    lastSessionId: info.sessionId ?? prev.lastSessionId ?? null,
  };
  config.projects = projects;
  saveConfig(config);
  return projects[identity.path];
}

export function listProjects() {
  const config = loadConfig();
  return Object.values(config.projects || {})
    .sort((a, b) => String(b.lastRun || '').localeCompare(String(a.lastRun || '')));
}
