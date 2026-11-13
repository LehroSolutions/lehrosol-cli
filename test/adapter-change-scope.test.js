import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { changedFilesSince, diffText } from '../src/loop/adapters/shared.js';

test('adapter evidence uses paths relative to the mission folder and excludes parent changes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'lehrosol-change-scope-'));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const git = (args, options = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options });
  git(['init', '--quiet']);
  // An empty tree permits a diff without creating any commits.
  const reference = git(['hash-object', '-w', '-t', 'tree', '--stdin'], { input: '' }).trim();
  const project = join(root, 'project with spaces'); mkdirSync(project);
  writeFileSync(join(root, 'parent.txt'), 'PARENT_CHANGE_MUST_STAY_OUTSIDE\n');
  writeFileSync(join(project, 'local note.txt'), 'mission content\n');
  git(['add', '--', '.']);
  writeFileSync(join(project, ' untracked note.txt'), 'untracked content\n');
  writeFileSync(join(root, 'outside-untracked.txt'), 'outside\n');
  assert.deepEqual(changedFilesSince(project, reference).sort(), [' untracked note.txt', 'local note.txt'].sort());
  const diff = diffText(project, reference);
  assert.match(diff, /mission content/);
  assert.doesNotMatch(diff, /PARENT_CHANGE_MUST_STAY_OUTSIDE|parent\.txt/);
});
