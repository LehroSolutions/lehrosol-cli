// Engram Distillery tests — run against an isolated LEHRO_HOME so the real
// user store is never touched. Modules are imported dynamically AFTER the
// env override so config.js picks up the temp home.
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LEHRO_HOME = mkdtempSync(join(tmpdir(), 'lehro-engrams-'));

const { distillSession, compactSessions, loadEngrams, fieldNotesFor, digestPrompt } = await import('../src/core/engrams.js');
const { createSession, recordCheckpoint, finalizeSession, listSessions } = await import('../src/core/sessionStore.js');

test('digestPrompt strips mode preamble and injected field notes', () => {
  const effective = 'You are Recon.\n\n# USER GOAL\nfix the login bug\n\n# FIELD NOTES (lessons distilled from previous runs in this project)\n- old lesson';
  assert.equal(digestPrompt(effective), 'fix the login bug');
  assert.equal(digestPrompt('plain goal'), 'plain goal');
});

test('distillSession produces a lesson, verdict trail, and diff summary', () => {
  const engram = distillSession({
    id: 'abc-123',
    cwd: '/tmp/some-project',
    adapter: 'jan',
    totalIterations: 1,
    prompt: 'PREAMBLE\n\n# USER GOAL\nfix the login bug',
    startedAt: '2026-07-19T10:00:00Z',
    finishedAt: '2026-07-19T10:01:00Z',
    finalVerdict: 'stop-success',
    checkpoints: [{
      iteration: 1,
      data: {
        score: { verdict: 'stop-success' },
        diff: { empty: false, stat: ' app.txt | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)' },
      },
    }],
  });
  assert.equal(engram.promptDigest, 'fix the login bug');
  assert.equal(engram.finalVerdict, 'stop-success');
  assert.deepEqual(engram.verdictTrail, ['stop-success']);
  assert.equal(engram.diffSummary, '1 file changed, 1 insertion(+), 1 deletion(-)');
  assert.ok(engram.lesson.includes('jan'), 'lesson should mention the adapter');
  assert.ok(engram.lesson.includes('fix the login bug'), 'lesson should mention the goal');
});

test('distillSession captures an error signature for adapter failures', () => {
  const engram = distillSession({
    id: 'err-1',
    cwd: '/tmp/some-project',
    adapter: 'jan',
    totalIterations: 1,
    prompt: 'call the model',
    finishedAt: '2026-07-19T11:00:00Z',
    finalVerdict: 'stop-adapter-error',
    checkpoints: [{ iteration: 1, data: { result: { output: 'HTTP 401: Invalid API Key' }, score: { verdict: 'stop-adapter-error' } } }],
  });
  assert.ok(engram.errorSignature.includes('401'));
  assert.ok(engram.lesson.includes('check adapter health'));
});

test('compactSessions previews, then distills old sessions and shrinks the store', () => {
  for (let i = 0; i < 3; i++) {
    const id = 'sess-' + i;
    createSession({ id, prompt: 'goal number ' + i, adapter: 'local', cwd: '/tmp/proj-engrams', startedAt: `2026-07-1${i}T00:00:00.000Z` });
    recordCheckpoint(id, 1, { iteration: 1, adapter: 'local', score: { verdict: 'stop-success' } });
    finalizeSession(id, { finalVerdict: 'stop-success', totalIterations: 1 });
  }

  const preview = compactSessions({ keep: 1, apply: false });
  assert.equal(preview.applied, false);
  assert.equal(preview.distilled, 2, 'two oldest sessions should be candidates');
  assert.equal(listSessions({ limit: 10 }).length, 3, 'preview must not delete anything');

  const applied = compactSessions({ keep: 1, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.distilled, 2);
  assert.equal(listSessions({ limit: 10 }).length, 1, 'only the newest full session survives');

  const book = loadEngrams();
  assert.equal(book.length, 2);
  assert.ok(book.every((e) => e.lesson && e.id.startsWith('sess-')));

  const notes = fieldNotesFor('/tmp/proj-engrams', 3);
  assert.ok(notes.length >= 1, 'field notes should surface for the project');
  assert.ok(notes[0].includes('goal number'), 'lesson should reference the original goal');

  // Re-running is idempotent: nothing new to distill.
  const again = compactSessions({ keep: 1, apply: true });
  assert.equal(again.distilled, 0);
});
