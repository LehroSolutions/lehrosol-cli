import test from 'node:test';
import assert from 'node:assert/strict';
import { runLoop } from '../src/loop/loop.js';

test('unknown live adapter rejects instead of silently falling back to local', async () => {
  await assert.rejects(
    runLoop({ prompt: 'test', agentAdapter: 'does-not-exist', dryRun: false, maxIterations: 1 }),
    /Unknown live adapter/,
  );
});

test('unavailable live CLI adapter stops after one iteration with explicit verdict', async () => {
  const result = await runLoop({ prompt: 'test unavailable adapter', agentAdapter: 'qoder', dryRun: false, maxIterations: 4 });
  assert.equal(result.totalIterations, 1);
  assert.equal(result.finalVerdict, 'stop-adapter-unavailable');
  assert.equal(result.iterations[0].score.score, 0);
});
