// OWASP rule packs (OWASP Top 10 for LLM Applications 2025, OWASP Top 10 for
// Web, and a slice of the OWASP ASVS) plus a lightweight built-in scanner
// that flags real, file-level findings for a subset of these checks.
export const OWASP_SCOPES = {
  llm: {
    id: 'llm',
    label: 'OWASP Top 10 for LLM Applications (2025)',
    checks: [
      { id: 'prompt-injection-mitigation', label: 'Prompt Injection', detail: 'Untrusted input (files, web content, tool output) should never be treated as trusted instructions.' },
      { id: 'insecure-output-handling', label: 'Insecure Output Handling', detail: 'Agent/model output must be validated/escaped before being executed, rendered, or piped into a shell.' },
      { id: 'training-data-poisoning-na', label: 'Training Data Poisoning (N/A for most integrations)', detail: 'Only relevant if you fine-tune or ingest untrusted training data.' },
      { id: 'model-denial-of-service', label: 'Model Denial of Service', detail: 'Bound loop iterations, timeouts, and token/costs so a single run cannot exhaust resources.' },
      { id: 'sensitive-information-disclosure', label: 'Sensitive Information Disclosure', detail: 'No secrets, credentials, or private keys in code, logs, or agent output.', autoFixable: true },
      { id: 'insecure-plugin-design', label: 'Insecure Plugin/Tool Design', detail: 'Tools exposed to an agent should validate arguments and use least-privilege scopes.' },
      { id: 'excessive-agency', label: 'Excessive Agency', detail: 'Agents should not have broader filesystem/network/shell access than the task requires.' },
      { id: 'overreliance', label: 'Overreliance', detail: 'Require human review / tests before merging agent-authored changes.' }
    ]
  },
  web: {
    id: 'web',
    label: 'OWASP Top 10 (Web, 2021)',
    checks: [
      { id: 'broken-access-control', label: 'Broken Access Control', detail: 'Verify authorization checks on every new/changed route or handler.' },
      { id: 'cryptographic-failures', label: 'Cryptographic Failures', detail: 'No weak/home-grown crypto; use vetted libraries and secure defaults.' },
      { id: 'injection', label: 'Injection', detail: 'No string-built shell/SQL/HTML from untrusted input; use parameterized APIs.', autoFixable: false },
      { id: 'insecure-design', label: 'Insecure Design', detail: 'No eval()/dynamic code execution on data that can be influenced by a user or agent.' },
      { id: 'security-misconfiguration', label: 'Security Misconfiguration', detail: 'No debug flags, default credentials, or overly permissive CORS/file permissions left in place.' }
    ]
  },
  asvs: {
    id: 'asvs',
    label: 'OWASP Application Security Verification Standard (selected)',
    checks: [
      { id: 'authentication', label: 'Authentication', detail: 'Credentials are verified, rate-limited, and never logged.' },
      { id: 'session-management', label: 'Session Management', detail: 'Sessions/tokens expire, rotate, and are invalidated on logout.' },
      { id: 'access-control', label: 'Access Control', detail: 'Deny-by-default; every privileged action re-checks authorization server-side.' },
      { id: 'input-validation', label: 'Input Validation', detail: 'All external input is validated/sanitized at a trust boundary.' },
      { id: 'error-handling-logging', label: 'Error Handling & Logging', detail: 'Errors do not leak stack traces/secrets; security-relevant events are logged.' }
    ]
  }
};

export function checksForScope(scopeIds) {
  const ids = scopeIds || [];
  let result = [];
  for (const id of ids) {
    const scope = OWASP_SCOPES[id];
    if (scope) result = result.concat(scope.checks.map((c) => c.id));
  }
  return result;
}

export function checkDetail(checkId) {
  for (const scope of Object.values(OWASP_SCOPES)) {
    const found = scope.checks.find((c) => c.id === checkId);
    if (found) return found;
  }
  return null;
}

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

const SECRET_LIKE = /(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][^'"\n]{8,}['"]/i;
const DANGEROUS_EVAL = /\b(eval|new\s+Function)\s*\(/;
const SHELL_TEMPLATE_INJECTION = /\bexec(Sync)?\(\s*(`[^`]*\$\{|["'][^"'\n]*\+\s*\w)/;
const WILDCARD_CORS = /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/;
const MAX_SCAN_BYTES = 1024 * 1024;

function safeFilePath(cwd, relPath) {
  const root = resolve(cwd);
  const target = resolve(root, String(relPath));
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

export function scanOwaspBasics(input) {
  const opts = input || {};
  const cwd = opts.cwd || process.cwd();
  const files = opts.files || [];
  const inScope = new Set(checksForScope(opts.owaspScope));
  const findings = [];

  for (const relPath of files) {
    const fullPath = safeFilePath(cwd, relPath);
    if (!fullPath) {
      findings.push({ check: 'excessive-agency', severity: 'error', file: String(relPath), autoFixable: false, note: 'Refused to scan a path outside the project root: ' + relPath });
      continue;
    }
    if (!existsSync(fullPath)) continue;
    let stat;
    try {
      stat = statSync(fullPath);
      if (stat.isDirectory()) continue;
      if (stat.size > MAX_SCAN_BYTES) {
        findings.push({ check: 'model-denial-of-service', severity: 'warning', file: String(relPath), autoFixable: false, note: 'Skipped large file over 1 MiB during lightweight OWASP scan: ' + relPath });
        continue;
      }
    } catch {
      continue;
    }
    let text;
    try {
      text = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    if (SECRET_LIKE.test(text) && (inScope.size === 0 || inScope.has('sensitive-information-disclosure'))) {
      findings.push({ check: 'sensitive-information-disclosure', severity: 'error', file: relPath, autoFixable: true, note: 'Possible hardcoded secret/credential literal in ' + relPath + '; move it to an environment variable or secrets manager.' });
    }
    if (DANGEROUS_EVAL.test(text) && (inScope.size === 0 || inScope.has('insecure-design'))) {
      findings.push({ check: 'insecure-design', severity: 'error', file: relPath, autoFixable: false, note: 'eval()/new Function() found in ' + relPath + '; avoid dynamic code execution on untrusted input.' });
    }
    if (SHELL_TEMPLATE_INJECTION.test(text) && (inScope.size === 0 || inScope.has('injection'))) {
      findings.push({ check: 'injection', severity: 'error', file: relPath, autoFixable: false, note: 'Shell command built from a template literal / concatenation in ' + relPath + '; use execFile with an argument array instead of a shell string.' });
    }
    if (WILDCARD_CORS.test(text) && (inScope.size === 0 || inScope.has('security-misconfiguration'))) {
      findings.push({ check: 'security-misconfiguration', severity: 'warning', file: relPath, autoFixable: true, note: 'Wildcard CORS origin found in ' + relPath + '; scope Access-Control-Allow-Origin to known origins.' });
    }
  }

  return findings;
}
