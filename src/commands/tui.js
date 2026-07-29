// LehroSol CLI — In-terminal GUI ("HELIX Console")
// -----------------------------------------------------------------------------
// An immersive, animated, FULLY KEYBOARD-DRIVEN agentic cockpit that lives
// inside the terminal — a CMUX-class control surface for loop + harness +
// orchestration + adapters across every skill stage (basic / intermediate /
// advanced).
//
// Every panel is focusable and every panel is actionable: pressing Enter on a
// focused panel EXECUTES it for real (guided setup, health check, an adapter
// run — live or dry-run, a policy evaluation, a session inspection, or spawning
// orchestration workers). Actions run in the normal screen buffer (so their
// output scrolls and is copy-pasteable), then return to the cockpit.
//
// Modes of operation:
//   lehrosol tui                 -> live immersive dashboard (falls back to static)
//   lehrosol tui --static        -> one-shot painted dashboard (great for pipes)
//   lehrosol tui --json          -> machine-readable snapshot
//   lehrosol tui --mode advanced -> preset density/controls

import { runDoctor } from './doctorLogic.js';
import { runInitCommand } from './init.js';
import { runConfigCommand } from './config.js';
import { runThreadsCommand } from './threads.js';
import { runModelsCommand } from './models.js';
import { runSuperviseCommand } from './supervise.js';
import { runMissionCommand } from './mission.js';
import { listMissions } from '../agentic/mission.js';
import { runMarketplaceCommand } from './marketplace.js';
import { runReleaseCommand } from './release.js';
import { runLearnCommand } from './learn.js';
import { listRuns } from '../core/runRegistry.js';
import { listInstalled } from '../marketplace/index.js';
import { listModelProfiles } from '../core/modelProfiles.js';
import { listAdapters } from '../loop/adapters/index.js';
import { runLoop } from '../loop/loop.js';
import { toolNames } from '../loop/tools/registry.js';
import { listSessions, getSession, backend, storeSizeBytes } from '../core/sessionStore.js';
import { loadEngrams, fieldNotesFor } from '../core/engrams.js';
import { projectIdentity } from '../core/projects.js';
import { runCompactCommand, runEngramsCommand } from './compact.js';
import { runReportCommand } from './report.js';
import { runServeCommand, ENGINES } from './serve.js';
import { janCliModels } from './recommend.js';
import { runVaultCommand } from './vault.js';
import { scanVault, findLlamaServer } from '../core/modelVault.js';
import { detectHardware, rateModelFit } from '../core/hardware.js';
import { startHttpServer } from '../mcp/server.js';
import { colorizeDiff } from '../core/diffCapture.js';
import { listWorktrees, spawnWorktree } from '../orchestrator/worktree.js';
import { evaluatePolicy } from '../harness/policy.js';
import {
  palette, gradients, glyph, boxSet, fg, style, gradient, badge, chip,
  statusDot, meter, sparkline, displayWidth, fitVisible, padEndVisible,
} from '../core/theme.js';
import {
  motionEnabled, size, shimmer, spinnerFrame, cometBar,
  term, startKeyReader, sleep, paintFrame,
} from '../core/anim.js';
import { waitForKey, readLineInput } from '../core/prompt.js';
import { getFavorites, setPreferredAdapter, toggleFavoriteAdapter } from '../core/favorites.js';

const MODES = ['basic', 'intermediate', 'advanced'];

// Panel indices — focus order is reading order (left→right, top→bottom).
const P_HEALTH = 0;
const P_ADAPTERS = 1;
const P_SESSIONS = 2;
const P_POLICY = 3;
const P_MEMORY = 4;
const P_ORCH = 5;
const P_ACTIONS = 6;
const PANEL_COUNT = 7;

function resolveMode(mode) { return MODES.includes(mode) ? mode : 'basic'; }

function modeMeta(mode) {
  if (mode === 'advanced') return { label: 'ADVANCED', blurb: 'full control plane · MCP · orchestration', accent: palette.violet };
  if (mode === 'intermediate') return { label: 'INTERMEDIATE', blurb: 'loops · policy · sessions', accent: palette.cyan };
  return { label: 'BASIC', blurb: 'guided, safe-by-default path', accent: palette.teal };
}

// ---------------------------------------------------------------------------
// Web control plane (GUI <-> TUI crossover: one process, two front-ends)
// ---------------------------------------------------------------------------
let webPlane = null; // { server, port }

export function webPlaneStatus() {
  return webPlane ? { live: true, port: webPlane.port } : { live: false, port: 4177 };
}

