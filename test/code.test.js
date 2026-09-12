import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractAction, applyAction, trimHistory, buildSystemPrompt, resolveCodeBudget, resolveCodeGenerationSettings } from '../src/commands/code.js';

test('code generation recommendations cannot exceed context safety budgets', () => {
  const recommendation = { ready: true, recommended: { settings: { maxTokens: 1024, temperature: 0.3 } } };
  assert.deepEqual(
    resolveCodeGenerationSettings({ recommendation, resourceProfile: 'performance', contextMode: 'normal' }),
    { maxTokens: 384, temperature: 0.3 },
  );
  assert.deepEqual(
    resolveCodeGenerationSettings({ flags: { maxTokens: 640, temperature: 0 }, recommendation, resourceProfile: 'eco', contextMode: 'compact' }),
    { maxTokens: 640, temperature: 0 },
  );
});

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

test('applyAction edit makes surgical, unique-match replacements', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lehro-code-'));
  writeFileSync(join(root, 'plan.md'), 'line one\n- [ ] old item\nline three\n');
  const ctx = { root, dryRun: false, allowRun: false, changed: [] };
  const ok = await applyAction({ action: 'edit', path: 'plan.md', find: '- [ ] old item', replace: '- [x] old item' }, ctx);
  assert.equal(ok.ok, true);
  assert.equal(readFileSync(join(root, 'plan.md'), 'utf8'), 'line one\n- [x] old item\nline three\n');
  assert.deepEqual(ctx.changed, [join('plan.md')]);
  const missing = await applyAction({ action: 'edit', path: 'plan.md', find: 'NOT PRESENT', replace: 'x' }, ctx);
  assert.equal(missing.ok, false, 'a no-match find must refuse with a self-correction hint');
  assert.match(missing.observation, /not found/);
  const ambiguous = await applyAction({ action: 'edit', path: 'plan.md', find: 'line', replace: 'LINE' }, ctx);
  assert.equal(ambiguous.ok, false, 'an ambiguous find must refuse instead of guessing');
  assert.match(ambiguous.observation, /2 times/);
  const dry = await applyAction({ action: 'edit', path: 'plan.md', find: '- [x] old item', replace: 'y' }, { root, dryRun: true, changed: [] });
  assert.equal(dry.ok, true);
  assert.match(dry.observation, /DRY RUN/);
  assert.equal(readFileSync(join(root, 'plan.md'), 'utf8'), 'line one\n- [x] old item\nline three\n', 'dry-run edit must hold back');
  const esc = await applyAction({ action: 'edit', path: '../escape.txt', find: 'a', replace: 'b' }, { root, changed: [] });
  assert.equal(esc.ok, false, 'edits outside the project root must be refused');
});

test('buildSystemPrompt advertises the surgical edit action', () => {
  const prompt = buildSystemPrompt({ allowRun: true });
  assert.match(prompt, /"action":"edit"/);
  assert.match(prompt, /Prefer "edit" over "write"/);
  const strict = buildSystemPrompt({ allowRun: false });
  assert.match(strict, /"action":"edit"/);
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
  assert.match(buildSystemPrompt({ allowRun: false }), /Do not use "done" merely because you reached a step budget/);
});

test('code lane extends a pass budget by default and supports strict mode', () => {
  assert.deepEqual(resolveCodeBudget({}), {
    maxSteps: 24,
    autoContinue: true,
    maxExtensions: 3,
    totalStepBudget: 96,
  });
  assert.deepEqual(resolveCodeBudget({ maxSteps: 12, maxExtensions: 4 }), {
    maxSteps: 12,
    autoContinue: true,
    maxExtensions: 4,
    totalStepBudget: 60,
  });
  assert.deepEqual(resolveCodeBudget({ maxSteps: 12, noAutoContinue: true }), {
    maxSteps: 12,
    autoContinue: false,
    maxExtensions: 0,
    totalStepBudget: 12,
  });
  assert.equal(resolveCodeBudget({ maxSteps: 999 }).totalStepBudget, 160);
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
