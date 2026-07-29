// LehroSol HELIX Mode Ring — branded operating modes for the Loop Engine.
// A mode shapes HOW the agent works (read-only recon vs. implementation vs.
// adversarial review) without the user rewriting prompt scaffolding each run.
// Preferred mode persists in ~/.lehro/config.json under { modes: { preferred } }.
import { loadConfig, saveConfig } from './config.js';

export const MODES = Object.freeze([
  {
    id: 'recon',
    aliases: ['plan', 'scout'],
    glyph: '\u25c7',
    label: 'Recon',
    tagline: 'Map the terrain before touching it — read-only planning sweep',
    temperature: 0.4,
    preamble: [
      '# MODE: RECON (planning sweep)',
      'You are in read-only planning mode. Do NOT create, modify, or delete any files.',
      'Inspect the project structure and key files, then produce:',
      '1. A concise map of the areas relevant to the goal.',
      '2. A ranked plan of the smallest safe changes that achieve it.',
      '3. Risks, unknowns, and the verification commands to run after each step.',
    ].join('\n'),
  },
  {
    id: 'forge',
    aliases: ['code', 'build'],
    glyph: '\u25c6',
    label: 'Forge',
    tagline: 'Make the smallest complete change and prove it works',
    temperature: 0.2,
    preamble: [
      '# MODE: FORGE (implementation)',
      'Implement the smallest complete, safe change that achieves the goal.',
      'Follow existing project conventions. After editing, verify your work using the',
      'project\u2019s build/tests/linters and report exactly what changed, which files,',
      'how it was verified, and any remaining risk.',
    ].join('\n'),
  },
  {
    id: 'sentinel',
    aliases: ['review', 'audit'],
    glyph: '\u25c8',
    label: 'Sentinel',
    tagline: 'Adversarial review — hunt defects and security holes, change nothing',
    temperature: 0.3,
    preamble: [
      '# MODE: SENTINEL (review / audit)',
      'You are in review mode. Do NOT modify files. Hunt for correctness bugs,',
      'security issues (injection, secrets, unsafe input handling), and reliability',
      'hazards. Report findings ranked by severity with file:line references and',
      'a concrete fix suggestion for each.',
    ].join('\n'),
  },
  {
    id: 'medic',
    aliases: ['fix', 'debug'],
    glyph: '\u271a',
    label: 'Medic',
    tagline: 'Reproduce, isolate, and repair a defect with a verified fix',
    temperature: 0.2,
    preamble: [
      '# MODE: MEDIC (debug & repair)',
      'Diagnose before treating: reproduce or trace the reported problem, isolate the',
      'root cause, then apply the smallest fix that addresses the cause (not the symptom).',
      'Verify the fix and state how you confirmed it. Note any regression risk.',
    ].join('\n'),
  },
  {
    id: 'scribe',
    aliases: ['docs', 'write'],
    glyph: '\u270e',
    label: 'Scribe',
    tagline: 'Document what exists — READMEs, guides, and inline docs',
    temperature: 0.5,
    preamble: [
      '# MODE: SCRIBE (documentation)',
      'Improve documentation only; do not change executable behavior.',
      'Write for a new engineer joining the project: accurate, concise, example-first.',
      'Keep code snippets runnable and consistent with the actual codebase.',
    ].join('\n'),
  },
])

export function getMode(idOrAlias) {
  const key = String(idOrAlias || '').trim().toLowerCase();
  if (!key) return null;
  return MODES.find((m) => m.id === key || m.aliases.includes(key)) || null;
}

export function getPreferredMode() {
  const config = loadConfig();
  return getMode(config.modes && config.modes.preferred) || null;
}

export function setPreferredMode(idOrAlias) {
  const mode = getMode(idOrAlias);
  if (!mode) {
    throw new Error(`Unknown mode: ${idOrAlias}. Valid: ${MODES.map((m) => `${m.id} (${m.aliases.join('/')})`).join(', ')}`);
  }
  const config = loadConfig();
  config.modes = Object.assign({}, config.modes, { preferred: mode.id, updatedAt: new Date().toISOString() });
  saveConfig(config);
  return mode;
}
