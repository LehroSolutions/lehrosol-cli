// Unit coverage for the benchmark validity guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuLoadSample } from '../src/commands/quick.js';

test('cpuLoadSample reports a 0-100 busy percentage', async () => {
  const load = await cpuLoadSample(120);
  assert.equal(typeof load, 'number');
  assert.ok(load >= 0 && load <= 100, `got ${load}`);
});
