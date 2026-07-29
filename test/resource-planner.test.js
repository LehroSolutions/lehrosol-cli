import test from 'node:test';
import assert from 'node:assert/strict';
import { inferSkillIds } from '../src/core/skills.js';
import { normalizeResourceProfile, planResources } from '../src/core/resourcePlanner.js';

test('loop-like prompts automatically activate loop discipline', () => {
  const skills = inferSkillIds('Build an autonomous loop that verifies each iteration', { surface: 'code' });
  assert.ok(skills.includes('loop-discipline'));
  assert.ok(skills.includes('mode-alignment'));
});

test('optimization prompts automatically activate resource awareness', () => {
  const skills = inferSkillIds('Optimize RAM and GPU performance for this workflow');
  assert.ok(skills.includes('resource-aware'));
});

test('resource planner reserves system headroom and scales context', () => {
  const hw = { totalMemGB: 16, freeMemGB: 6, recommendedThreads: 4, gpu: { integrated: true } };
  const fit = { requiredGB: 5, budgetGB: 11, accelerated: false };
  const eco = planResources(hw, fit, 'eco');
  const balanced = planResources(hw, fit, 'balanced');
  assert.equal(normalizeResourceProfile('bad-profile'), 'balanced');
  assert.equal(eco.profile, 'eco');
  assert.ok(eco.reserveGB >= balanced.reserveGB);
  assert.ok(eco.ctxSize <= balanced.ctxSize);
  assert.equal(eco.gpuLayers, 0);
  assert.equal(eco.constrained, true);
});
