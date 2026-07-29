// `lehrosol projects` — the Project Constellation.
// Every directory you've run the loop in, with its unique sigil + codename,
// run count, and the last mode/adapter/verdict. Identity is deterministic
// from the path, so a project keeps its name across sessions and reinstalls.
import { listProjects, projectIdentity } from '../core/projects.js';
import { ui } from '../core/ui.js';

function ago(iso) {
  if (!iso) return '-';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function runProjectsCommand(flags = {}, logger = console) {
  const projects = listProjects();
  const here = projectIdentity(process.cwd());

  if (flags.json) {
    logger.json({ current: here, projects });
    return;
  }

  ui.sectionHeader('Project Constellation');
  ui.keyValue('This directory', `${here.sigil} ${here.codename} [${here.tag}]`);

  if (!projects.length) {
    ui.info('No projects on the map yet', 'Run a loop anywhere and that directory earns its codename: lehrosol loop run --prompt "..."');
    return;
  }

  ui.table(
    ['Project', 'Runs', 'Last mode', 'Adapter', 'Verdict', 'Last run', 'Path'],
    projects.map((p) => [
      `${p.sigil} ${p.codename} [${p.tag}]${p.path === here.path ? ' \u25c0 here' : ''}`,
      String(p.runs || 0),
      p.lastMode || '-',
      p.lastAdapter || '-',
      p.lastVerdict === 'stop-success' ? ui.highlight('PASS') : (p.lastVerdict || '-'),
      ago(p.lastRun),
      p.path.length > 34 ? '\u2026' + p.path.slice(-33) : p.path,
    ]),
  );

  ui.nextSteps([
    'See what changed last: lehrosol diff',
    'Run here: lehrosol loop run --prompt "..." --dryRun=false',
  ]);
}
