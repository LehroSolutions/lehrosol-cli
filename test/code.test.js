import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractAction, applyAction, trimHistory, buildSystemPrompt } from '../src/commands/code.js';

test('extractAction digs the JSON action out of chatty replies', () => {
  assert.deepEqual(extractAction('{"action":"list","path":"."}'), { action: 'list', path: '.' });
  const fenced = 'Sure! Here is my action:\n```json\n{"action":"read","path":"src/a.js"}\n```\nLet me know!';
  assert.deepEqual(extractAction(fenced), { action: 'read', path: 'src/a.js' });
  const nested = 'Writing now. {"action":"write","path":"a.json","content":"{\\"x\\":{\\"y\\":1}}"} done';
  assert.equal(extractAction(nested).content, '{"x":{"y":1}}');
  assert.equal(extractAction('no json here at all'), null);
  assert.equal(extractAction('an object but no action: {"path":"x"}'), null);
});

test('applyAction jails writes to the project root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lehro-code-'));
  const ctx = { root, dryRun: false, allowRun: false, changed: [] };
  const ok = await applyAction({ action: 'write', path: 'notes/hello.txt', content: 'hi' }, ctx);
  assert.equal(ok.ok, true);
  assert.equal(readFileSync(join(root, 'notes', 'hello.txt'), 'utf8'), 'hi');
  assert.deepEqual(ctx.changed, [join('notes', 'hello.txt')]);
  const blocked = await applyAction({ action: 'write', path: '../escape.txt', content: 'x' }, ctx);
  assert.equal(blocked.ok, false, 'writing outside the project root must be refused');
  assert.match(blocked.observation, /Refusing to write outside/);
});

test('applyAction accepts markdown-wrapped file names and planned directories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lehro-code-'));
  writeFileSync(join(root, 'README.md'), '# Project');
  const ctx = { root, dryRun: false, allowRun: false, changed: [] };
  const linked = await applyAction({ action: 'read', path: '[README.md](http://readme.md/)' }, ctx);
  assert.equal(linked.ok, true);
  assert.match(linked.observation, /Project/);
  const made = await applyAction({ action: 'mkdir', path: 'src/components' }, ctx);
  assert.equal(made.ok, true);
  assert.equal(existsSync(join(root, 'src', 'components')), true);
});

test('applyAction keeps command execution behind --allowRun', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lehro-code-'));
  const refused = await applyAction({ action: 'run', command: 'echo hi' }, { root, allowRun: false, changed: [] });
  assert.equal(refused.ok, false);
  assert.match(refused.observation, /disabled/);
  const allowed = await applyAction({ action: 'run', command: 'echo hi' }, { root, allowRun: true, changed: [] });
  assert.equal(allowed.ok, true);
  assert.match(allowed.observation, /hi/);
});

test('list hides dependency noise like node_modules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lehro-code-'));
  mkdirSync(join(root, 'node_modules'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'a.txt'), 'x');
  const res = await applyAction({ action: 'list', path: '.' }, { root, changed: [] });
  assert.ok(res.observation.includes('src/'));
  assert.ok(res.observation.includes('a.txt'));
  assert.ok(!res.observation.includes('node_modules'));
});

test('trimHistory keeps recent turns intact and shrinks old ones', () => {
  const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(5000) }));
  const trimmed = trimHistory(history, 10, 100);
  assert.equal(trimmed.length, 10);
  assert.ok(trimmed[0].content.length < 200, 'old messages are truncated');
  assert.equal(trimmed[9].content.length, 5000, 'latest messages stay intact');
});

test('system prompt only advertises run when it is enabled', () => {
  assert.match(buildSystemPrompt({ allowRun: false }), /disabled in this session/);
  assert.match(buildSystemPrompt({ allowRun: true }), /"action":"run"/);
});

test('follow-up prompts restate the task so compact history cannot lose the goal', async () => {
  const { buildFollowUpPrompt, buildNudgePrompt } = await import('../src/commands/code.js');
  const follow = buildFollowUpPrompt('add input validation to src/server.js', 'read', '--- src/server.js ---\ncode here');
  assert.ok(follow.startsWith('TASK (unchanged): add input validation to src/server.js'));
  assert.ok(follow.includes('RESULT of read:'));
  assert.ok(follow.includes('Next action?'));
  const nudge = buildNudgePrompt('add input validation to src/server.js');
  assert.ok(nudge.startsWith('TASK (unchanged): add input validation'));
  assert.ok(nudge.includes('EXACTLY one JSON object'));
  // very long goals are truncated so the reminder itself cannot blow the context
  const long = buildFollowUpPrompt('x'.repeat(2000), 'list', 'entries');
  assert.ok(long.length < 700);
});
