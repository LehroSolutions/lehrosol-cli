// The Score Agent grades one loop iteration's output against harness policy plus a capability-tier pass bar, deciding whether the Loop Engine should stop, keep iterating, or escalate. Generalized from devTechish's adapter-aware Score Agent concept.
import { evaluatePolicy, passBarFor } from '../harness/policy.js';

export function scoreIteration(iterationInput) {
  const input = iterationInput || {};
  const policyResult = evaluatePolicy(input.policyInput || {});
  const bar = passBarFor(input.capabilityTier);
  const passed = policyResult.passed && policyResult.score >= bar;
  return {
    iteration: input.iteration || 0,
    score: policyResult.score,
    bar: bar,
    passed: passed,
    violations: policyResult.violations,
    warnings: policyResult.warnings,
    verdict: passed ? 'stop-success' : (input.iteration >= (input.maxIterations || 12) ? 'stop-budget-exhausted' : 'continue')
  };
}