export function toggleWebPlane(port = 4177) {
  if (webPlane) {
    try { webPlane.server.close(); } catch { /* already down */ }
    webPlane = null;
    return { live: false, port };
  }
  try {
    const server = startHttpServer({ port });
    server.on('error', () => { webPlane = null; });
    webPlane = { server, port };
    return { live: true, port };
  } catch (err) {
    return { live: false, port, error: (err && err.message) || String(err) };
  }
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

// Live local model discovery for the model palette. Cached: overlayActions
// runs on every keypress and the Jan CLI catalog is a shell-out.
// Model Vault cache — fs scan of every GGUF on disk, rated for this machine.
// Cheap (readdir-only) but cached so keystrokes stay instant.
let vaultCache = { at: 0, items: [], server: null };
function vaultState() {
  if (Date.now() - vaultCache.at < 60000) return vaultCache;
  try {
    const hw = detectHardware();
    const items = scanVault({}).map((e) => ({ ...e, ...rateModelFit(e.sizeBytes, hw) }));
    vaultCache = { at: Date.now(), items, server: findLlamaServer({}) };
  } catch {
    vaultCache = { at: Date.now(), items: [], server: null };
  }
  return vaultCache;
}
function tuiVaultSummary() {
  const v = vaultState();
  return {
    models: v.items.length,
    ready: v.items.filter((m) => m.fit === 'great' || m.fit === 'tight').length,
    server: v.server ? v.server.source : null,
  };
}

let localModelCache = { at: 0, items: [] };
function liveLocalModels() {
  if (Date.now() - localModelCache.at < 30000) return localModelCache.items;
  let items = [];
  try { items = (janCliModels() || []).map((m) => m.id); } catch { items = []; }
  localModelCache = { at: Date.now(), items };
  return items;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
export function buildTuiSnapshot(mode = 'basic') {
  const resolved = resolveMode(mode);
  const doctor = runDoctor({ cwd: process.cwd() });
  const adapters = listAdapters();
  const allSessions = listSessions({ limit: 200 });
  const sessions = allSessions.slice(0, 6);
  const engrams = loadEngrams();
  const project = projectIdentity(process.cwd());
  const fieldNotes = fieldNotesFor(process.cwd(), 3);
  const worktrees = listWorktrees().worktrees || [];
  const installedAdapters = adapters.filter((a) => a.installed);
  const policyPreview = evaluatePolicy({ branch: 'feature/example', hasTests: true, reviewCount: 1, owaspScope: ['llm'] });
  const passChecks = doctor.checks.filter((c) => c.ok).length;
  const favorites = getFavorites();
  const preferredId = favorites.preferredAdapter || null;
  const favoriteIds = new Set(favorites.adapters || []);
  // Prefer favorites first, then preferred, then ready adapters for cockpit density.
  const sortedAdapters = adapters.slice().sort((a, b) => {
    const af = favoriteIds.has(a.id) ? 0 : 1;
    const bf = favoriteIds.has(b.id) ? 0 : 1;
    if (af !== bf) return af - bf;
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  const httpReady = adapters.filter((a) => a.kind === 'http' && a.configured).length;
  const cliReady = adapters.filter((a) => a.kind === 'cli' && a.configured).length;
  return {
    mode: resolved,
    checkedAt: new Date().toISOString(),
    doctor,
    passChecks,
    totalChecks: doctor.checks.length,
    adapters: sortedAdapters,
    installedAdapters,
    preferredAdapter: preferredId,
    favoriteAdapters: Array.from(favoriteIds),
    sessionsBackend: backend(),
    sessions,
    worktrees,
    supervisorRuns: listRuns({ limit: 6 }),
    missions: listMissions({ limit: 5 }),
    marketplaceInstalled: listInstalled(),
    policyPreview,
    engrams,
    vault: tuiVaultSummary(),
    project,
    fieldNotes,
    storeBytes: storeSizeBytes(),
    sessionsOnDisk: allSessions.filter((s) => s.finishedAt).length,
    web: webPlaneStatus(),
    tools: toolNames(),
    metrics: {
      health: doctor.checks.map((c) => (c.ok ? 6 : 1)),
      adapters: sortedAdapters.map((a) => (a.installed ? 7 : 1)),
      policyScore: policyPreview.score,
      httpReady,
      cliReady,
      tools: toolNames().length,
    },
  };
}

// How many selectable rows each panel has (drives ↑↓ navigation).
function panelListLengths(snapshot, mode) {
  const out = new Array(PANEL_COUNT).fill(0);
  out[P_ADAPTERS] = snapshot.adapters.length;
  out[P_SESSIONS] = snapshot.sessions.length;
  out[P_ORCH] = snapshot.worktrees.length;
  out[P_ACTIONS] = quickActions(mode).length;
  return out;
}

export const TUI_HOTKEY_CONTRACT = [
  { keys: ['q', 'ctrl-c'], action: 'quit' },
  { keys: ['tab', 'right', 'l'], action: 'next-panel' },
  { keys: ['left', 'h'], action: 'previous-panel' },
  { keys: ['up', 'k'], action: 'select-previous-row' },
  { keys: ['down', 'j'], action: 'select-next-row' },
  { keys: ['enter', 'space'], action: 'run-focused-panel' },
  { keys: ['1', '2', '3'], action: 'switch-stage-or-run-numbered-quick-action' },
  { keys: ['r'], action: 'refresh-snapshot' },
  { keys: ['d'], action: 'open-doctor-view' },
  { keys: ['a'], action: 'open-adapters-view' },
  { keys: ['s'], action: 'open-sessions-view' },
  { keys: ['p'], action: 'open-policy-view' },
  { keys: ['c'], action: 'open-command-palette' },
  { keys: ['m'], action: 'open-model-palette' },
  { keys: ['f'], action: 'toggle-favorite-or-preferred-adapter' },
  { keys: ['g'], action: 'run-preferred-or-grok-adapter' },
  { keys: ['t'], action: 'open-threads-hint' },
  { keys: ['x'], action: 'open-diff-view' },
  { keys: ['e'], action: 'open-engram-memory-view' },
  { keys: ['w'], action: 'toggle-web-gui-control-plane' },
  { keys: ['?'], action: 'open-help-view' },
  { keys: ['esc'], action: 'return-to-dashboard' },
];

export function createTuiState(mode = 'basic') {
  const resolved = resolveMode(mode);
  return {
    mode: resolved,
    view: 'dashboard',
    panel: P_ACTIONS,
    sel: new Array(PANEL_COUNT).fill(0),
    overlaySel: 0,
    toast: { kind: 'info', text: 'Tab panels · ↵ run · g go · w web GUI · e memory · ? help' },
    pending: null,
    done: false,
  };
}

export function clampTuiSelections(state, snapshot) {
  const lens = panelListLengths(snapshot, state.mode);
  for (let i = 0; i < PANEL_COUNT; i += 1) {
    const L = lens[i];
    state.sel[i] = L > 0 ? Math.max(0, Math.min(state.sel[i], L - 1)) : 0;
  }
  return state;
}

function switchTuiStage(state, snapshot, mode) {
  const nextSnapshot = buildTuiSnapshot(mode);
  state.mode = mode;
  state.toast = { kind: 'info', text: `stage → ${mode}` };
  clampTuiSelections(state, nextSnapshot);
  return nextSnapshot;
}

export function applyTuiHotkey(key, state, snapshot) {
  let nextSnapshot = snapshot;
  const quickActionNumber = /^[1-9]$/.test(String(key || '')) ? Number(key) - 1 : -1;

  if (key === 'ctrl-c' || key === 'q') { state.done = true; return { snapshot: nextSnapshot, handled: true, action: 'quit' }; }

  // If Quick Actions is focused, number keys are real "button" hotkeys.
  // This makes the visible 01/02/03 rows actionable instead of decorative.
  if (state.view === 'dashboard' && state.panel === P_ACTIONS && quickActionNumber >= 0) {
    const actions = quickActions(state.mode);
    if (quickActionNumber < actions.length) {
      state.sel[P_ACTIONS] = quickActionNumber;
      state.pending = { panel: P_ACTIONS };
      state.toast = { kind: 'info', text: `launching ${actions[quickActionNumber].label}…` };
      return { snapshot: nextSnapshot, handled: true, action: 'quick-action' };
    }
  }

  if (key === '1') { nextSnapshot = switchTuiStage(state, nextSnapshot, 'basic'); return { snapshot: nextSnapshot, handled: true, action: 'stage-basic' }; }
  if (key === '2') { nextSnapshot = switchTuiStage(state, nextSnapshot, 'intermediate'); return { snapshot: nextSnapshot, handled: true, action: 'stage-intermediate' }; }
  if (key === '3') { nextSnapshot = switchTuiStage(state, nextSnapshot, 'advanced'); return { snapshot: nextSnapshot, handled: true, action: 'stage-advanced' }; }
  if (key === 'r') { nextSnapshot = buildTuiSnapshot(state.mode); state.toast = { kind: 'info', text: 'refreshed' }; clampTuiSelections(state, nextSnapshot); return { snapshot: nextSnapshot, handled: true, action: 'refresh' }; }
  if (key === '?') { state.view = 'help'; return { snapshot: nextSnapshot, handled: true, action: 'view-help' }; }
  if (key === 'd') { state.view = 'doctor'; return { snapshot: nextSnapshot, handled: true, action: 'view-doctor' }; }
  if (key === 'a') { state.view = 'adapters'; return { snapshot: nextSnapshot, handled: true, action: 'view-adapters' }; }
  if (key === 's') { state.view = 'sessions'; return { snapshot: nextSnapshot, handled: true, action: 'view-sessions' }; }
  if (key === 'p') { state.view = 'policy'; return { snapshot: nextSnapshot, handled: true, action: 'view-policy' }; }
  if (key === 'x') { state.view = 'diff'; return { snapshot: nextSnapshot, handled: true, action: 'view-diff' }; }
  if (key === 'e') { state.view = 'memory'; state.overlaySel = 0; return { snapshot: nextSnapshot, handled: true, action: 'view-memory' }; }
  if (key === 'w') {
    const res = toggleWebPlane();
    nextSnapshot = buildTuiSnapshot(state.mode);
    clampTuiSelections(state, nextSnapshot);
    state.toast = res.live
      ? { kind: 'ok', text: `web GUI live → http://localhost:${res.port} · press w to stop` }
      : (res.error ? { kind: 'warn', text: `web GUI failed: ${res.error}` } : { kind: 'info', text: 'web GUI control plane stopped' });
    return { snapshot: nextSnapshot, handled: true, action: 'toggle-web-plane' };
  }
  if (key === 'esc') { state.view = 'dashboard'; return { snapshot: nextSnapshot, handled: true, action: 'dashboard' }; }
  if (key === 'c') { state.view = 'commands'; state.overlaySel = 0; return { snapshot: nextSnapshot, handled: true, action: 'view-commands' }; }
  if (key === 'm') { state.view = 'models'; state.overlaySel = 0; return { snapshot: nextSnapshot, handled: true, action: 'view-models' }; }
  if (key === 't') { state.view = 'threads'; state.overlaySel = 0; return { snapshot: nextSnapshot, handled: true, action: 'view-threads' }; }
  if (key === 'f') {
    // Favorite / prefer the focused adapter when adapters panel is active.
    if (state.view === 'dashboard' && state.panel === P_ADAPTERS) {
      const a = nextSnapshot.adapters[state.sel[P_ADAPTERS] || 0];
      if (a) {
        const fav = toggleFavoriteAdapter(a.id);
        state.toast = { kind: 'ok', text: fav.adapters.includes(a.id) ? `favorited ${a.id}` : `unfavorited ${a.id}` };
        nextSnapshot = buildTuiSnapshot(state.mode);
        clampTuiSelections(state, nextSnapshot);
        return { snapshot: nextSnapshot, handled: true, action: 'toggle-favorite' };
      }
    }
    return { snapshot: nextSnapshot, handled: true, action: 'toggle-favorite-noop' };
  }
  if (key === 'g') {
    // Prefer configured preferred adapter, else grok, else first ready HTTP, else first ready.
    const preferred = nextSnapshot.preferredAdapter;
    let target = nextSnapshot.adapters.find((a) => a.id === preferred && a.configured)
      || nextSnapshot.adapters.find((a) => a.id === 'grok' && a.configured)
      || nextSnapshot.adapters.find((a) => a.kind === 'http' && a.configured)
      || nextSnapshot.adapters.find((a) => a.configured && a.id !== 'local');
    if (!target) {
      state.view = 'adapters';
      state.toast = { kind: 'warn', text: 'no live adapter ready — configure grok/ollama/nvidia' };
      return { snapshot: nextSnapshot, handled: true, action: 'run-preferred-missing' };
    }
    const idx = nextSnapshot.adapters.findIndex((a) => a.id === target.id);
    state.view = 'dashboard';
    state.panel = P_ADAPTERS;
    state.sel[P_ADAPTERS] = Math.max(0, idx);
    state.pending = { panel: P_ADAPTERS };
    state.toast = { kind: 'info', text: `launching ${target.id}…` };
    return { snapshot: nextSnapshot, handled: true, action: 'run-preferred-or-grok' };
  }
  if (state.view !== 'dashboard') {
    const overlayItems = overlayActions(state.view, nextSnapshot);
    if (overlayItems.length) {
      if (key === 'up' || key === 'k') {
        state.overlaySel = (state.overlaySel - 1 + overlayItems.length) % overlayItems.length;
        return { snapshot: nextSnapshot, handled: true, action: 'overlay-previous' };
      }
      if (key === 'down' || key === 'j') {
        state.overlaySel = (state.overlaySel + 1) % overlayItems.length;
        return { snapshot: nextSnapshot, handled: true, action: 'overlay-next' };
      }
      if (key === 'enter' || key === 'space') {
        state.pending = { overlay: state.view, index: state.overlaySel };
        state.toast = { kind: 'info', text: `launching ${overlayItems[state.overlaySel].label}…` };
        return { snapshot: nextSnapshot, handled: true, action: 'run-overlay-action' };
      }
    }
    return { snapshot: nextSnapshot, handled: false, action: null };
  }

  if (key === 'tab' || key === 'right' || key === 'l') { state.panel = (state.panel + 1) % PANEL_COUNT; return { snapshot: nextSnapshot, handled: true, action: 'next-panel' }; }
  if (key === 'left' || key === 'h') { state.panel = (state.panel - 1 + PANEL_COUNT) % PANEL_COUNT; return { snapshot: nextSnapshot, handled: true, action: 'previous-panel' }; }

  const lens = panelListLengths(nextSnapshot, state.mode);
  const L = lens[state.panel];
  if (key === 'up' || key === 'k') { if (L > 0) state.sel[state.panel] = (state.sel[state.panel] - 1 + L) % L; return { snapshot: nextSnapshot, handled: true, action: 'select-previous-row' }; }
  if (key === 'down' || key === 'j') { if (L > 0) state.sel[state.panel] = (state.sel[state.panel] + 1) % L; return { snapshot: nextSnapshot, handled: true, action: 'select-next-row' }; }
  if (key === 'enter' || key === 'space') { state.pending = { panel: state.panel }; state.toast = { kind: 'info', text: 'launching…' }; return { snapshot: nextSnapshot, handled: true, action: 'run-focused-panel' }; }

  return { snapshot: nextSnapshot, handled: false, action: null };
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
function viewportWidth(live) {
  if (live) return Math.min(size().cols, 160);
  return Math.max(80, Math.min(Number(process.stdout.columns) || 100, 150));
}

function panel(title, bodyLines, width, opts = {}) {
  const set = boxSet(opts.focused ? 'heavy' : 'round');
  const accent = opts.focused ? palette.cyan : (opts.accent || palette.line);
  const titleColor = opts.focused ? palette.cyan : (opts.titleColor || palette.textDim);
  const inner = Math.max(12, width - 2);
  const contentW = inner - 2;
  const icon = opts.icon ? `${opts.icon} ` : '';
  const label = ` ${icon}${title} `;
  const badgeStr = opts.badge ? `${opts.badge} ` : '';
  const fillW = Math.max(0, inner - displayWidth(label) - displayWidth(badgeStr));
  const top = fg(accent, set.tl)
    + style.bold(fg(titleColor, label))
    + fg(accent, set.h.repeat(fillW))
    + badgeStr
    + fg(accent, set.tr);
  const body = (bodyLines.length ? bodyLines : ['']).map(
    (line) => fg(accent, set.v) + ' ' + fitVisible(line, contentW) + ' ' + fg(accent, set.v),
  );
  const bottom = fg(accent, set.bl + set.h.repeat(inner) + set.br);
  return { lines: [top, ...body, bottom], width };
}

function joinColumns(cols, gap = 2) {
  const height = Math.max(...cols.map((c) => c.lines.length));
  const spacer = ' '.repeat(gap);
  const out = [];
  for (let i = 0; i < height; i += 1) {
    out.push(cols.map((c) => c.lines[i] || ' '.repeat(c.width)).join(spacer));
  }
  return out;
}

function kv(label, value, labelW = 12) {
  return fg(palette.muted, padEndVisible(label, labelW)) + fg(palette.text, value);
}

// Scrolling window so a selection is always visible in a fixed-height list.
function windowed(items, sel, limit) {
  if (items.length <= limit) return { slice: items, start: 0 };
  const start = Math.max(0, Math.min(sel - Math.floor(limit / 2), items.length - limit));
  return { slice: items, start, end: start + limit, sliceItems: items.slice(start, start + limit) };
}

function selMark(focused, isSel) {
  return (focused && isSel) ? fg(palette.cyan, glyph.caret) + ' ' : '  ';
}

function runHint(focused, text) {
  return focused ? fg(palette.faint, `${glyph.arrow} `) + fg(palette.teal, text) : '';
}

// ---------------------------------------------------------------------------
// Banner / header
// ---------------------------------------------------------------------------
const WORDMARK = 'L E H R O S O L';

function header(snapshot, ctx, width) {
  const set = boxSet('heavy');
  const accent = palette.cyan;
  const inner = width - 2;
  const contentW = inner - 2;
  const meta = modeMeta(snapshot.mode);
  const live = ctx.live;
  const spin = live ? spinnerFrame(ctx.frame) + ' ' : '';
  const clock = new Date().toLocaleTimeString();

  const brand = live
    ? shimmer(WORDMARK, ctx.frame, gradients.aurora, 0.05)
    : gradient(WORDMARK, gradients.aurora, { bold: true });
  const tagline = fg(palette.textDim, 'agentic engineering console');
  const statusRight = fg(palette.muted, `${spin}${clock}`);
  const line1Left = `${brand}  ${fg(palette.faint, glyph.vbar)}  ${tagline}`;
  const gapW = Math.max(1, contentW - displayWidth(line1Left) - displayWidth(statusRight));
  const line1 = line1Left + ' '.repeat(gapW) + statusRight;

  const chips = MODES.map((m) => {
    const mm = modeMeta(m);
    return m === snapshot.mode
      ? badge(mm.label, m === 'advanced' ? 'brand' : (m === 'intermediate' ? 'live' : 'accent'))
      : fg(palette.faint, `${mm.label.toLowerCase()}`);
  }).join(fg(palette.faint, `  ${glyph.sep}  `));
  const proj = snapshot.project || null;
  const wsRight = proj
    ? fg(palette.violet, `${proj.sigil} ${proj.codename}`) + fg(palette.faint, ` [${proj.tag}]`) + fg(palette.muted, `  ${glyph.sep}  ${meta.blurb}`)
    : fg(palette.muted, `${meta.blurb}`);
  const line2Left = `${chips}`;
  const gap2 = Math.max(1, contentW - displayWidth(line2Left) - displayWidth(wsRight));
  const line2 = line2Left + ' '.repeat(gap2) + wsRight;

  const pref = snapshot.preferredAdapter ? `pref:${snapshot.preferredAdapter}` : 'pref:none';
  const readyBits = `${snapshot.metrics.cliReady || 0}cli · ${snapshot.metrics.httpReady || 0}http · ${snapshot.metrics.tools || 0}tools`;
  const busLabel = fg(palette.muted, `${glyph.pulse} agent bus `);
  const webBit = snapshot.web && snapshot.web.live ? fg(palette.green, `web:${snapshot.web.port}`) : fg(palette.faint, 'web:off·w');
  const busRight = fg(palette.muted, ` ${pref}  ${readyBits}  `) + webBit + fg(palette.muted, `  ${live ? 'LIVE' : 'READY'}`);
  const barW = Math.max(8, contentW - displayWidth(busLabel) - displayWidth(busRight));
  const bar = live ? cometBar(ctx.frame, barW) : gradient('█'.repeat(barW), gradients.aurora);
  const line3 = busLabel + bar + busRight;

  const top = fg(accent, set.tl) + style.bold(fg(palette.cyan, ' ◈ LehroSol ')) + fg(accent, set.h.repeat(Math.max(0, inner - displayWidth(' ◈ LehroSol ')))) + fg(accent, set.tr);
  const rows = [line1, line2, line3].map((l) => fg(accent, set.v) + ' ' + fitVisible(l, contentW) + ' ' + fg(accent, set.v));
  const bottom = fg(accent, set.bl + set.h.repeat(inner) + set.br);
  return [top, ...rows, bottom];
}

function toastLine(toast, width) {
  if (!toast) return null;
  const kind = toast.kind || 'info';
  const icon = kind === 'ok' ? glyph.ok : (kind === 'warn' ? glyph.warn : glyph.spark);
  return '  ' + badge(` ${icon} ${toast.text} `.trim(), kind === 'ok' ? 'ok' : (kind === 'warn' ? 'warn' : 'live'));
}

// ---------------------------------------------------------------------------
// Panels (each receives p = { focused, sel, live, frame })
// ---------------------------------------------------------------------------
function healthPanel(snapshot, width, p) {
  const ok = snapshot.doctor.ok;
  const failed = snapshot.doctor.checks.filter((c) => !c.ok);
  const lines = [
    kv('Status', ok ? fg(palette.green, `${glyph.ok} READY`) : fg(palette.amber, `${glyph.warn} NEEDS ATTENTION`)),
    kv('Checks', `${snapshot.passChecks}/${snapshot.totalChecks}  ${sparkline(snapshot.metrics.health, palette.green)}`),
    kv('Node', String(snapshot.doctor.checks.find((c) => c.name === 'node-version')?.detail || '').replace(/\s*\(.*/, '') || 'ok'),
    kv('Tools', `${snapshot.metrics.tools || snapshot.tools.length} sandboxed`),
    kv('Preferred', snapshot.preferredAdapter ? fg(palette.cyan, snapshot.preferredAdapter) : fg(palette.faint, 'none · f to favorite')),
    kv('Vault', snapshot.vault && snapshot.vault.models
      ? `${fg(palette.text, `${snapshot.vault.models} GGUF on disk (${snapshot.vault.ready} fit)`)} ${snapshot.vault.server ? fg(palette.green, `· engine ${snapshot.vault.server}`) : fg(palette.amber, '· engine missing')}`
      : fg(palette.faint, 'no GGUFs found · lehrosol vault add-root')),
  ];
  if (failed.length) {
    failed.slice(0, 2).forEach((c) => lines.push(fg(palette.amber, `${glyph.warn} `) + fg(palette.textDim, `${c.name}: `) + fg(palette.muted, c.detail || 'needs attention')));
  } else {
    lines.push(fg(palette.green, `${glyph.ok} all core checks green`));
  }
  if (p.focused) lines.push(runHint(true, 'press ↵ to run the full doctor'));
  return panel('SYSTEM HEALTH', lines, width, {
    focused: p.focused,
    icon: fg(ok ? palette.green : palette.amber, glyph.pulse),
    accent: palette.lineSoft,
    badge: badge(ok ? 'OK' : 'CHECK', ok ? 'ok' : 'warn'),
  });
}

function adapterKindTag(a) {
  if (a.kind === 'http') return a.local ? 'local' : 'api';
  if (a.kind === 'builtin') return 'builtin';
  return 'cli';
}

function adaptersPanel(snapshot, width, p) {
  const limit = snapshot.mode === 'basic' ? 4 : (snapshot.mode === 'intermediate' ? 6 : 8);
  const lines = [
    kv('Ready', `${snapshot.installedAdapters.length}/${snapshot.adapters.length}  ${sparkline(snapshot.metrics.adapters, palette.cyan)}  ${fg(palette.faint, 'f=★ g=run')}`),
  ];
  const win = windowed(snapshot.adapters, p.sel, limit);
  const slice = win.sliceItems || win.slice;
  slice.forEach((a, idx) => {
    const realIdx = (win.start || 0) + idx;
    const isSel = p.focused && realIdx === p.sel;
    const fav = (snapshot.favoriteAdapters || []).includes(a.id);
    const preferred = snapshot.preferredAdapter === a.id;
    const star = preferred ? fg(palette.amber, '*') : (fav ? fg(palette.violet, '★') : ' ');
    const dot = a.installed ? statusDot('online') : fg(palette.faint, glyph.dotOpen);
    const nameColor = isSel ? style.bold(fg(palette.cyan, padEndVisible(a.id, 11))) : (a.installed ? fg(palette.text, padEndVisible(a.id, 11)) : fg(palette.muted, padEndVisible(a.id, 11)));
    const tag = fg(palette.faint, padEndVisible(adapterKindTag(a), 6));
    const model = a.kind === 'http' && a.model ? fg(palette.faint, padEndVisible(String(a.model).slice(0, 14), 14)) : fg(palette.faint, padEndVisible('', 14));
    const state = a.configured ? fg(palette.green, 'ready') : fg(palette.amber, '↵ setup');
    lines.push(`${selMark(p.focused, isSel)}${star}${dot} ${nameColor} ${tag} ${model} ${state}`);
  });
  if (snapshot.adapters.length > (win.sliceItems ? limit : slice.length)) {
    lines.push(fg(palette.faint, `${glyph.ellipsis} ${snapshot.adapters.length} adapters · ↑↓ to scroll`));
  }
  if (p.focused) lines.push(runHint(true, 'press ↵ to run · not ready? ↵ opens guided setup'));
  return panel('AGENT ADAPTERS', lines, width, {
    focused: p.focused,
    icon: fg(palette.cyan, glyph.diamond),
    accent: palette.lineSoft,
    badge: badge(`${snapshot.installedAdapters.length} READY`, 'live'),
  });
}

function sessionsPanel(snapshot, width, p) {
  const lines = [kv('Store', fg(palette.text, snapshot.sessionsBackend))];
  if (snapshot.sessions.length) {
    const win = windowed(snapshot.sessions, p.sel, 4);
    const slice = win.sliceItems || win.slice;
    slice.forEach((s, idx) => {
      const realIdx = (win.start || 0) + idx;
      const isSel = p.focused && realIdx === p.sel;
      const pass = s.finalVerdict === 'stop-success';
      const dot = pass ? statusDot('ok') : fg(palette.amber, glyph.dot);
      const id = isSel ? style.bold(fg(palette.cyan, s.id.slice(0, 8))) : fg(palette.textDim, s.id.slice(0, 8));
      const verdict = pass ? fg(palette.green, 'PASS') : fg(palette.amber, String(s.finalVerdict || '…'));
      lines.push(`${selMark(p.focused, isSel)}${dot} ${id} ${fg(palette.muted, padEndVisible((s.adapter || 'local'), 8))} ${verdict}`);
    });
    if (p.focused) lines.push(runHint(true, 'press ↵ to inspect · x for the diff view'));
  } else {
    lines.push(fg(palette.muted, `${glyph.info} no sessions recorded yet`));
    lines.push(fg(palette.faint, `${glyph.caret} press ↵ to run your first loop`));
  }
  return panel('SESSIONS', lines, width, {
    focused: p.focused,
    icon: fg(palette.blue, glyph.gear),
    accent: palette.lineSoft,
    badge: badge(`${snapshot.sessions.length}`, 'info'),
  });
}

function policyPanel(snapshot, width, p) {
  const pol = snapshot.policyPreview;
  const bandKind = pol.passed ? 'ok' : 'fail';
  const lines = [
    kv('Preview', `${pol.passed ? fg(palette.green, 'PASS') : fg(palette.red, 'BLOCK')}  ${chip(pol.band || 'n/a', pol.passed ? palette.green : palette.red)}`),
    kv('Score', meter(pol.score, 100, 16, pol.passed ? gradients.ok : gradients.danger)),
    fg(palette.muted, `${glyph.lock} protected: `) + fg(palette.textDim, 'main, master'),
    fg(palette.muted, `${glyph.spark} scopes: `) + fg(palette.textDim, 'llm, web, asvs'),
  ];
  if (p.focused) lines.push(runHint(true, 'press ↵ to evaluate the harness gate'));
  return panel('HARNESS / POLICY', lines, width, {
    focused: p.focused,
    icon: fg(palette.amber, glyph.lock),
    accent: palette.lineSoft,
    badge: badge(pol.passed ? 'GREEN' : 'GATED', bandKind),
  });
}

function orchestrationPanel(snapshot, width, p) {
  const lines = [kv('Workers', `${snapshot.worktrees.length} active`), kv('Graphs', `${snapshot.supervisorRuns?.length || 0} tracked`), kv('Market', `${snapshot.marketplaceInstalled?.length || 0} installed`)];
  if (snapshot.worktrees.length) {
    const win = windowed(snapshot.worktrees, p.sel, 4);
    const slice = win.sliceItems || win.slice;
    slice.forEach((wtree, idx) => {
      const realIdx = (win.start || 0) + idx;
      const isSel = p.focused && realIdx === p.sel;
      const name = isSel ? style.bold(fg(palette.cyan, padEndVisible(wtree.name, 16))) : fg(palette.text, padEndVisible(wtree.name, 16));
      lines.push(`${selMark(p.focused, isSel)}${statusDot('online')} ${name} ${fg(palette.muted, wtree.status || 'idle')}`);
    });
  } else {
    lines.push(fg(palette.muted, `${glyph.info} no worktree workers yet`));
    lines.push(fg(palette.faint, `${glyph.caret} press ↵ to spawn parallel workers`));
  }
  if (p.focused) lines.push(runHint(true, 'press ↵ to spawn orchestration workers'));
  return panel('ORCHESTRATION', lines, width, {
    focused: p.focused,
    icon: fg(palette.violet, glyph.bolt),
    accent: palette.lineSoft,
    badge: badge(`${snapshot.worktrees.length}`, snapshot.worktrees.length ? 'live' : 'muted'),
  });
}

function memoryPanel(snapshot, width, p) {
  const engrams = snapshot.engrams || [];
  const latest = engrams[engrams.length - 1] || null;
  const notes = snapshot.fieldNotes || [];
  const lines = [
    kv('Engrams', engrams.length
      ? fg(palette.text, `${engrams.length} lesson(s) distilled`)
      : fg(palette.faint, 'none yet — old sessions distill here')),
    kv('Store', fg(palette.text, fmtBytes(snapshot.storeBytes)) + fg(palette.faint, ` · ${snapshot.sessionsOnDisk || 0} full session(s)`)),
    kv('Field notes', notes.length
      ? fg(palette.green, `${notes.length} feeding this project's runs`)
      : fg(palette.faint, 'none for this project yet')),
  ];
  if (latest && latest.lesson) {
    lines.push(fg(palette.violet, `${glyph.spark} `) + fg(palette.textDim, String(latest.lesson)));
  }
  if ((snapshot.sessionsOnDisk || 0) >= 40) {
    lines.push(fg(palette.amber, `${glyph.warn} memory pressure — distill old sessions`));
  }
  if (p.focused) lines.push(runHint(true, 'press ↵ to open the Engram Distillery'));
  return panel('ENGRAM MEMORY', lines, width, {
    focused: p.focused,
    icon: fg(palette.violet, glyph.spark),
    accent: palette.lineSoft,
    badge: badge(`${engrams.length}`, engrams.length ? 'live' : 'muted'),
  });
}

function overlayActions(view, snapshot) {
  if (view === 'commands') return [
    { key: 'config', label: 'Run adapter configuration doctor' },
    { key: 'models', label: 'List curated model profiles' },
    { key: 'probe', label: `Probe ${snapshot.preferredAdapter || 'grok'} endpoint` },
    { key: 'run', label: `Run ${snapshot.preferredAdapter || 'grok'} live` },
    { key: 'sessions', label: 'List recent sessions' },
    { key: 'policy', label: 'Evaluate harness policy' },
  ];
  if (view === 'threads') return [
    { key: 'list', label: 'List threads + worktree workers' },
    { key: 'run', label: 'Launch multi-thread agent run' },
    { key: 'spawn', label: 'Spawn isolated worktree workers' },
  ];
  if (view === 'models') {
    const vaultServable = vaultState().items.map((e) => ({ key: `vault:${e.id}`, label: `Serve from drive · ${e.id} · ${e.quant || 'gguf'} · ${e.fit === 'great' ? 'great fit' : e.fit === 'tight' ? 'tight fit' : e.fit}` }));
    const localServable = liveLocalModels().map((id) => ({ key: `serve:jan:${id}`, label: `Serve locally · jan · ${id}` }));
    const retargetable = snapshot.adapters
      .filter((a) => a.kind === 'http' && a.configured)
      .map((a) => ({ key: `setmodel:${a.id}`, label: `Switch model on ${a.id} (now: ${a.model || 'default'})` }));
    return [
      ...listModelProfiles().map((profile) => ({ key: `profile:${profile.id}`, label: `${profile.label} · ${profile.adapter}/${profile.model}` })),
      ...vaultServable,
      ...localServable,
      ...retargetable,
      { key: 'current', label: 'Show current preferred model' },
      { key: 'probe', label: `Probe ${snapshot.preferredAdapter || 'grok'}` },
    ];
  }
  if (view === 'memory') return [
    { key: 'distill-preview', label: 'Engram Distillery · preview compaction (keep 8)' },
    { key: 'distill-apply', label: 'Engram Distillery · APPLY compaction now' },
    { key: 'engrams', label: 'Browse the full memory book' },
    { key: 'report', label: 'Export latest session as a Markdown mission report' },
  ];
  return [];
}

function overlaySelectionLines(view, snapshot, selected = 0) {
  return overlayActions(view, snapshot).map((item, index) => {
    const active = index === selected;
    const caret = active ? fg(palette.cyan, glyph.caret) : ' ';
    const number = fg(palette.faint, String(index + 1).padStart(2, '0'));
    const label = active ? style.bold(fg(palette.cyan, item.label)) : fg(palette.textDim, item.label);
    return `  ${caret} ${number} ${label}`;
  });
}

export function quickActions(mode) {
  const base = [
    { key: 'mission', label: 'Run agentic mission', cmd: 'lehrosol mission run --goal "..."' },
    { key: 'init', label: 'Guided setup', cmd: 'lehrosol init' },
    { key: 'doctor', label: 'Health check', cmd: 'lehrosol doctor' },
    { key: 'loop', label: 'Safe loop (dry-run)', cmd: 'lehrosol loop run --agentAdapter local' },
  ];
  if (mode === 'basic') return base;
  const mid = base.concat([
    { key: 'vault', label: 'Model vault — host GGUFs from disk', cmd: 'lehrosol vault' },
    { key: 'sessions', label: 'Inspect sessions', cmd: 'lehrosol sessions list' },
    { key: 'compact', label: 'Distill memory (Engram Distillery)', cmd: 'lehrosol compact' },
    { key: 'report', label: 'Export mission report', cmd: 'lehrosol report' },
    { key: 'policy', label: 'Policy / OWASP gate', cmd: 'lehrosol policy evaluate --branch feature/x --hasTests' },
  ]);
  if (mode === 'intermediate') return mid;
  return mid.concat([
    { key: 'supervise', label: 'Supervisor task graph', cmd: 'lehrosol supervise plan' },
    { key: 'marketplace', label: 'Marketplace catalog', cmd: 'lehrosol marketplace list' },
    { key: 'learn', label: 'Self-improvement report', cmd: 'lehrosol learn report' },
    { key: 'release', label: 'Release integrity manifest', cmd: 'lehrosol release manifest' },
    { key: 'config', label: 'Adapter setup doctor', cmd: 'lehrosol config doctor' },
    { key: 'grok', label: 'Configure / run Grok', cmd: 'lehrosol config set --adapter grok --apiKey <XAI_API_KEY> --model grok-4.5' },
    { key: 'prefer', label: 'Set preferred adapter', cmd: 'lehrosol config set --adapter <id>' },
    { key: 'threads', label: 'CMUX threads', cmd: 'lehrosol threads run --count 3' },
    { key: 'spawn', label: 'Spawn workers', cmd: 'lehrosol orchestrate spawn --count 2' },
    { key: 'mcp', label: 'MCP control plane', cmd: 'lehrosol mcp start --http' },
    { key: 'gui', label: 'Open web GUI', cmd: 'lehrosol gui' },
  ]);
}

function actionsPanel(snapshot, width, p) {
  const actions = quickActions(snapshot.mode);
  const lines = [];
  actions.forEach((a, i) => {
    const isSel = p.focused && i === p.sel;
    const num = fg(palette.faint, String(i + 1).padStart(2, ' '));
    const label = isSel ? style.bold(fg(palette.cyan, a.label)) : fg(palette.text, a.label);
    lines.push(`${selMark(p.focused, isSel)}${num} ${label}`);
  });
  if (p.focused) lines.push(runHint(true, 'press ↵ to run the selected action'));
  return panel('QUICK ACTIONS', lines, width, {
    focused: p.focused,
    icon: fg(palette.teal, glyph.play),
    accent: palette.lineSoft,
    badge: p.live ? badge('↵ run', 'accent') : undefined,
  });
}

// ---------------------------------------------------------------------------
// Overlay views (d / a / s / p / ?)
// ---------------------------------------------------------------------------
function latestDiffPanelLines(limit = 24) {
  let found = null;
  for (const s of listSessions({ limit: 15 })) {
    const session = getSession(s.id);
    const entries = ((session && session.checkpoints) || [])
      .map((cp) => ({ iteration: cp.iteration || (cp.data || cp).iteration, diff: (cp.data || cp).diff }))
      .filter((e) => e.diff && !e.diff.empty);
    if (entries.length) { found = { session, entry: entries[entries.length - 1] }; break; }
  }
  if (!found) {
    return [
      fg(palette.muted, 'No recorded diffs yet. Live runs inside a git repo capture a patch every iteration.'),
      fg(palette.faint, 'Run: lehrosol loop run --prompt "..." --dryRun=false'),
    ];
  }
  const { session, entry } = found;
  const lines = [
    kv('Session', fg(palette.textDim, String(session.id)), 10),
    kv('Iteration', '#' + entry.iteration, 10),
    '',
  ];
  if (entry.diff.stat) lines.push(...entry.diff.stat.split('\n').slice(0, 6).map((l) => fg(palette.textDim, l)));
  if (entry.diff.patch && entry.diff.patch.trim()) {
    lines.push('');
    lines.push(...colorizeDiff(entry.diff.patch).slice(0, limit));
  }
  if (entry.diff.untrackedFiles && entry.diff.untrackedFiles.length) {
    lines.push('');
    lines.push(fg(palette.textDim, `new files: ${entry.diff.untrackedFiles.slice(0, 5).join(', ')}${entry.diff.untrackedFiles.length > 5 ? ' \u2026' : ''}`));
  }
  lines.push('');
  lines.push(fg(palette.muted, `full patch: lehrosol diff --id ${session.id}`));
  return lines;
}

function overlayPanel(view, snapshot, width, ctx = {}) {
  if (view === 'diff') {
    return panel('DIFF \u00b7 what the agent changed', latestDiffPanelLines(), width, { icon: fg(palette.green, glyph.spark), accent: palette.green });
  }
  if (view === 'doctor') {
    const lines = snapshot.doctor.checks.map((c) => `${c.ok ? statusDot('ok') : fg(palette.amber, glyph.warn)} ${fg(palette.text, padEndVisible(c.name, 16))} ${fg(palette.muted, c.detail || '')}`);
    return panel('DOCTOR · project health', lines, width, { icon: fg(palette.green, glyph.pulse), accent: palette.cyan });
  }
  if (view === 'adapters') {
    const lines = snapshot.adapters.map((a) => {
      const target = a.kind === 'http' ? (a.baseUrl || '-') : (a.bin || '-');
      const state = a.configured ? fg(palette.green, 'ready') : fg(palette.faint, 'needs setup');
      const model = a.model ? ` ${a.model}` : '';
      const fav = (snapshot.favoriteAdapters || []).includes(a.id) ? fg(palette.violet, '★') : ' ';
      return `${fav}${a.installed ? statusDot('online') : fg(palette.faint, glyph.dotOpen)} ${fg(palette.text, padEndVisible(a.id, 11))} ${fg(palette.faint, padEndVisible(adapterKindTag(a), 6))} ${fg(palette.muted, padEndVisible(String(target) + model, 36))} ${state}`;
    });
    lines.push('');
    lines.push(fg(palette.muted, `${glyph.spark} tool calling: `) + fg(palette.textDim, snapshot.tools.join(', ')));
    return panel('ADAPTERS · agent ecosystem', lines, width, { icon: fg(palette.cyan, glyph.diamond), accent: palette.cyan });
  }
  if (view === 'sessions') {
    const lines = snapshot.sessions.length
      ? snapshot.sessions.map((s) => `${s.finalVerdict === 'stop-success' ? statusDot('ok') : fg(palette.amber, glyph.dot)} ${fg(palette.textDim, s.id.slice(0, 12))} ${fg(palette.muted, padEndVisible(s.adapter || 'local', 10))} ${fg(palette.text, String(s.finalVerdict || '…'))}  ${fg(palette.faint, String(s.prompt || '').slice(0, 30))}`)
      : [fg(palette.muted, 'No sessions recorded yet. Focus the Sessions panel and press ↵ to run one.')];
    return panel('SESSIONS · loop history', lines, width, { icon: fg(palette.blue, glyph.gear), accent: palette.cyan });
  }
  if (view === 'policy') {
    const pol = snapshot.policyPreview;
    const lines = [
      kv('Verdict', pol.passed ? fg(palette.green, 'PASS') : fg(palette.red, 'BLOCKED'), 14),
      kv('Score', meter(pol.score, 100, 26, pol.passed ? gradients.ok : gradients.danger), 14),
      kv('Band', String(pol.band || 'n/a'), 14),
      '',
      fg(palette.textDim, 'Violations:'),
      ...((pol.violations || []).length ? pol.violations.map((v) => fg(palette.red, `  ${glyph.fail} `) + fg(palette.text, v.title || v.rule || String(v))) : [fg(palette.green, `  ${glyph.ok} none`)]),
      fg(palette.textDim, 'Warnings:'),
      ...((pol.warnings || []).length ? pol.warnings.map((v) => fg(palette.amber, `  ${glyph.warn} `) + fg(palette.text, v.title || v.rule || String(v))) : [fg(palette.green, `  ${glyph.ok} none`)]),
    ];
    return panel('POLICY · harness gate', lines, width, { icon: fg(palette.amber, glyph.lock), accent: palette.cyan });
  }
  if (view === 'commands') {
    const lines = [
      fg(palette.textDim, 'Executable command palette · ↑↓ select · ↵ run'),
      ...overlaySelectionLines(view, snapshot, ctx.overlaySel || 0),
      '',
      fg(palette.muted, `${glyph.spark} actions suspend the cockpit, run normally, then return here`),
    ];
    return panel('COMMANDS · executable palette', lines, width, { icon: fg(palette.teal, glyph.play), accent: palette.cyan });
  }
  if (view === 'threads') {
    const lines = [
      fg(palette.textDim, 'CMUX-style multi-thread orchestration · ↑↓ select · ↵ run'),
      ...overlaySelectionLines(view, snapshot, ctx.overlaySel || 0),
      '',
      kv('Sessions', String(snapshot.sessions.length), 12),
      kv('Workers', String(snapshot.worktrees.length), 12),
      kv('Preferred', snapshot.preferredAdapter || 'none', 12),
    ];
    return panel('THREADS · executable CMUX plane', lines, width, { icon: fg(palette.violet, glyph.bolt), accent: palette.cyan });
  }
  if (view === 'memory') {
    const engrams = snapshot.engrams || [];
    const recent = engrams.slice(-6).reverse();
    const lines = [
      fg(palette.textDim, 'Long-term memory · old sessions distilled into lessons · ↑↓ select · ↵ run'),
      ...overlaySelectionLines(view, snapshot, ctx.overlaySel || 0),
      '',
      kv('Engrams', String(engrams.length), 12),
      kv('Store', fmtBytes(snapshot.storeBytes) + ` · ${snapshot.sessionsOnDisk || 0} full session(s)`, 12),
      kv('Field notes', String((snapshot.fieldNotes || []).length) + ' active for this project', 12),
    ];
    if (recent.length) {
      lines.push('');
      lines.push(fg(palette.textDim, 'Latest lessons:'));
      recent.forEach((e) => {
        const dot = e.finalVerdict === 'stop-success' ? statusDot('ok') : fg(palette.amber, glyph.dot);
        lines.push(`  ${dot} ${fg(palette.faint, String(e.project || ''))} ${fg(palette.textDim, String(e.lesson || ''))}`);
      });
    }
    return panel('ENGRAM MEMORY · the tool that learns', lines, width, { icon: fg(palette.violet, glyph.spark), accent: palette.violet });
  }
  if (view === 'help') {
    const lines = [
      fg(palette.textDim, 'Focus & navigation'),
      `  ${chip('tab', palette.cyan)} / ${chip('←', palette.cyan)} ${chip('→', palette.cyan)} / ${chip('h', palette.cyan)} ${chip('l', palette.cyan)}  move focus between panels`,
      `  ${chip('↑', palette.cyan)} ${chip('↓', palette.cyan)} / ${chip('j', palette.cyan)} ${chip('k', palette.cyan)}  select a row inside the focused panel`,
      `  ${chip('↵', palette.cyan)}  RUN the focused panel (doctor / adapter / policy / session / spawn / action)`,
      '',
      fg(palette.textDim, 'Every panel is live'),
      `  ${fg(palette.text, 'Health')} → run doctor    ${fg(palette.text, 'Adapters')} → run selected agent live, or show setup if not ready`,
      `  ${fg(palette.text, 'Sessions')} → inspect / run   ${fg(palette.text, 'Policy')} → evaluate gate   ${fg(palette.text, 'Orchestration')} → spawn workers`,
      '',
      fg(palette.textDim, 'Stages & views'),
      `  ${chip('1', palette.teal)} ${chip('2', palette.teal)} ${chip('3', palette.teal)} stage   ${chip('d', palette.teal)} ${chip('a', palette.teal)} ${chip('s', palette.teal)} ${chip('p', palette.teal)} ${chip('x', palette.teal)} ${chip('e', palette.teal)} views   ${chip('r', palette.teal)} refresh`,
      `  ${chip('c', palette.teal)} commands   ${chip('m', palette.teal)} models   ${chip('t', palette.teal)} threads   ${chip('f', palette.teal)} favorite   ${chip('g', palette.teal)} go preferred   ${chip('w', palette.teal)} web GUI on/off`,
      '',
      fg(palette.textDim, 'Session'),
      `  ${chip('?', palette.amber)} help    ${chip('esc', palette.amber)} back    ${chip('q', palette.amber)} quit`,
    ];
    return panel('HELP · keybindings', lines, width, { icon: fg(palette.cyan, glyph.info), accent: palette.cyan });
  }
  return panel('VIEW', ['(empty)'], width, {});
}

// ---------------------------------------------------------------------------
// Footer keybar
// ---------------------------------------------------------------------------
function footer(width, ctx) {
  const keys = ctx.view === 'dashboard'
    ? [['tab ←→', 'panel'], ['↑↓', 'select'], ['↵', 'run'], ['f', '★fav'], ['g', 'go'], ['w', 'gui'], ['m', 'models'], ['c', 'cmds'], ['1/2/3', 'stage'], ['d a s p x e', 'views'], ['?', 'help'], ['q', 'quit']]
    : [['↑↓', 'select'], ['↵', 'run'], ['m', 'models'], ['esc', 'back'], ['r', 'refresh'], ['?', 'help'], ['q', 'quit']];
  const parts = keys.map(([k, v]) => `${badge(k, 'brand')} ${fg(palette.muted, v)}`);
  const bar = parts.join(fg(palette.faint, `  ${glyph.sep}  `));
  return ' ' + fitVisible(bar, width - 2);
}

// ---------------------------------------------------------------------------
// Compose a full frame
// ---------------------------------------------------------------------------
function composeFrame(snapshot, ctx) {
  const width = viewportWidth(ctx.live);
  const gap = 2;
  const colW = Math.floor((width - gap) / 2);
  const sel = ctx.sel || new Array(PANEL_COUNT).fill(0);
  const focus = ctx.panel == null ? -1 : ctx.panel;
  const pctx = (idx) => ({ focused: ctx.live && focus === idx, sel: sel[idx] || 0, live: ctx.live, frame: ctx.frame });
  const lines = [];
  lines.push('');
  lines.push(...header(snapshot, ctx, width));
  const toast = ctx.live ? toastLine(ctx.toast, width) : null;
  if (toast) lines.push(toast);
  lines.push('');

  if (ctx.view !== 'dashboard') {
    lines.push(...overlayPanel(ctx.view, snapshot, width, ctx).lines);
    lines.push('');
    lines.push(fg(palette.faint, `  ${glyph.arrow} press ${chip('esc', palette.cyan)} to return to the dashboard`));
  } else {
    lines.push(...joinColumns([healthPanel(snapshot, colW, pctx(P_HEALTH)), adaptersPanel(snapshot, colW, pctx(P_ADAPTERS))], gap));
    lines.push('');
    lines.push(...joinColumns([sessionsPanel(snapshot, colW, pctx(P_SESSIONS)), policyPanel(snapshot, colW, pctx(P_POLICY))], gap));
    lines.push('');
    lines.push(...joinColumns([memoryPanel(snapshot, colW, pctx(P_MEMORY)), orchestrationPanel(snapshot, colW, pctx(P_ORCH))], gap));
    lines.push('');
    lines.push(...actionsPanel(snapshot, width, pctx(P_ACTIONS)).lines);
  }
  lines.push('');
  lines.push(footer(width, ctx));
  if (!ctx.live) {
    lines.push('');
    lines.push(fg(palette.muted, `  ${glyph.spark} live cockpit: `) + fg(palette.textDim, 'lehrosol tui') + fg(palette.muted, '   ·   machine snapshot: ') + fg(palette.textDim, 'lehrosol tui --json'));
  }
  return lines;
}

// Back-compat: single static string render.
export function renderTuiSnapshot(snapshot) {
  return composeFrame(snapshot, { live: false, frame: 0, panel: -1, sel: new Array(PANEL_COUNT).fill(0), view: 'dashboard', toast: null, overlaySel: 0 }).join('\n');
}

// ---------------------------------------------------------------------------
// Action helpers (run in the NORMAL screen buffer)
// ---------------------------------------------------------------------------
function hr(title) {
  console.log('\n' + gradient(`  ◈ ${title}`, gradients.aurora, { bold: true }));
  console.log(fg(palette.faint, '  ' + boxSet('round').h.repeat(52)));
}

function verdictColor(verdict) {
  if (verdict === 'stop-success') return fg(palette.green, verdict);
  if (String(verdict).startsWith('stop')) return fg(palette.amber, verdict);
  return fg(palette.textDim, String(verdict));
}

function indent(text, pad = '    ') {
  return String(text).split('\n').map((l) => pad + l).join('\n');
}

function adapterSetupHint(a) {
  if (a.id === 'grok') return 'lehrosol config set --adapter grok --apiKey <XAI_API_KEY> --model grok-4.5';
  if (a.install) return a.install;
  if (a.kind === 'http') {
    if (a.requiresEnv) return `lehrosol config set --adapter ${a.id} --apiKey <key> --model <model>`;
    return `start the local server at ${a.baseUrl}`;
  }
  return `install the \`${a.bin}\` CLI and ensure it is on PATH`;
}

async function actionDoctor() {
  hr('Project doctor');
  const d = runDoctor({ cwd: process.cwd() });
  d.checks.forEach((c) => {
    const icon = c.ok ? fg(palette.green, glyph.ok) : fg(palette.amber, glyph.warn);
    console.log(`  ${icon} ${fg(palette.text, padEndVisible(c.name, 18))} ${fg(palette.muted, c.detail || '')}`);
  });
  console.log('  ' + (d.ok ? fg(palette.green, `${glyph.ok} All core checks passed.`) : fg(palette.amber, `${glyph.warn} Some checks need attention.`)));
  return { kind: d.ok ? 'ok' : 'warn', text: `doctor → ${d.checks.filter((c) => c.ok).length}/${d.checks.length}` };
}

async function actionRunLoop(defaultPrompt) {
  hr('Safe loop (dry-run via local engine)');
  const answer = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Prompt (blank = default): `);
  const prompt = answer && answer.trim() ? answer.trim() : (defaultPrompt || 'Draft a short plan to improve this project\'s test coverage.');
  console.log(fg(palette.muted, `  running dry-run loop…`));
  const res = await runLoop({ prompt, agentAdapter: 'local', dryRun: true, maxIterations: 1, cwd: process.cwd() });
  console.log(`  verdict: ${verdictColor(res.finalVerdict)}   iterations: ${res.totalIterations}   session: ${fg(palette.textDim, res.sessionId.slice(0, 8))}`);
  return { kind: 'ok', text: `loop → ${res.finalVerdict}` };
}

// The unstick fix: pressing ↵ on a not-ready adapter no longer dead-ends in
// a wall of hints — it walks the user through an actual setup, right here.
async function actionAdapterSetup(a, depth = 0) {
  hr(`Guided setup: ${a.id} — ${a.label}`);
  const engine = ENGINES[a.id];
  if (engine) {
    console.log(fg(palette.textDim, `  ${a.id} is a local engine — let's get it serving and wired in one pass.`));
    if (engine.modelsArgs) {
      console.log(fg(palette.muted, '  models available to this engine:'));
      try { await runServeCommand('models', { engine: engine.id }, console); }
      catch { console.log(fg(palette.faint, '  (could not list models — is the engine CLI on PATH?)')); }
    }
    const vaultPick = engine.id === 'llamacpp' ? vaultState().items : [];
    if (vaultPick.length) {
      console.log(fg(palette.muted, '  GGUF models found on your drive (answer with a number or a name):'));
      vaultPick.slice(0, 12).forEach((e, i) => console.log(`    ${fg(palette.faint, String(i + 1).padStart(2, '0'))}  ${fg(palette.text, e.id)}  ${fg(palette.muted, `${e.quant || 'gguf'} · ${fmtBytes(e.sizeBytes)} · ${e.fit}`)}`));
    }
    const modelIn = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Model id${engine.requiresModel ? '' : ' (blank = engine default)'}: `)).trim();
    if (engine.requiresModel && !modelIn) return { kind: 'warn', text: `${a.id}: a model is required` };
    const portIn = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Port [${engine.defaultPort}]: `)).trim();
    const keyIn = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} API key [${engine.defaultApiKey || 'none'}]: `)).trim();
    const vaultEntry = /^\d+$/.test(modelIn) ? vaultPick[Number(modelIn) - 1] : null;
    const res = await runServeCommand('start', {
      engine: engine.id,
      model: vaultEntry ? vaultEntry.path : (modelIn || undefined),
      mmproj: vaultEntry && vaultEntry.mmprojPath ? vaultEntry.mmprojPath : undefined,
      port: Number(portIn) || engine.defaultPort,
      apiKey: keyIn || undefined,
      use: true,
    }, console);
    process.exitCode = 0;
    if (res && res.ok) {
      const fresh = listAdapters().find((x) => x.id === a.id);
      const again = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} ${a.id} is live + preferred. Run it now? [y/N]: `)).trim().toLowerCase();
      if (again.startsWith('y') && fresh && depth < 1) return actionRunAdapter(fresh, depth + 1);
      return { kind: 'ok', text: `${a.id} serving + set as preferred` };
    }
    return { kind: 'warn', text: `${a.id} start failed — fix the hint above, then ↵ again` };
  }
  if (a.kind === 'http' && a.requiresEnv) {
    console.log(fg(palette.textDim, `  ${a.id} needs an API key (${a.requiresEnv}).`));
    if (a.docs) console.log(fg(palette.faint, `  docs: ${a.docs}`));
    const key = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} API key (blank = cancel): `)).trim();
    if (!key) return { kind: 'warn', text: `${a.id}: setup cancelled` };
    const model = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Model [${a.model || 'adapter default'}]: `)).trim();
    runConfigCommand('set', { adapter: a.id, apiKey: key, model: model || undefined }, console);
    const fresh = listAdapters().find((x) => x.id === a.id);
    if (fresh && fresh.configured && depth < 1) {
      const again = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} ${a.id} configured. Run it now? [y/N]: `)).trim().toLowerCase();
      if (again.startsWith('y')) return actionRunAdapter(fresh, depth + 1);
    }
    return { kind: 'ok', text: `${a.id} configured` };
  }
  if (a.kind === 'http') {
    console.log(fg(palette.textDim, `  ${a.id} talks to a local server at ${a.baseUrl}.`));
    console.log(fg(palette.muted, '  1. start the server (its own app/CLI)   2. pin a model below   3. ↵ to run'));
    const model = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Model to pin (blank = skip): `)).trim();
    if (model) {
      runConfigCommand('set', { adapter: a.id, model }, console);
      return { kind: 'ok', text: `${a.id} model pinned → ${model}` };
    }
    return { kind: 'info', text: `${a.id}: start ${a.baseUrl} then ↵ again` };
  }
  console.log(fg(palette.textDim, `  ${a.id} is a CLI adapter — install its binary, then ↵ to run it.`));
  console.log(fg(palette.text, `    ${adapterSetupHint(a)}`));
  if (a.docs) console.log(fg(palette.faint, `  docs: ${a.docs}`));
  return { kind: 'info', text: `${a.id}: install \`${a.bin}\`, then ↵ again` };
}

