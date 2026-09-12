// Long-task persistence: proves the harness pushes weak models past premature
// "Done!" answers, keeps memory across outer-loop passes, and honors step
// budgets. Uses a scripted OpenAI-compatible stub server — no live model needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createHttpAdapter, resolveToolStepBudget, looksLikeActionTask,
} from '../src/loop/adapters/makeHttpAdapter.js';
import { scoreIteration } from '../src/loop/scoreAgent.js';

function onceListening(server) {
  return new Promise((resolve) => server.on('listening', resolve));
}
function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Scripted engine: each entry is a function(requestBody) -> assistant message.
function stubEngine(script) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { /* keep {} */ }
      requests.push(parsed);
      const respond = script[Math.min(requests.length - 1, script.length - 1)];
      const message = respond(parsed);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  server.listen(0, '127.0.0.1');
  return { server, requests };
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'lehro-persist-'));
  writeFileSync(join(dir, 'README.md'), '# sandbox\n');
  return dir;
}

function adapterFor(port) {
  return createHttpAdapter({
    id: 'stub-engine',
    label: 'Stub Engine',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: 'stub-1',
    local: true,
  });
}

test('a model that quits without doing work is challenged, then completes via tools', async () => {
  const toolCallMessage = {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'README.md' }) } }],
  };
  const { server, requests } = stubEngine([
    () => ({ role: 'assistant', content: 'Done! I implemented everything you asked for.' }),
    () => toolCallMessage,
    () => ({ role: 'assistant', content: 'Updated README.md with a usage section; verified by reading the file back.' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    const result = await adapter.run({
      prompt: 'fix the README typo and add a usage section',
      cwd: sandbox(),
      reviewCount: 1,
    });
    assert.equal(result.incomplete, false, 'task must complete, not checkpoint');
    assert.equal(result.challenges, 1, 'premature completion must be challenged once');
    assert.ok(result.toolCalls.some((t) => t.tool === 'read_file' && t.ok), 'model must do real tool work');
    assert.equal(result.evidence.toolCalls, 1);
    assert.equal(result.evidence.changedFiles, 0, 'read-only work changed no files but still counts as evidence');
    // The challenge message actually reached the model on request 2:
    const challenged = requests[1].messages.some((m) => m.role === 'user' && /without performing any tool actions/.test(m.content));
    assert.ok(challenged, 'challenge prompt must be injected into the conversation');
    assert.match(result.summary, /pushed back on 1 premature completion/);
  } finally {
    await close(server);
  }
});

test('an honest BLOCKED answer is accepted as terminal instead of challenged forever', async () => {
  const { server } = stubEngine([
    () => ({ role: 'assistant', content: 'Done!' }),
    () => ({ role: 'assistant', content: 'BLOCKED: the target module does not exist in this repository.' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    const result = await adapter.run({ prompt: 'refactor the missing widget module', cwd: sandbox(), reviewCount: 1 });
    assert.equal(result.incomplete, false);
    assert.equal(result.blocked, true);
    assert.equal(result.challenges, 1);
    assert.match(result.summary, /BLOCKED/);
  } finally {
    await close(server);
  }
});

test('identical repeated tool calls trigger a stall warning, not silence', async () => {
  const searchCall = 'Searching...\n```json\n{"name": "search_text", "arguments": {"query": "Hello World"}}\n```';
  const { server, requests } = stubEngine([
    () => ({ role: 'assistant', content: searchCall }),
    () => ({ role: 'assistant', content: searchCall }),
    () => ({ role: 'assistant', content: searchCall }),
    () => ({ role: 'assistant', content: searchCall }),
    () => ({ role: 'assistant', content: 'Final answer: found nothing useful.' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    const result = await adapter.run({ prompt: 'find and update the greeting text', cwd: sandbox(), reviewCount: 1 });
    assert.ok(result.stallWarnings >= 1, 'stall guard must fire on repeated identical calls');
    const warned = requests.some((req) => req.messages.some((m) => m.role === 'user' && /HARNESS STALL WARNING/.test(m.content)));
    assert.ok(warned, 'stall warning must be injected into the conversation');
  } finally {
    await close(server);
  }
});

test('system prompt inoculates against fix_plan.md fixation', async () => {

  const { server, requests } = stubEngine([
    () => ({ role: 'assistant', content: 'ok' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    await adapter.run({ prompt: 'fix the README typo', cwd: sandbox(), reviewCount: 1 });
    const sys = requests[0].messages.find((m) => m.role === 'system').content;
    assert.match(sys, /user message defines the ONLY task/);
    assert.match(sys, /Do not look for a file called fix_plan\.md/);
  } finally {
    await close(server);
  }
});

test('a pure question is answered without a challenge', async () => {

  const { server, requests } = stubEngine([
    () => ({ role: 'assistant', content: 'BLAKE3 is a cryptographic hash function.' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    const result = await adapter.run({ prompt: 'What is BLAKE3 used for?', cwd: sandbox(), reviewCount: 1 });
    assert.equal(result.incomplete, false);
    assert.equal(result.challenges, 0, 'question-style prompts must not be challenged');
    assert.equal(requests.length, 1);
  } finally {
    await close(server);
  }
});

test('continuation passes carry prior-pass memory into the fresh chat', async () => {
  const { server, requests } = stubEngine([
    () => ({ role: 'assistant', content: 'Continuing where the last pass left off.' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    const result = await adapter.run({
      prompt: 'write the parser module',
      cwd: sandbox(),
      reviewCount: 1,
      iteration: 3,
      lastSummary: 'PRIOR-PASS-WORK: parser half written, tokenizer done',
    });
    assert.equal(result.incomplete, false);
    const firstUser = requests[0].messages.find((m) => m.role === 'user');
    assert.match(firstUser.content, /OUTER-LOOP CONTINUATION/);
    assert.match(firstUser.content, /pass 3 of this loop/);
    assert.match(firstUser.content, /PRIOR-PASS-WORK/);
  } finally {
    await close(server);
  }
});

test('text-form tool calls (fenced json) are recovered and executed', async () => {
  const { server, requests } = stubEngine([
    // The live qwen2.5-coder failure mode: the model outputs the call as TEXT.
    () => ({ role: 'assistant', content: 'I will inspect the repo.\n```json\n{"name": "read_file", "arguments": {"path": "README.md"}}\n```' }),
    () => ({ role: 'assistant', content: 'Read README.md; now the final answer with evidence.' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    const result = await adapter.run({ prompt: 'inspect and fix the README', cwd: sandbox(), reviewCount: 1 });
    assert.equal(result.incomplete, false);
    assert.equal(result.evidence.toolCalls, 1, 'recovered text tool call must count as evidence');
    assert.ok(result.toolCalls.some((t) => t.tool === 'read_file' && t.ok && t.recovered));
    // The tool result must come back to the model as plain text (template-agnostic):
    const fedBack = requests[1].messages.some((m) => m.role === 'user' && /\[TOOL RESULT — read_file\]/.test(m.content));
    assert.ok(fedBack, 'recovered tool results must be fed back as user text');
  } finally {
    await close(server);
  }
});

test('parseTextToolCalls handles the real-world formats and rejects garbage', async () => {
  const { parseTextToolCalls } = await import('../src/loop/adapters/makeHttpAdapter.js');
  const fenced = parseTextToolCalls('text before\n```json\n{"name": "write_file", "arguments": {"path": "a.js", "content": "x"}}\n```\ntext after');
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].function.name, 'write_file');
  assert.deepEqual(JSON.parse(fenced[0].function.arguments), { path: 'a.js', content: 'x' });

  const xml = parseTextToolCalls('<tool_call>\n{"name": "list_files", "arguments": {"path": "."}}\n</tool_call>');
  assert.equal(xml.length, 1);
  assert.equal(xml[0].function.name, 'list_files');

  const bare = parseTextToolCalls('{"name": "read_file", "arguments": "{\\"path\\": \\"b.js\\"}"}');
  assert.equal(bare.length, 1);
  assert.deepEqual(JSON.parse(bare[0].function.arguments), { path: 'b.js' }, 'string arguments must be unwrapped');

  assert.deepEqual(parseTextToolCalls('just talking about {"name": 42}'), [], 'non-string names rejected');
  assert.deepEqual(parseTextToolCalls('```json\n{"a": 1}\n```'), [], 'objects without a name rejected');
  assert.deepEqual(parseTextToolCalls(''), []);
});

test('an instant BLOCKED with zero tool activity is challenged, not accepted', async () => {

  const { server, requests } = stubEngine([
    () => ({ role: 'assistant', content: 'BLOCKED: no tasks provided in fix_plan.md.' }),
    () => ({ role: 'assistant', content: 'BLOCKED: still cannot act.' }),
  ]);
  await onceListening(server);
  const { port } = server.address();
  const adapter = adapterFor(port);
  try {
    const result = await adapter.run({ prompt: 'fix the README typo and add a usage section', cwd: sandbox(), reviewCount: 1 });
    assert.equal(requests.length, 2, 'workless BLOCKED must be challenged before being accepted');
    assert.ok(requests[1].messages.some((m) => m.role === 'user' && /NOT a valid blocker/.test(m.content)));
    assert.equal(result.incomplete, false);
    assert.equal(result.blocked, true, 'BLOCKED after a challenge is an honest terminal state');
    assert.equal(result.challenges, 1);
  } finally {
    await close(server);
  }
});

test('step budgets: 64 local / 24 remote defaults, env override, 200 ceiling, explicit wins', () => {

  const savedEnv = process.env.LEHRO_TOOL_STEPS;
  try {
    delete process.env.LEHRO_TOOL_STEPS;
    assert.equal(resolveToolStepBudget({ local: true }), 64);
    assert.equal(resolveToolStepBudget({ local: false }), 24);
    assert.equal(resolveToolStepBudget({}), 24, 'remote default when local flag absent');

    process.env.LEHRO_TOOL_STEPS = '100';
    assert.equal(resolveToolStepBudget({ local: true }), 100);
    assert.equal(resolveToolStepBudget({ local: true, toolSteps: 12 }), 12, 'explicit toolSteps beats env');
    delete process.env.LEHRO_TOOL_STEPS;

    assert.equal(resolveToolStepBudget({ local: true, toolSteps: 5000 }), 200, 'hard ceiling');
    assert.equal(resolveToolStepBudget({ local: true, toolSteps: 0 }), 64, 'invalid values fall back');
  } finally {
    if (savedEnv === undefined) delete process.env.LEHRO_TOOL_STEPS;
    else process.env.LEHRO_TOOL_STEPS = savedEnv;
  }
});

test('action-task classification separates work prompts from questions', () => {
  assert.ok(looksLikeActionTask('fix the auth endpoint'));
  assert.ok(looksLikeActionTask('Refactor the parser and add tests'));
  assert.ok(looksLikeActionTask('migrate config to jsonc'));
  assert.ok(!looksLikeActionTask('What does this function do?'));
  assert.ok(!looksLikeActionTask('Explain the difference between git merge and rebase'));
});

test('Score Agent keeps iterating until the (raised) default budget of 12', () => {
  const failing = { hasTests: false, secretScanPassed: true, reviewCount: 0, branch: 'main' };
  assert.equal(scoreIteration({ iteration: 11, policyInput: failing }).verdict, 'continue');
  assert.equal(scoreIteration({ iteration: 12, policyInput: failing }).verdict, 'stop-budget-exhausted');
});
