import { runLoop } from '../loop/loop.js';
import { ui } from '../core/ui.js';
import { getMode, getPreferredMode } from '../core/modes.js';
import { projectIdentity, touchProject } from '../core/projects.js';
import { fieldNotesFor } from '../core/engrams.js';
import { listSessions } from '../core/sessionStore.js';
import { buildSkillGuidance, inferSkillIds, mergeSkillIds } from '../core/skills.js';
import { normalizeResourceProfile } from '../core/resourcePlanner.js';

export async function runLoopCommand(subcommand, flags, logger) {
  if (subcommand !== 'run') {
    ui.error('Unknown loop subcommand: ' + subcommand, 'Try: lehrosol loop run --prompt "..."');
    process.exitCode = 1;
    return;
  }
  if (!flags.prompt) {
    ui.error('lehrosol loop run requires --prompt', 'Example: lehrosol loop run --prompt "harden the auth endpoint"');
    process.exitCode = 1;
    return;
  }

  // HELIX mode: --mode wins for this run; otherwise the persisted preference.
  let mode = null;
  if (flags.mode) {
    mode = getMode(flags.mode);
    if (!mode) {
      ui.error('Unknown mode: ' + flags.mode, 'See the ring: lehrosol modes list');
      process.exitCode = 1;
      return;
    }
  } else {
    mode = getPreferredMode();
  }
  // Engram feedback loop: lessons distilled from past runs in this exact
  // project ride along as field notes, so the agent inherits experience.
  const fieldNotes = fieldNotesFor(process.cwd(), 3);
  const notesBlock = fieldNotes.length
    ? '\n\n# FIELD NOTES (lessons distilled from previous runs in this project)\n' + fieldNotes.map((n) => '- ' + n).join('\n')
    : '';
  const activeSkills = mergeSkillIds(inferSkillIds(flags.prompt, { surface: 'loop' }), flags.skills || flags.skill);
  const skillSet = buildSkillGuidance({ reasoning: flags.reasoning || 'standard', skills: activeSkills });
  const resourceProfile = normalizeResourceProfile(flags.resourceProfile || flags.ramProfile);
  const effectivePrompt = (mode ? mode.preamble + '\n\n# USER GOAL\n' + flags.prompt : flags.prompt)
    + '\n\n' + skillSet.text + notesBlock;

  // Resource profiles tune memory and token use; they must not silently cut
  // the amount of work the user asked the loop to perform.
  const maxIterations = flags.maxIterations ? Number(flags.maxIterations) : 12;

  const project = projectIdentity(process.cwd());

  ui.sectionHeader('Loop Engine');

  // Show the run configuration
  ui.table(
    ['Parameter', 'Value'],
    [
      ['Prompt', (flags.prompt || '').slice(0, 60) + ((flags.prompt || '').length > 60 ? '...' : '')],
      ['Project', `${project.sigil} ${project.codename} [${project.tag}]`],
      ['Mode', mode ? `${mode.glyph} ${mode.label} (${mode.id})` : '(raw prompt)'],
      ['Field Notes', fieldNotes.length ? `${fieldNotes.length} lesson(s) injected from engram memory` : '(none yet — memory builds as you run)'],
      ['Adapter', ui.highlight(flags.agentAdapter || 'local')],
      ['Max Iterations', String(maxIterations)],
      ['Dry Run', flags.dryRun !== false ? 'yes (no real agent calls)' : 'no (real agent calls)'],
      ['OWASP Scope', (flags.owaspScope || '(none)')],
      ['Capability Tier', ui.highlight(flags.capabilityTier || 'standard')],
      ['Reasoning', skillSet.reasoning],
      ['Skills', skillSet.skillIds.join(', ')],
      ['Resource Profile', resourceProfile],
    ]
  );

  const spinner = ui.createSpinner('Running Loop Engine...');
  spinner.start();

  let result;
  try {
    result = await runLoop({
      prompt: effectivePrompt,
      maxIterations: maxIterations,
      dryRun: flags.dryRun !== false,
      agentAdapter: flags.agentAdapter || 'local',
      owaspScope: flags.owaspScope ? String(flags.owaspScope).split(',') : [],
      capabilityTier: flags.capabilityTier || 'standard',
      timeoutMs: flags.timeoutMs ? Number(flags.timeoutMs) : undefined,
      temperature: mode && mode.temperature != null ? mode.temperature : undefined,
      skills: skillSet.skillIds,
      reasoning: skillSet.reasoning,
      resourceProfile,
      toolSteps: flags.toolSteps ? Number(flags.toolSteps) : undefined,
      cwd: process.cwd()
    });
    spinner.stop();
    touchProject(process.cwd(), {
      mode: mode ? mode.id : null,
      adapter: flags.agentAdapter || 'local',
      verdict: result.finalVerdict || null,
      sessionId: result.sessionId || null,
    });
    const onDisk = listSessions({ limit: 60 });
    if (onDisk.length >= 40) {
      console.log();
      console.log('  ' + ui.highlight('Memory pressure:') + ` ${onDisk.length}+ full sessions on disk — distill the old ones into lessons: lehrosol compact --apply`);
    }
  } catch (e) {
    spinner.stop();
    ui.error('Loop Engine failed', e.message);
    process.exitCode = 1;
    return;
  }

  if (flags.json) {
    logger.json(result);
    return result;
  }

  // Final summary
  ui.divider();

  if (result.finalVerdict === 'stop-success') {
    ui.success(
      `Loop passed after ${result.totalIterations} iteration(s)`,
      `Final score cleared the ${result.adapter} pass bar`
    );
  } else {
    ui.warning(
      `Loop stopped: ${result.finalVerdict}`,
      `${result.totalIterations} iteration(s) completed`
    );
  }

  if (result.dryRun) {
    ui.info('Dry run mode', 'Pass --dryRun=false to actually invoke the ' + result.adapter + ' adapter');
  }

  // Iteration breakdown
  ui.sectionHeader('Iteration Breakdown');

  for (const it of result.iterations) {
    const score = it.score || {};
    const scoreVal = score.score !== undefined ? score.score : '-';
    const barVal = score.bar !== undefined ? score.bar : '-';
    const passed = score.passed ? 'PASS' : 'FAIL';
    const scoreLine = `  [${it.iteration}/${maxIterations}] ${ui.progressBar(scoreVal, 100, 20)}  bar=${barVal}  ${passed}  ${score.verdict || '-'}`;
    console.log(scoreLine);

    if (it.result && it.result.available === false) {
      console.log('    └ ' + (it.result.summary || ''));
    }

    if (score.violations && score.violations.length > 0) {
      for (const v of score.violations) {
        console.log('    └ ' + v.name + ': ' + (v.fixSuggestion || ''));
      }
    }

    if (score.warnings && score.warnings.length > 0) {
      for (const w of score.warnings) {
        console.log('    └ ' + w.name + ': ' + (w.fixSuggestion || ''));
      }
    }
  }

  ui.divider();
  ui.keyValue('Session ID', result.sessionId);
  ui.keyValue('Adapter', result.adapter);
  ui.keyValue('Iterations', result.totalIterations + '/' + maxIterations);
  ui.keyValue('Final Verdict', result.finalVerdict);

  ui.nextSteps([
    `Inspect the run: lehrosol sessions show --id ${result.sessionId}`,
    'List all runs: lehrosol sessions list',
    result.dryRun ? 'Run for real: add --dryRun=false' : 'Open in GUI: lehrosol gui',
  ]);

  return result;
}