async function actionRunAdapter(a, depth = 0) {
  hr(`Adapter: ${a.id} — ${a.label}`);
  const configured = a.configured;
  const target = a.kind === 'http' ? `endpoint ${a.baseUrl}` : `binary ${a.bin || '-'}`;
  console.log(`  ${fg(palette.muted, 'kind:')} ${fg(palette.text, adapterKindTag(a))}   ${fg(palette.muted, target)}   ${configured ? fg(palette.green, 'CONFIGURED') : fg(palette.amber, 'NOT CONFIGURED')}`);
  if (a.model) console.log(fg(palette.muted, `  model: `) + fg(palette.textDim, a.model));
  if (a.docs) console.log(fg(palette.faint, `  docs:  ${a.docs}`));
  if (!configured) return actionAdapterSetup(a, depth);

  const answer = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Live task prompt: `);
  const prompt = answer && answer.trim()
    ? answer.trim()
    : 'Inspect this project and propose the smallest useful improvement. If edits are safe, make them and summarize the change.';
  console.log(fg(palette.muted, `  running LIVE via ${a.id}… (tool calling ${a.kind === 'http' ? 'enabled' : 'via adapter'})`));
  const res = await runLoop({
    prompt, agentAdapter: a.id, dryRun: false,
    maxIterations: 3, cwd: process.cwd(),
  });
  const last = res.iterations[res.iterations.length - 1];
  console.log(`  verdict: ${verdictColor(res.finalVerdict)}   iterations: ${res.totalIterations}   adapter: ${fg(palette.text, res.adapter)}${res.requestedAdapter !== res.adapter ? fg(palette.amber, ' (fell back to local)') : ''}`);
  if (last && last.result && last.result.summary) {
    console.log(fg(palette.textDim, indent(String(last.result.summary).slice(0, 1200))));
  }
  return { kind: res.finalVerdict === 'stop-success' ? 'ok' : 'warn', text: `${a.id} → ${res.finalVerdict}` };
}

async function actionShowSession(s) {
  hr(`Session ${s.id.slice(0, 12)}`);
  console.log(`  ${fg(palette.muted, 'adapter:')} ${fg(palette.text, s.adapter || 'local')}   ${fg(palette.muted, 'verdict:')} ${verdictColor(s.finalVerdict)}`);
  console.log(`  ${fg(palette.muted, 'prompt: ')} ${fg(palette.textDim, String(s.prompt || '').slice(0, 200))}`);
  if (s.totalIterations != null) console.log(`  ${fg(palette.muted, 'iters:  ')} ${fg(palette.text, String(s.totalIterations))}`);
  return { kind: 'info', text: `session ${s.id.slice(0, 8)}` };
}

async function actionPolicy() {
  hr('Harness / policy gate');
  const pol = evaluatePolicy({ branch: 'feature/demo', hasTests: true, reviewCount: 1, owaspScope: ['llm', 'web'] });
  console.log(`  verdict: ${pol.passed ? fg(palette.green, 'PASS') : fg(palette.red, 'BLOCKED')}   score: ${fg(palette.text, String(pol.score))}   band: ${fg(palette.textDim, String(pol.band || 'n/a'))}`);
  const violations = pol.violations || [];
  const warnings = pol.warnings || [];
  if (violations.length) violations.forEach((v) => console.log(fg(palette.red, `  ${glyph.fail} `) + fg(palette.text, v.title || v.rule || String(v))));
  else console.log(fg(palette.green, `  ${glyph.ok} no violations`));
  if (warnings.length) warnings.forEach((v) => console.log(fg(palette.amber, `  ${glyph.warn} `) + fg(palette.text, v.title || v.rule || String(v))));
  return { kind: pol.passed ? 'ok' : 'warn', text: `policy → ${pol.passed ? 'PASS' : 'BLOCK'}` };
}

async function actionSpawn() {
  hr('Orchestration — spawn workers');
  const answer = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} How many parallel workers? [1]: `);
  const count = Math.max(1, Math.min(Number(answer) || 1, 50));
  console.log(fg(palette.muted, `  creating ${count} git-worktree worker(s)…`));
  const res = spawnWorktree({ count });
  (res.created || []).forEach((wk) => {
    if (wk.error) console.log(fg(palette.red, `  ${glyph.fail} ${wk.name}: `) + fg(palette.muted, wk.error));
    else console.log(fg(palette.green, `  ${glyph.ok} ${wk.name} `) + fg(palette.muted, `→ ${wk.branch}`));
  });
  const ok = (res.created || []).filter((w) => !w.error).length;
  return { kind: ok ? 'ok' : 'warn', text: `spawned ${ok}/${res.requested || count}` };
}

