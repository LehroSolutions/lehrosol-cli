import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TUI_HOTKEY_CONTRACT,
  applyTuiHotkey,
  buildTuiSnapshot,
  createTuiState,
} from '../src/commands/tui.js';

function route(key, state, snapshot) {
  const r = applyTuiHotkey(key, state, snapshot);
  return r.snapshot;
}

test('tui hotkey contract documents every visible cockpit shortcut', () => {
  const flattened = new Set(TUI_HOTKEY_CONTRACT.flatMap((x) => x.keys));
  for (const key of ['q', 'ctrl-c', 'tab', 'right', 'left', 'h', 'l', 'up', 'down', 'j', 'k', 'enter', 'space', '1', '2', '3', 'r', 'd', 'a', 's', 'p', 'c', 'f', 'g', 't', 'x', 'e', 'w', '?', 'esc']) {
    assert.ok(flattened.has(key), `missing hotkey contract for ${key}`);
  }
});

test('tui navigation hotkeys move panel focus and row selection', () => {
  let snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  const start = state.panel;

  snapshot = route('tab', state, snapshot);
  assert.equal(state.panel, (start + 1) % 7);
  snapshot = route('left', state, snapshot);
  assert.equal(state.panel, start);
  snapshot = route('right', state, snapshot);
  assert.equal(state.panel, (start + 1) % 7);

  // Move to adapters panel, which always has selectable rows.
  state.panel = 1;
  state.sel[1] = 0;
  snapshot = route('down', state, snapshot);
  assert.equal(state.sel[1], 1);
  snapshot = route('k', state, snapshot);
  assert.equal(state.sel[1], 0);
});

test('tui overlay hotkeys open views and escape returns dashboard', () => {
  let snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  const views = { d: 'doctor', a: 'adapters', s: 'sessions', p: 'policy', '?': 'help' };
  for (const [key, view] of Object.entries(views)) {
    snapshot = route(key, state, snapshot);
    assert.equal(state.view, view);
    snapshot = route('esc', state, snapshot);
    assert.equal(state.view, 'dashboard');
  }
});

test('tui Enter and Space launch the focused panel action', () => {
  let snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  state.panel = 1;
  snapshot = route('enter', state, snapshot);
  assert.deepEqual(state.pending, { panel: 1 });
  state.pending = null;
  snapshot = route('space', state, snapshot);
  assert.deepEqual(state.pending, { panel: 1 });
});

test('tui number keys run visible quick-action buttons when quick-actions is focused', () => {
  let snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  state.panel = 6;
  snapshot = route('2', state, snapshot);
  assert.equal(state.sel[6], 1);
  assert.deepEqual(state.pending, { panel: 6 });
});

test('tui stage keys still switch stage outside quick-actions', () => {
  let snapshot = buildTuiSnapshot('basic');
  const state = createTuiState('basic');
  state.panel = 0;
  snapshot = route('3', state, snapshot);
  assert.equal(state.mode, 'advanced');
  assert.equal(snapshot.mode, 'advanced');
});

test('tui refresh and quit hotkeys mutate state predictably', () => {
  let snapshot = buildTuiSnapshot('intermediate');
  const state = createTuiState('intermediate');
  snapshot = route('r', state, snapshot);
  assert.equal(snapshot.mode, 'intermediate');
  assert.match(state.toast.text, /refreshed/);
  snapshot = route('q', state, snapshot);
  assert.equal(state.done, true);
});

test('tui command palette and threads overlays open', () => {
  let snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  applyTuiHotkey('c', state, snapshot);
  assert.equal(state.view, 'commands');
  applyTuiHotkey('esc', state, snapshot);
  assert.equal(state.view, 'dashboard');
  applyTuiHotkey('t', state, snapshot);
  assert.equal(state.view, 'threads');
});

test('tui snapshot includes grok adapter and metrics for tools/httpReady', () => {
  const snap = buildTuiSnapshot('advanced');
  assert.ok(snap.adapters.some((a) => a.id === 'grok'));
  assert.ok(typeof snap.metrics.tools === 'number');
  assert.ok(typeof snap.metrics.httpReady === 'number');
  assert.ok(Array.isArray(snap.favoriteAdapters));
});

test('tui model palette supports selection and Enter execution routing', () => {
  const snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  applyTuiHotkey('m', state, snapshot);
  assert.equal(state.view, 'models');
  assert.equal(state.overlaySel, 0);
  applyTuiHotkey('down', state, snapshot);
  assert.equal(state.overlaySel, 1);
  applyTuiHotkey('enter', state, snapshot);
  assert.deepEqual(state.pending, { overlay: 'models', index: 1 });
});

test('tui command palette Enter routes an executable overlay action', () => {
  const snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  applyTuiHotkey('c', state, snapshot);
  applyTuiHotkey('enter', state, snapshot);
  assert.deepEqual(state.pending, { overlay: 'commands', index: 0 });
});

test('tui memory view opens with e and routes distillery actions', () => {
  const snapshot = buildTuiSnapshot('advanced');
  const state = createTuiState('advanced');
  applyTuiHotkey('e', state, snapshot);
  assert.equal(state.view, 'memory');
  assert.equal(state.overlaySel, 0);
  applyTuiHotkey('enter', state, snapshot);
  assert.deepEqual(state.pending, { overlay: 'memory', index: 0 });
});

test('tui snapshot carries engram memory, project identity and web plane state', () => {
  const snap = buildTuiSnapshot('advanced');
  assert.ok(Array.isArray(snap.engrams));
  assert.ok(Array.isArray(snap.fieldNotes));
  assert.ok(snap.project && typeof snap.project.codename === 'string' && typeof snap.project.tag === 'string');
  assert.ok(typeof snap.storeBytes === 'number');
  assert.ok(typeof snap.sessionsOnDisk === 'number');
  assert.ok(snap.web && typeof snap.web.live === 'boolean');
});
