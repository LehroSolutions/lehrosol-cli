import { listAdapters } from '../loop/adapters/index.js';
import { ui } from '../core/ui.js';

export function runAdaptersCommand(flags, logger) {
  const result = { adapters: listAdapters() };
  if (flags.json) return logger.json(result);

  ui.sectionHeader('Agent Adapters');
  ui.info('Use with:', 'lehrosol loop run --agentAdapter <id> --dryRun=false');

  const rows = result.adapters.map((a) => {
    const status = a.installed ? ui.highlight('INSTALLED') : 'NOT FOUND';
    return [
      ui.highlight(a.id),
      a.label,
      a.kind === 'http' ? (a.baseUrl || '(endpoint)') : (a.bin || '(none)'),
      status,
    ];
  });

  ui.table(['ID', 'Label', 'Target', 'Status'], rows);

  const installed = result.adapters.filter((a) => a.installed);
  const missing = result.adapters.filter((a) => !a.installed);

  if (installed.length === 0) {
    ui.warning(
      'No agent CLIs found on PATH',
      'The local adapter always works for a dry run. Install Claude Code, Codex CLI, or others to use real adapters.'
    );
  } else {
    ui.success(
      `${installed.length}/${result.adapters.length} adapter(s) installed`,
      installed.map((a) => a.id).join(', ')
    );
  }

  if (missing.length > 0) {
    ui.info('Not ready', missing.map((a) => `${a.id}${a.install ? ` → ${a.install}` : ''}`).join(' | '));
  }
}