async function actionQuickAction(qa) {
  switch (qa.key) {
    case 'init': {
      hr('Guided setup');
      runInitCommand({}, console);
      return { kind: 'ok', text: 'guided setup complete' };
    }
    case 'doctor': return actionDoctor();
    case 'loop': return actionRunLoop();
    case 'sessions': {
      hr('Sessions');
      const list = listSessions({ limit: 12 });
      if (!list.length) console.log(fg(palette.muted, '  No sessions recorded yet.'));
      list.forEach((s) => console.log(`  ${s.finalVerdict === 'stop-success' ? fg(palette.green, glyph.ok) : fg(palette.amber, glyph.dot)} ${fg(palette.textDim, s.id.slice(0, 10))} ${fg(palette.muted, padEndVisible(s.adapter || 'local', 10))} ${fg(palette.text, String(s.finalVerdict || '…'))}`));
      return { kind: 'info', text: `${list.length} session(s)` };
    }
    case 'policy': return actionPolicy();
    case 'mission': {
      hr('Agentic mission');
      const goalInput = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Mission goal: `);
      const goal = (goalInput || '').trim() || 'Inspect this repository and propose one safe, high-value improvement.';
      console.log(fg(palette.muted, '  Running a safe dry-run rehearsal (add --dryRun=false from a shell for live)...'));
      const report = await runMissionCommand('run', { goal }, console);
      return { kind: report && report.status === 'succeeded' ? 'ok' : 'warn', text: report ? `mission ${report.status}` : 'mission failed' };
    }
    case 'supervise': { hr('Supervisor task graph'); await runSuperviseCommand('plan', {}, console); return { kind: 'info', text: 'supervisor plan' }; }
    case 'marketplace': { hr('Marketplace'); runMarketplaceCommand('list', {}, console); return { kind: 'info', text: 'marketplace listed' }; }
    case 'learn': { hr('Self-improvement intelligence'); runLearnCommand('report', {}, console); return { kind: 'info', text: 'insights generated' }; }
    case 'release': { hr('Release integrity'); runReleaseCommand('manifest', {}, console); return { kind: 'ok', text: 'release manifest generated' }; }
    case 'config': {
      hr('Adapter setup doctor');
      runConfigCommand('doctor', {}, console);
      return { kind: 'info', text: 'config doctor' };
    }
    case 'grok': {
      hr('xAI Grok');
      console.log(fg(palette.textDim, '  Configure once, then run live with tool calling:'));
      console.log(fg(palette.text, '    lehrosol config set --adapter grok --apiKey <XAI_API_KEY> --model grok-4.5'));
      console.log(fg(palette.text, '    lehrosol loop run --prompt "inspect this repo" --agentAdapter grok --dryRun=false'));
      console.log(fg(palette.muted, '  Docs: https://docs.x.ai · endpoint https://api.x.ai/v1'));
      return { kind: 'info', text: 'grok setup' };
    }
    case 'prefer': {
      hr('Set preferred adapter');
      const answer = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Adapter id (e.g. grok, ollama, opencode): `);
      const id = (answer || '').trim();
      if (!id) return { kind: 'warn', text: 'no adapter given' };
      setPreferredAdapter(id, { allowedIds: listAdapters().map((a) => a.id) });
      console.log(fg(palette.green, `  ${glyph.ok} preferred adapter → ${id}`));
      console.log(fg(palette.muted, '  Press g in the cockpit to launch it quickly.'));
      return { kind: 'ok', text: `preferred → ${id}` };
    }
    case 'threads': {
      return runThreadAction();
    }
    case 'spawn': return actionSpawn();
    case 'mcp': {
      hr('MCP control plane');
      console.log(fg(palette.textDim, '  Start the MCP server from a dedicated shell so it can keep running:'));
      console.log(fg(palette.text, '    lehrosol mcp start --http'));
      console.log(fg(palette.muted, '  (left out of the cockpit on purpose so it never blocks the UI thread)'));
      return { kind: 'info', text: 'mcp: see instructions' };
    }
    case 'vault': {
      hr('Model Vault — GGUFs on your drive');
      await runVaultCommand('list', {}, console);
      return { kind: 'ok', text: 'vault scanned · host one from the models view (m)' };
    }
    case 'compact': {
      hr('Engram Distillery');
      runCompactCommand({}, console);
      const answer = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Apply this compaction now? [y/N]: `);
      if (String(answer || '').trim().toLowerCase().startsWith('y')) {
        runCompactCommand({ apply: true }, console);
        return { kind: 'ok', text: 'sessions distilled into engrams' };
      }
      return { kind: 'info', text: 'compaction previewed (not applied)' };
    }
    case 'report': {
      hr('Mission report');
      runReportCommand({}, console);
      return { kind: 'ok', text: 'mission report exported' };
    }
    case 'gui': {
      hr('Web GUI control plane');
      const res = toggleWebPlane();
      if (res.live) {
        console.log(fg(palette.green, `  ${glyph.ok} control plane live: `) + fg(palette.text, `http://localhost:${res.port}`));
        console.log(fg(palette.muted, '  it keeps serving while you stay in the cockpit — press w (or run this action again) to stop it.'));
        return { kind: 'ok', text: `web GUI live → http://localhost:${res.port}` };
      }
      console.log(fg(palette.muted, `  ${glyph.info} control plane stopped.`));
      return { kind: 'info', text: 'web GUI stopped' };
    }
    default:
      hr(qa.label);
      console.log(fg(palette.textDim, `  ${qa.cmd}`));
      return { kind: 'info', text: qa.label };
  }
}

