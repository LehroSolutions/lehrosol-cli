import { runDoctor } from './doctorLogic.js';
import { ui } from '../core/ui.js';

export function registerDoctorOutput(logger, json) {
  const result = runDoctor({ cwd: process.cwd() });
  if (json) {
    logger.json(result);
    return result;
  }

  ui.sectionHeader('Project Doctor');

  // Build table rows with colored status
  const rows = result.checks.map((check) => {
    const status = check.ok ? ui.highlight('PASS') : 'FAIL';
    return [
      check.name,
      status,
      check.detail || '',
    ];
  });

  ui.table(['Check', 'Status', 'Details'], rows);

  // Summary line
  const passCount = result.checks.filter((c) => c.ok).length;
  const failCount = result.checks.length - passCount;

  if (result.ok) {
    ui.success('Project doctor passed', `${passCount}/${result.checks.length} checks passed. This command never modifies files.`);
  } else {
    ui.warning('Project doctor completed with issues', `${failCount} check(s) need attention (see above). This command never modifies files.`
    );
  }

  if (!result.ok) {
    ui.nextSteps([
      'Fix the failing checks above',
      'Run `lehrosol init` if AGENTS.md is missing',
      'Ensure git is initialized: git init',
    ]);
  }

  return result;
}
