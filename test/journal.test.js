import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJournal, recordMission, journalStats, suggestTuning, backupFile, undoMission, newMissionId } from '../src/core/journal.js';

test('journal records missions newest-first and survives reload', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'lehro-journal-')), 'journal.json');
  recordMission({ id: 'm1', ok: true, task: 'first', steps: 3 }, path);
  const saved = recordMission({ ok: false, task: 'second', steps: 5, error: 'HTTP 500 — Context size has been exceeded.' }, path);
  assert.ok(saved.id && saved.at);
  const journal = readJournal(path);
  assert.equal(journal.missions.length, 2);
  assert.equal(journal.missions[0].task, 'second');
  assert.equal(journal.missions[1].id, 'm1');
});

test('suggestTuning learns compact from overflows and expanded from quick clean runs', () => {
  const overflowy = { missions: [{ ok: false, error: 'Context size has been exceeded', steps: 2 }] };
  assert.equal(suggestTuning(overflowy).contextMode, 'compact');
  const smooth = { missions: [1, 2, 3].map((i) => ({ ok: true, steps: 3, task: `t${i}` })) };
  assert.equal(suggestTuning(smooth).contextMode, 'expanded');
  assert.equal(suggestTuning({ missions: [] }).contextMode, null);
  const stats = journalStats(overflowy);
  assert.equal(stats.recentOverflows, 1);
  assert.equal(stats.recentFailures, 1);
});

test('backupFile + undoMission restores overwritten files and deletes created ones', () => {
  const home = mkdtempSync(join(tmpdir(), 'lehro-home-'));
  const root = mkdtempSync(join(tmpdir(), 'lehro-proj-'));
  const id = newMissionId();
  writeFileSync(join(root, 'a.txt'), 'original');
  backupFile(id, root, 'a.txt', home);          // existed — snapshot taken
  writeFileSync(join(root, 'a.txt'), 'clobbered');
  backupFile(id, root, 'sub/b.txt', home);      // did not exist — marked for delete
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'sub/b.txt'), 'new file');
  const res = undoMission(id, home);
  assert.equal(res.ok, true);
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'original');
  assert.equal(existsSync(join(root, 'sub/b.txt')), false);
  assert.deepEqual(res.restored, ['a.txt']);
  assert.deepEqual(res.deleted, ['sub/b.txt']);
  // undo with no backup is a clean refusal
  assert.equal(undoMission('nope', home).ok, false);
});
