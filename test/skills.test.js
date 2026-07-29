import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SKILLS,
  buildSkillGuidance,
  normalizeReasoningLevel,
  parseSkillRequest,
  resolveSkillIds,
} from '../src/core/skills.js';

test('built-in skill library exposes grounded engineering skills', () => {
  const ids = BUILTIN_SKILLS.map((skill) => skill.id);
  for (const id of ['workspace-first', 'intent-and-scope', 'safe-change', 'evidence-check', 'clear-outcome', 'efficient-context']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test('skill guidance keeps a supported reasoning level and selected skills', () => {
  const guidance = buildSkillGuidance({ reasoning: 'deep', skills: 'workspace-first,safe-change' });
  assert.equal(guidance.reasoning, 'deep');
  assert.deepEqual(guidance.skillIds, ['workspace-first', 'safe-change']);
  assert.match(guidance.text, /Investigate dependencies and edge cases/);
  assert.match(guidance.text, /Workspace First/);
  assert.match(guidance.text, /Safe Change/);
  assert.equal(normalizeReasoningLevel('unknown'), 'standard');
  assert.deepEqual(resolveSkillIds('unknown,safe-change'), ['safe-change']);
});

test('task skill prefix is removed and converted to an active skill', () => {
  const parsed = parseSkillRequest('use skill: evidence-check — add a focused regression test');
  assert.equal(parsed.task, 'add a focused regression test');
  assert.deepEqual(parsed.requested, ['evidence-check']);
});
