import { spawnWorktree, listWorktrees } from '../orchestrator/worktree.js';
import { runLoop } from '../loop/loop.js';
import { listSessions } from '../core/sessionStore.js';
import { ui } from '../core/ui.js';

export async function runThreadsCommand(subcommand, flags, logger = console) {
  const cmd = subcommand || 'list';

  if (cmd === 'list') {
    const result = { threads: listSessions({ limit: Number(flags.limit || 30) }), worktrees: listWorktrees().worktrees || [] };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader('CMUX Threads');
    if (!result.threads.length) ui.info('No loop threads yet', 'Run: lehrosol threads run --prompt "..." --count 3');
    else ui.table(['Thread', 'Adapter', 'Verdict', 'Prompt'], result.threads.map((s) => [
      ui.highlight(String(s.id).slice(0, 10)), s.adapter || '-', s.finalVerdict || 'running/unknown', String(s.prompt || '').slice(0, 54),
    ]));
    if (result.worktrees.length) {
      ui.sectionHeader('Worktree Workers');
      ui.table(['Worker', 'Branch', 'Status', 'Dir'], result.worktrees.map((w) => [w.name, w.branch || '-', w.status || 'idle', w.dir || '-']));
    }
    return result;
  }

  if (cmd === 'run') {
    if (!flags.prompt) { ui.error('threads run requires --prompt', 'Example: lehrosol threads run --prompt "build auth tests" --count 3 --agentAdapter opencode'); process.exitCode = 1; return; }
    const count = Math.max(1, Math.min(Number(flags.count || 2), 12));
    const adapter = flags.agentAdapter || flags.adapter || 'local';
    const useWorktrees = flags.worktrees !== false;
    const maxIterations = Math.max(1, Math.min(Number(flags.maxIterations || 3), 20));
    const dryRun = flags.dryRun !== false;

    ui.sectionHeader('CMUX Thread Run');
    ui.table(['Parameter', 'Value'], [
      ['Threads', String(count)], ['Adapter', ui.highlight(adapter)], ['Dry Run', dryRun ? 'yes' : 'no'], ['Worktrees', useWorktrees ? 'yes' : 'no'], ['Prompt', String(flags.prompt).slice(0, 70)],
    ]);

    let workers = [];
    if (useWorktrees) {
      const spawned = spawnWorktree({ count, taskPrefix: flags.taskPrefix || 'lehro-thread', baseBranch: flags.baseBranch });
      workers = spawned.created || [];
      const failed = workers.filter((w) => w.error);
      if (failed.length) ui.warning(`${failed.length} worktree worker(s) failed`, failed.map((w) => w.error).join(' | ').slice(0, 200));
    }

    const jobs = Array.from({ length: count }, (_, i) => {
      const worker = workers[i] && !workers[i].error ? workers[i] : null;
      const prompt = `${flags.prompt}\n\nThread ${i + 1}/${count}: pursue an independent implementation path. Keep changes focused and summarize tradeoffs.`;
      return runLoop({
        prompt,
        maxIterations,
        dryRun,
        agentAdapter: adapter,
        owaspScope: flags.owaspScope ? String(flags.owaspScope).split(',') : [],
        capabilityTier: flags.capabilityTier || 'standard',
        cwd: worker ? worker.dir : process.cwd(),
        branch: worker ? worker.branch : flags.branch,
      }).then((result) => ({ thread: i + 1, worker, result })).catch((err) => ({ thread: i + 1, worker, error: String((err && err.message) || err) }));
    });

    const results = await Promise.all(jobs);
    const output = { count, adapter, dryRun, results };
    if (flags.json) return logger.json ? logger.json(output) : console.log(JSON.stringify(output, null, 2));

    ui.sectionHeader('Thread Results');
    ui.table(['#', 'Worker', 'Verdict', 'Session'], results.map((r) => [
      String(r.thread), r.worker ? r.worker.name : '(current)', r.error ? 'ERROR' : r.result.finalVerdict, r.error ? r.error.slice(0, 30) : r.result.sessionId.slice(0, 10),
    ]));
    ui.nextSteps(['Compare sessions: lehrosol sessions list', 'Inspect workers: lehrosol orchestrate list', 'Open cockpit: lehrosol tui --mode advanced']);
    return output;
  }

  ui.error('Unknown threads subcommand: ' + cmd, 'Try: list | run');
  process.exitCode = 1;
}
