// Harness engineering: verification-gate policy rules, generalized from devTechish's src/agent/policy-engine.js, extended with an OWASP scope and real OWASP scanner findings.

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

export const POLICY_RULES = {
  'tests-required': {
    id: 'tests-required',
    name: 'Test Coverage Required',
    severity: 'error',
    category: 'quality',
    autoFixable: false,
    fixSuggestion: 'Add unit tests for the changed functionality.'
  },
  'secret-scan-failed': {
    id: 'secret-scan-failed',
    name: 'Secret Scanning',
    severity: 'error',
    category: 'security',
    autoFixable: true,
    fixSuggestion: 'Remove secrets; use environment variables or a secrets manager.'
  },
  'review-required': {
    id: 'review-required',
    name: 'Code Review Required',
    severity: 'error',
    category: 'process',
    autoFixable: false,
    fixSuggestion: 'Request at least one approval before merging.'
  },
  'direct-protected-branch-blocked': {
    id: 'direct-protected-branch-blocked',
    name: 'Branch Protection',
    severity: 'error',
    category: 'process',
    autoFixable: true,
    fixSuggestion: 'Create a feature branch instead of pushing directly to a protected branch.'
  },
  // Back-compat alias for existing callers/docs that referenced the original id.
  'direct-main-merge-blocked': {
    id: 'direct-main-merge-blocked',
    name: 'Branch Protection',
    severity: 'error',
    category: 'process',
    autoFixable: true,
    fixSuggestion: 'Create a feature branch instead of pushing directly to a protected branch.'
  },
  'owasp-scope-unset': {
    id: 'owasp-scope-unset',
    name: 'OWASP Scope Not Declared',
    severity: 'warning',
    category: 'security',
    autoFixable: true,
    fixSuggestion: 'Declare an owaspScope (for example ["llm", "asvs"]) so the Score Agent can grade against the right OWASP rule set.'
  }
};

function violation(rule, extra) {
  return Object.assign({ rule: rule.id, name: rule.name, severity: rule.severity, category: rule.category, autoFixable: rule.autoFixable, fixSuggestion: rule.fixSuggestion }, extra || {});
}

function scoreFrom(violations, warnings) {
  const errorPenalty = violations.length * 20;
  const warnPenalty = warnings.length * 5;
  return Math.max(0, 100 - errorPenalty - warnPenalty);
}

function protectedBranchesFrom(data) {
  if (Array.isArray(data.protectedBranches) && data.protectedBranches.length > 0) {
    return data.protectedBranches.map(String);
  }
  return DEFAULT_PROTECTED_BRANCHES;
}

export function evaluatePolicy(input) {
  const data = input || {};
  const violations = [];
  const warnings = [];
  const branch = String(data.branch || 'unknown');
  const protectedBranches = protectedBranchesFrom(data);

  if (!data.hasTests) violations.push(violation(POLICY_RULES['tests-required']));
  if (data.secretScanPassed === false) violations.push(violation(POLICY_RULES['secret-scan-failed']));
  if ((data.reviewCount || 0) < 1) violations.push(violation(POLICY_RULES['review-required']));
  if (protectedBranches.includes(branch)) {
    violations.push(violation(POLICY_RULES['direct-protected-branch-blocked'], { branch, protectedBranches }));
  }
  if (!data.owaspScope || data.owaspScope.length === 0) warnings.push(violation(POLICY_RULES['owasp-scope-unset']));

  for (const finding of (data.owaspFindings || [])) {
    const entry = {
      rule: 'owasp:' + finding.check,
      name: 'OWASP: ' + finding.check,
      severity: finding.severity || 'error',
      category: 'security',
      autoFixable: !!finding.autoFixable,
      fixSuggestion: finding.note || 'Review and remediate this OWASP finding before merging.',
      file: finding.file
    };
    if (entry.severity === 'warning') warnings.push(entry); else violations.push(entry);
  }

  const score = scoreFrom(violations, warnings);
  return {
    passed: violations.length === 0,
    violations: violations,
    warnings: warnings,
    score: score,
    band: score >= 90 ? 'green' : (score >= 70 ? 'amber' : 'red'),
    protectedBranches,
    evaluatedAt: new Date().toISOString()
  };
}

export const CAPABILITY_TIER_PASS_BAR = {
  frontier: 90,
  standard: 80,
  small: 65,
  local: 55
};

export function passBarFor(tier) {
  return CAPABILITY_TIER_PASS_BAR[tier || 'standard'] || CAPABILITY_TIER_PASS_BAR.standard;
}
