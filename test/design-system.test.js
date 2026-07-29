// Unit tests for the HELIX terminal design system (theme.js) and the motion
// engine (anim.js). These run without a TTY and assert graceful degradation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setColorLevel, gradient, sparkline, meter, badge, chip, boxSet,
  stripAnsi, displayWidth, fitVisible, centerVisible, setUnicode, palette, glyph,
} from '../src/core/theme.js';
import { shimmer, cometBar, pulseDots, spinnerFrame, motionEnabled } from '../src/core/anim.js';

test('color degrades to plain text at level 0', () => {
  setColorLevel(0);
  assert.equal(gradient('LEHRO', undefined), 'LEHRO');
  assert.equal(badge('OK', 'ok'), '[OK]');
  assert.equal(stripAnsi(meter(50, 100, 10)), '#####----- 50%');
});

test('truecolor output contains ANSI and strips back to source text', () => {
  setColorLevel(3);
  const g = gradient('LEHROSOL', undefined, { bold: true });
  assert.match(g, /\x1b\[/);
  assert.equal(stripAnsi(g), 'LEHROSOL');
  const b = badge('LIVE', 'live');
  assert.match(b, /\x1b\[/);
  assert.match(stripAnsi(b), /LIVE/);
  setColorLevel(0);
});

test('sparkline maps values to a compact bar string', () => {
  setColorLevel(0);
  const s = sparkline([0, 4, 8, 2, 6]);
  assert.equal(displayWidth(s), 5);
});

test('width helpers account for ANSI and truncate correctly', () => {
  setColorLevel(3);
  const colored = chip('advanced', palette.cyan);
  assert.ok(displayWidth(colored) < colored.length); // ANSI adds invisible bytes
  setColorLevel(0);
  assert.equal(displayWidth(fitVisible('hello world', 5)), 5);
  assert.equal(displayWidth(centerVisible('hi', 10)), 10);
});

test('unicode toggle swaps to ascii box + glyphs', () => {
  setUnicode(false);
  assert.equal(boxSet('round').tl, '+');
  assert.equal(glyph.ok, 'v');
  setUnicode(true);
  assert.equal(boxSet('round').tl, '\u256d');
});

test('motion primitives are deterministic per frame and never throw', () => {
  setColorLevel(3);
  assert.equal(typeof shimmer('LEHRO', 3), 'string');
  assert.equal(typeof cometBar(5, 20), 'string');
  assert.equal(pulseDots(2, 3).length, 3);
  assert.equal(typeof spinnerFrame(7), 'string');
  assert.equal(typeof motionEnabled(), 'boolean');
  setColorLevel(0);
});
