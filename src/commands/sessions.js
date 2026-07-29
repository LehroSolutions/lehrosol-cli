import { listSessions, getSession, backend } from '../core/sessionStore.js';
import { ui } from '../core/ui.js';

export function runSessionsCommand(subcommand, flags, logger) {
  if (subcommand === 'list') {
    const result = { backend: backend(), sessions: listSessions({ limit: flags.limit ? Number(flags.limit) : 20 }) };
    if (flags.json) return logger.json(result);

    ui.sectionHeader('Loop Sessions');
    ui.keyValue('Backend', result.backend);

    if (result.sessions.length === 0) {
      ui.info('No sessions recorded yet', 'Run: lehrosol loop run --prompt "..."');
      return;
    }

    const rows = result.sessions.map((s) => {
      const promptPreview = (s.prompt || '').slice(0, 50);
      const status = s.finalVerdict === 'stop-success' ? ui.highlight('PASS') : s.finalVerdict ? s.finalVerdict : '...';
      return [s.id.slice(0, 12) + '...', s.adapter || 'local', status, promptPreview];
    });

    ui.table(['Session ID', 'Adapter', 'Verdict', 'Prompt'], rows);

    ui.nextSteps([
      'Inspect a session: lehrosol sessions show --id <session-id>',
      'Start a new run: lehrosol loop run --prompt "..."',
    ]);
    return;
  }

  if (subcommand === 'show') {
    if (!flags.id) {
      ui.error('lehrosol sessions show requires --id', 'Example: lehrosol sessions show --id <session-id>');
      process.exitCode = 1;
      return;
    }
    const session = getSession(flags.id);
    if (!session) {
      ui.error('No session found with id ' + flags.id);
      process.exitCode = 1;
      return;
    }
    if (flags.json) return logger.json(session);

    const summary = session.result || {};

    ui.sectionHeader('Session Detail');
    ui.keyValue('Session ID', session.id);
    ui.keyValue('Adapter', session.adapter || summary.adapter || 'local');
    ui.keyValue('Mode', summary.dryRun || session.dryRun ? 'dry run' : 'live');
    ui.keyValue('Verdict', session.finalVerdict || summary.finalVerdict || 'in-progress');
    ui.keyValue('Iterations', String(session.totalIterations || (session.checkpoints || []).length));
    ui.keyValue('Prompt', (session.prompt || summary.prompt || '').slice(0, 80));

    const checkpoints = session.checkpoints || [];
    if (checkpoints.length > 0) {
      ui.sectionHeader('Iteration Checkpoints');

      const rows = checkpoints.map((cp) => {
        const record = cp.data || cp;
        const score = record.score || {};
        const passed = score.passed ? ui.highlight('PASS') : 'FAIL';
        return [
          '#' + (cp.iteration || record.iteration || '?'),
          String(score.score ?? '-') + '/' + String(score.bar ?? '-'),
          passed,
          score.verdict || '-',
          (cp.createdAt || '').split('T')[1] ? (cp.createdAt.split('T')[1].split('.')[0]) : '',
        ];
      });

      ui.table(['Iter', 'Score', 'Result', 'Verdict', 'Time'], rows);
    }

    ui.nextSteps([
      'See what changed: lehrosol diff --id ' + session.id,
      'List all sessions: lehrosol sessions list',
      'Start a new run: lehrosol loop run --prompt "..."',
    ]);
    return;
  }

  ui.error('Unknown sessions subcommand: ' + subcommand, 'Try: sessions list | sessions show --id <id>');
  process.exitCode = 1;
}