async function runThreadAction() {
  hr('CMUX threads — live execution');
  const taskInput = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Task prompt: `);
  const prompt = (taskInput || '').trim() || 'Inspect this project and propose two independent improvements.';
  const adapterInput = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Adapter [local]: `);
  const adapter = (adapterInput || '').trim() || 'local';
  const countInput = await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Thread count [2]: `);
  const count = Math.max(1, Math.min(Number(countInput) || 2, 12));
  const known = listAdapters().find((a) => a.id === adapter);
  if (!known) {
    console.log(fg(palette.red, `  ${glyph.fail} Unknown adapter: ${adapter}`));
    return { kind: 'warn', text: 'unknown thread adapter' };
  }
  if (adapter !== 'local' && !known.configured) {
    console.log(fg(palette.amber, `  ${glyph.warn} ${adapter} is not ready. ${adapterSetupHint(known)}`));
    return { kind: 'warn', text: `${adapter} needs setup` };
  }
  const result = await runThreadsCommand('run', {
    prompt,
    count,
    agentAdapter: adapter,
    dryRun: adapter === 'local',
    worktrees: true,
    maxIterations: 3,
  }, console);
  const passed = (result?.results || []).filter((r) => r.result?.finalVerdict === 'stop-success').length;
  return { kind: passed ? 'ok' : 'info', text: `threads → ${passed}/${count} passed` };
}

async function runOverlayAction(view, index, snapshot, state) {
  const item = overlayActions(view, snapshot)[index];
  if (!item) return { kind: 'warn', text: 'no overlay action selected' };

  if (view === 'commands') {
    if (item.key === 'config') { hr('Adapter configuration doctor'); runConfigCommand('doctor', {}, console); return { kind: 'info', text: 'config doctor complete' }; }
    if (item.key === 'models') { hr('Model profiles'); await runModelsCommand('list', {}, console); return { kind: 'info', text: 'model profiles listed' }; }
    if (item.key === 'probe') { hr('Model endpoint probe'); const id = snapshot.preferredAdapter || 'grok'; const result = await runModelsCommand('test', { adapter: id }, console); return { kind: result?.ok ? 'ok' : 'warn', text: `${id} probe ${result?.ok ? 'ready' : 'failed'}` }; }
    if (item.key === 'run') {
      const id = snapshot.preferredAdapter || 'grok';
      const adapter = snapshot.adapters.find((a) => a.id === id);
      if (!adapter) return { kind: 'warn', text: `${id} not found` };
      return actionRunAdapter(adapter);
    }
    if (item.key === 'sessions') return actionQuickAction({ key: 'sessions', label: 'Sessions', cmd: 'lehrosol sessions list' });
    if (item.key === 'policy') return actionPolicy();
  }

  if (view === 'threads') {
    if (item.key === 'list') { hr('Threads + worktrees'); await runThreadsCommand('list', {}, console); return { kind: 'info', text: 'threads listed' }; }
    if (item.key === 'run') return runThreadAction();
    if (item.key === 'spawn') return actionSpawn();
  }

  if (view === 'memory') {
    if (item.key === 'distill-preview') { hr('Engram Distillery — preview'); runCompactCommand({}, console); return { kind: 'info', text: 'compaction previewed' }; }
    if (item.key === 'distill-apply') { hr('Engram Distillery — apply'); runCompactCommand({ apply: true }, console); return { kind: 'ok', text: 'sessions distilled into engrams' }; }
    if (item.key === 'engrams') { hr('Engram memory book'); runEngramsCommand({}, console); return { kind: 'info', text: 'memory book listed' }; }
    if (item.key === 'report') { hr('Mission report'); runReportCommand({}, console); return { kind: 'ok', text: 'mission report exported' }; }
  }

  if (view === 'models') {
    if (item.key.startsWith('vault:')) {
      const id = item.key.slice('vault:'.length);
      const entry = vaultState().items.find((e) => e.id === id);
      if (!entry) return { kind: 'warn', text: 'model no longer on disk — press r to rescan' };
      hr(`Serve from drive: ${entry.id}`);
      console.log(fg(palette.textDim, `  ${entry.path}`));
      const portIn = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Port [${ENGINES.llamacpp.defaultPort}]: `)).trim();
      const res = await runServeCommand('start', { engine: 'llamacpp', model: entry.path, mmproj: entry.mmprojPath || undefined, port: Number(portIn) || ENGINES.llamacpp.defaultPort, use: true }, console);
      process.exitCode = 0;
      return { kind: res && res.ok ? 'ok' : 'warn', text: res && res.ok ? `${entry.id} hosted from disk + preferred` : 'vault serve failed — see hint above' };
    }
    if (item.key.startsWith('serve:jan:')) {
      const model = item.key.slice('serve:jan:'.length);
      hr(`Serve locally via Jan: ${model}`);
      const portIn = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} Port [${ENGINES.jan.defaultPort}]: `)).trim();
      const res = await runServeCommand('start', { engine: 'jan', model, port: Number(portIn) || ENGINES.jan.defaultPort, use: true }, console);
      process.exitCode = 0;
      return { kind: res && res.ok ? 'ok' : 'warn', text: res && res.ok ? `jan serving ${model} + preferred` : 'jan start failed — see above' };
    }
    if (item.key.startsWith('setmodel:')) {
      const id = item.key.slice('setmodel:'.length);
      hr(`Switch model on ${id}`);
      const model = (await readLineInput(`  ${fg(palette.cyan, glyph.caret)} New model id: `)).trim();
      if (!model) return { kind: 'warn', text: 'no model given' };
      runConfigCommand('set', { adapter: id, model }, console);
      return { kind: 'ok', text: `${id} → ${model}` };
    }
    if (item.key.startsWith('profile:')) {
      const profile = item.key.slice('profile:'.length);
      hr(`Use model profile: ${profile}`);
      const result = await runModelsCommand('use', { profile }, console);
      return { kind: result?.ok ? 'ok' : 'warn', text: result?.ok ? `preferred → ${result.preferredAdapter}` : 'model profile failed' };
    }
    if (item.key === 'current') { hr('Current model'); await runModelsCommand('current', {}, console); return { kind: 'info', text: 'current model shown' }; }
    if (item.key === 'probe') { const id = snapshot.preferredAdapter || 'grok'; hr(`Probe model: ${id}`); const result = await runModelsCommand('test', { adapter: id }, console); return { kind: result?.ok ? 'ok' : 'warn', text: `${id} probe ${result?.ok ? 'ready' : 'failed'}` }; }
  }

  return { kind: 'warn', text: `unsupported action: ${item.key}` };
}

async function runPanelAction(panelIdx, snapshot, state) {
  const sel = state.sel[panelIdx] || 0;
  if (panelIdx === P_HEALTH) return actionDoctor();
  if (panelIdx === P_ADAPTERS) {
    const a = snapshot.adapters[sel];
    if (!a) return { kind: 'warn', text: 'no adapter selected' };
    return actionRunAdapter(a);
  }
  if (panelIdx === P_SESSIONS) {
    const s = snapshot.sessions[sel];
    if (s) return actionShowSession(s);
    return actionRunLoop();
  }
  if (panelIdx === P_POLICY) return actionPolicy();
  if (panelIdx === P_ORCH) return actionSpawn();
  if (panelIdx === P_ACTIONS) {
    const qa = quickActions(state.mode)[sel];
    if (!qa) return { kind: 'warn', text: 'no action selected' };
    return actionQuickAction(qa);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Live immersive dashboard (custom runner with suspend/resume for actions)
// ---------------------------------------------------------------------------
async function runLiveDashboard(initialMode) {
  let snapshot = buildTuiSnapshot(initialMode);
  const state = createTuiState(snapshot.mode);
  clampTuiSelections(state, snapshot);

  const onKey = (key) => {
    const routed = applyTuiHotkey(key, state, snapshot);
    snapshot = routed.snapshot;
  };

  term.enterAlt();
  term.hideCursor();
  term.clear();
  let stop = startKeyReader(onKey);
  const interval = Math.max(30, Math.round(1000 / 14));
  let frame = 0;
  try {
    while (!state.done) {
      paintFrame(composeFrame(snapshot, {
        live: true, frame, panel: state.panel, sel: state.sel, view: state.view, toast: state.toast, overlaySel: state.overlaySel,
      }));
      frame += 1;

      if (state.pending) {
        const pending = state.pending;
        state.pending = null;
        // Suspend the cockpit: leave raw mode + alt screen, run the action in
        // the normal buffer, wait for a key, then resume.
        stop();
        term.showCursor();
        term.exitAlt();
        try {
          state.toast = (pending.overlay
            ? await runOverlayAction(pending.overlay, pending.index || 0, snapshot, state)
            : await runPanelAction(pending.panel, snapshot, state)) || null;
        } catch (err) {
          console.log(fg(palette.red, `\n  ${glyph.fail} Action failed: ${(err && err.message) || err}`));
          state.toast = { kind: 'warn', text: 'action failed' };
        }
        await waitForKey(fg(palette.muted, `  ${glyph.caret} press any key to return to the cockpit…`));
        snapshot = buildTuiSnapshot(state.mode);
        clampTuiSelections(state, snapshot);
        const overlayLen = overlayActions(state.view, snapshot).length;
        state.overlaySel = overlayLen ? Math.max(0, Math.min(state.overlaySel || 0, overlayLen - 1)) : 0;
        term.enterAlt();
        term.hideCursor();
        term.clear();
        stop = startKeyReader(onKey);
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(interval);
    }
  } finally {
    stop();
    term.showCursor();
    term.exitAlt();
  }

  console.log('\n' + gradient('  LehroSol cockpit closed. Keep shipping. ' + glyph.spark, gradients.brand));
  console.log(fg(palette.muted, '  Resume anytime with ') + fg(palette.textDim, 'lehrosol tui') + fg(palette.muted, '.\n'));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function runTuiCommand(flags = {}, logger = console) {
  const mode = resolveMode(flags.mode);

  if (flags.json) {
    const snapshot = buildTuiSnapshot(mode);
    return logger.json ? logger.json(snapshot) : console.log(JSON.stringify(snapshot, null, 2));
  }

  const wantsLive = !flags.static && !flags.once && (flags.live || flags.interactive || motionEnabled());
  if (wantsLive && motionEnabled()) {
    await runLiveDashboard(mode);
    return buildTuiSnapshot(mode);
  }

  // Static one-shot (pipes, CI, --static, or terminals without motion support)
  const snapshot = buildTuiSnapshot(mode);
  console.log(renderTuiSnapshot(snapshot));
  if ((flags.live || flags.interactive) && !motionEnabled()) {
    console.log(fg(palette.muted, `  ${glyph.info} live mode needs an interactive TTY; showing a static snapshot instead.`));
  }
  return snapshot;
}

export default { runTuiCommand, buildTuiSnapshot, renderTuiSnapshot };
