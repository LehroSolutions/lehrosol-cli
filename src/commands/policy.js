import { evaluatePolicy } from '../harness/policy.js';
import { scanOwaspBasics } from '../harness/owasp.js';
import { ui } from '../core/ui.js';

export function runPolicyCommand(subcommand, flags, logger) {
  if (subcommand !== 'evaluate') {
    ui.error('Unknown policy subcommand: ' + subcommand, 'Try: lehrosol policy evaluate --branch feature/x --hasTests --reviewCount 1');
    process.exitCode = 1;
    return;
  }

  ui.sectionHeader('Policy Evaluation');

  const owaspScope = flags.owaspScope ? String(flags.owaspScope).split(',') : [];
  const changedFiles = flags.files ? String(flags.files).split(',') : [];

  // Show what we're evaluating
  ui.table(
    ['Parameter', 'Value'],
    [
      ['Branch', ui.filePath(flags.branch || 'unknown')],
      ['Has Tests', flags.hasTests ? 'YES' : 'NO'],
      ['Review Count', String(flags.reviewCount ? Number(flags.reviewCount) : 0)],
      ['OWASP Scope', ui.highlight(owaspScope.join(', ') || '(none)')],
      ['Files Scanned', String(changedFiles.length)],
    ]
  );

  const spinner = ui.createSpinner('Evaluating policy + running OWASP scanner...');
  spinner.start();

  const owaspFindings = changedFiles.length > 0 ? scanOwaspBasics({ cwd: process.cwd(), files: changedFiles, owaspScope: owaspScope }) : [];

  const result = evaluatePolicy({
    branch: flags.branch || 'unknown',
    hasTests: Boolean(flags.hasTests),
    secretScanPassed: flags.secretScanPassed !== false,
    reviewCount: flags.reviewCount ? Number(flags.reviewCount) : 0,
    owaspScope: owaspScope,
    owaspFindings: owaspFindings
  });

  spinner.stop();

  if (flags.json) return logger.json(result);

  // Score visualization
  ui.divider();

  const scoreBar = ui.progressBar(result.score, 100, 30);
  const bandLabel = result.band === 'green' ? ui.highlight(result.band.toUpperCase()) :
                   result.band === 'amber' ? result.band.toUpperCase() :
                   result.band.toUpperCase();
  const verdictLabel = result.passed ? ui.highlight('PASSED') : 'BLOCKED';

  console.log(`  Score:  ${scoreBar}  ${result.score}/100  ${bandLabel}  ${verdictLabel}`);

  // Violations
  if (result.violations && result.violations.length > 0) {
    ui.sectionHeader('Violations');
    result.violations.forEach((v, i) => {
      console.log(`  ${ui.filePath(String(i + 1) + '.')} ${v.name}`);
      if (v.fixSuggestion) console.log(ui.filePath('     fix: ') + v.fixSuggestion);
      if (v.file) console.log(ui.filePath('     file: ') + v.file);
    });
  }

  // Warnings
  if (result.warnings && result.warnings.length > 0) {
    ui.sectionHeader('Warnings');
    result.warnings.forEach((w, i) => {
      console.log(`  ${ui.filePath(String(i + 1) + '.')} ${w.name}`);
      if (w.fixSuggestion) console.log(ui.filePath('     fix: ') + w.fixSuggestion);
      if (w.file) console.log(ui.filePath('     file: ') + w.file);
    });
  }

  if (result.passed) {
    ui.success('Policy check passed', `Score ${result.score}/100 (${result.band} band)`);
  } else {
    ui.error('Policy check blocked', `${result.violations.length} violation(s), score ${result.score}/100`);
    ui.nextSteps([
      'Fix the violations listed above',
      'Re-run: lehrosol policy evaluate --branch ... --hasTests --reviewCount 1',
    ]);
  }
}
