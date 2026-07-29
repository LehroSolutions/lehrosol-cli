import { spawnWorktree, listWorktrees, removeWorktree } from '../orchestrator/worktree.js';
import { ui } from '../core/ui.js';

export function runOrchestrateCommand(subcommand, flags, logger) {
  if (subcommand === 'spawn') {
    const count = flags.count ? Number(flags.count) : 1;
    const taskPrefix = flags.taskPrefix || 'lehro-worker';

    ui.sectionHeader('Orchestrate — Spawn');
    ui.table(
      ['Parameter', 'Value'],
      [
        ['Worker Count', String(count)],
        ['Task Prefix', ui.highlight(taskPrefix)],
        ['Base Branch', flags.baseBranch || '(auto-detect)'],
      ]
    );

    const spinner = ui.createSpinner(`Spawning ${count} worker(s)...`);
    spinner.start();

    const result = spawnWorktree({
      count: count,
      baseBranch: flags.baseBranch || undefined,
      taskPrefix: taskPrefix
    });

    spinner.stop();

    if (flags.json) return logger.json(result);

    const rows = result.created.map((worker) => {
      const status = worker.error ? 'FAILED' : ui.highlight('SPAWNED');
      return [
        worker.name || '?',
        status,
        worker.error || (worker.branch + ' @ ' + (worker.dir || '').split('/').slice(-2).join('/')),
      ];
    });

    ui.table(['Worker', 'Status', 'Details'], rows);

    const spawned = result.created.filter((w) => !w.error).length;
    const failed = result.created.filter((w) => w.error).length;

    if (spawned > 0) ui.success(`${spawned} worker(s) spawned`, `Run a loop in each: lehrosol loop run --agentAdapter <id> --dryRun=false`);
    if (failed > 0) ui.warning(`${failed} worker(s) failed to spawn`, 'Check that the base branch exists and the worktree directory is accessible');

    ui.nextSteps([
      'List workers: lehrosol orchestrate list',
      'Remove a worker: lehrosol orchestrate remove --name <name>',
    ]);
    return;
  }

  if (subcommand === 'list') {
    const result = listWorktrees();
    if (flags.json) return logger.json(result);

    ui.sectionHeader('Active Worktree Workers');

    if (result.worktrees.length === 0) {
      ui.info('No active workers', 'Spawn some: lehrosol orchestrate spawn --count 3');
      return;
    }

    const rows = result.worktrees.map((w) => [
      w.name,
      ui.filePath((w.dir || '').split('/').slice(-2).join('/')),
      w.branch || '-',
      w.status || 'active',
    ]);

    ui.table(['Name', 'Directory', 'Branch', 'Status'], rows);

    ui.nextSteps([
      'Remove a worker: lehrosol orchestrate remove --name <name>',
      'Spawn more: lehrosol orchestrate spawn --count <n>',
    ]);
    return;
  }

  if (subcommand === 'remove') {
    if (!flags.name) {
      ui.error('lehrosol orchestrate remove requires --name', 'Example: lehrosol orchestrate remove --name lehro-worker-1');
      process.exitCode = 1;
      return;
    }

    ui.sectionHeader('Orchestrate — Remove');
    ui.keyValue('Worker', flags.name);

    const spinner = ui.createSpinner(`Removing worker ${flags.name}...`);
    spinner.start();
    const result = removeWorktree(flags.name);
    spinner.stop();

    if (flags.json) return logger.json(result);

    if (result.removed) {
      ui.success(`Removed worker: ${flags.name}`, 'git worktree cleaned up');
    } else {
      ui.error(`Could not remove: ${flags.name}`, result.reason || 'Unknown error');
    }

    ui.nextSteps([
      'List remaining workers: lehrosol orchestrate list',
    ]);
    return;
  }

  ui.error('Unknown orchestrate subcommand: ' + subcommand, 'Try: spawn | list | remove');
  process.exitCode = 1;
}
