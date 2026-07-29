import { AUTONOMY_LEVELS, listMissions, loadMission, planMission, runMission } from '../agentic/mission.js';
import { ui } from '../core/ui.js';

function phaseGlyph(status) {
  if (status === 'done') return ui.highlight('● done');
  if (status === 'failed') return '✕ failed';
  if (status === 'blocked') return '○ blocked';
  return status;
}

export async function runMissionCommand(subcommand, flags, logger = console) {
  const cmd = subcommand || 'run';

  if (cmd === 'list') {
    const result = { missions: listMissions({ limit: flags.limit || 30 }).map((m) => ({ id: m.id, goal: m.goal, status: m.status, autonomy: m.autonomy, adapter: m.adapter, dryRun: m.dryRun, updatedAt: m.updatedAt })) };
    if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));
    ui.sectionHeader('Missions');
    if (!result.missions.length) ui.info('No missions yet', 'Try: lehrosol mission run --goal "improve test coverage"');
    else ui.table(['Mission', 'Status', 'Autonomy', 'Adapter', 'Goal'], result.missions.map((m) => [m.id.slice(0, 18), m.status, m.autonomy, m.adapter || '-', String(m.goal || '').slice(0, 44)]));
    return result;
  }

  if (cmd === 'status' || cmd === 'show') {
    const mission = loadMission(flags.id);
    if (!mission) { ui.error('Mission not found', 'Pass --id from `lehrosol mission list`.'); process.exitCode = 1; return null; }
    if (flags.json) return logger.json ? logger.json(mission) : console.log(JSON.stringify(mission, null, 2));
    ui.sectionHeader(`Mission — ${mission.id}`);
    ui.keyValue('Goal', String(mission.goal || '').slice(0, 90));
    ui.keyValue('Status', mission.status);
    ui.keyValue('Autonomy', mission.autonomy);
    ui.keyValue('Adapter', `${mission.adapter}${mission.dryRun ? ' (dry-run)' : ' (live)'}`);
    if (mission.phases) ui.table(['Phase', 'Status', 'Verdict', 'Iterations', 'Session'], mission.phases.map((p) => [p.phase, phaseGlyph(p.status), String(p.verdict || '-'), String(p.iterations || 0), p.sessionId ? p.sessionId.slice(0, 10) : '-']));
    if (mission.recoveries?.length) ui.list(mission.recoveries.map((r) => `${r.phase}: ${r.strategy}`), 'Recovery actions');
    ui.keyValue('Events', String((mission.events || []).length));
    return mission;
  }

  if (cmd === 'plan') {
    if (!flags.goal) { ui.error('mission plan requires --goal', 'Example: lehrosol mission plan --goal "add rate limiting"'); process.exitCode = 1; return null; }
    const plan = planMission(flags.goal, { harden: flags.harden, document: flags.document });
    if (flags.json) return logger.json ? logger.json(plan) : console.log(JSON.stringify(plan, null, 2));
    ui.sectionHeader('Mission Plan');
    ui.keyValue('Mission', plan.id);
    ui.keyValue('Goal', plan.goal);
    ui.table(['Phase', 'Depends on', 'Objective'], plan.tasks.map((t) => [t.id, (t.dependsOn || []).join(', ') || '-', t.prompt.split('\n\n')[1]?.slice(0, 70) || '']));
    ui.nextSteps([`Dry-run it: lehrosol mission run --goal "${plan.goal.slice(0, 40)}"`, 'Go live: add --dryRun=false --autonomy guarded --adapter <id>']);
    return plan;
  }

  if (cmd === 'run') {
    if (!flags.goal) { ui.error('mission run requires --goal', 'Example: lehrosol mission run --goal "add input validation to the API"'); process.exitCode = 1; return null; }
    const quiet = Boolean(flags.json);
    if (!quiet) {
      ui.sectionHeader('Agentic Mission');
      ui.keyValue('Goal', String(flags.goal).slice(0, 90));
      ui.keyValue('Autonomy', String(flags.autonomy || 'guarded'));
      ui.keyValue('Mode', flags.dryRun === false ? 'LIVE' : 'dry-run rehearsal');
    }
    const report = await runMission(flags.goal, {
      autonomy: flags.autonomy,
      dryRun: flags.dryRun,
      adapter: flags.adapter || flags.agentAdapter,
      maxIterations: flags.maxIterations,
      harden: flags.harden,
      document: flags.document,
      owaspScope: flags.owaspScope ? String(flags.owaspScope).split(',') : undefined,
      capabilityTier: flags.capabilityTier,
      onEvent: quiet ? undefined : (event) => {
        if (event.type === 'task-started') console.log(ui.dim ? ui.dim(`  ▸ phase ${event.taskId} started`) : `  ▸ phase ${event.taskId} started`);
        if (event.type === 'task-done') console.log(`  ✓ phase ${event.taskId} passed the harness gate`);
        if (event.type === 'task-failed') console.log(`  ✕ phase ${event.taskId} failed: ${event.error}`);
        if (event.type === 'mission-recovery') console.log(`  ↻ recovery on ${event.phase}: ${event.strategy}`);
      },
    });
    if (flags.json) return logger.json ? logger.json(report) : console.log(JSON.stringify(report, null, 2));
    ui.sectionHeader('Mission Report');
    ui.keyValue('Mission', report.id);
    ui.keyValue('Status', report.status === 'succeeded' ? ui.highlight('SUCCEEDED') : 'FAILED');
    ui.table(['Phase', 'Status', 'Verdict', 'Iterations'], report.phases.map((p) => [p.phase, phaseGlyph(p.status), String(p.verdict || '-'), String(p.iterations)]));
    if (report.recoveries.length) ui.list(report.recoveries.map((r) => `${r.phase}: ${r.strategy}`), 'Recovery actions');
    ui.nextSteps([
      `Inspect: lehrosol mission status --id ${report.id}`,
      'Review sessions: lehrosol sessions list',
      report.dryRun ? 'Run live: add --dryRun=false --adapter <id> (see lehrosol models list)' : 'Learn from it: lehrosol learn report',
    ]);
    if (report.status !== 'succeeded') process.exitCode = 1;
    return report;
  }

  ui.error('Unknown mission subcommand: ' + cmd, `Try: run | plan | list | status  (autonomy: ${AUTONOMY_LEVELS.join(' | ')})`);
  process.exitCode = 1;
  return null;
}
