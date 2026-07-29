// Ralph-style loop engineering: reads/writes the two files that anchor a self-improving loop, following ghuntley's Ralph Wiggum technique (AGENT.md = durable instructions, fix_plan.md = the running backlog of what still needs fixing).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function readAgentMd(cwd) {
  const workDir = cwd || process.cwd();
  const path = join(workDir, 'AGENTS.md');
  const altPath = join(workDir, 'AGENT.md');
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (existsSync(altPath)) return readFileSync(altPath, 'utf8');
  return '';
}

export function readFixPlan(cwd) {
  const workDir = cwd || process.cwd();
  const path = join(workDir, 'fix_plan.md');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return text
    .split('\n')
    .filter((line) => /^\s*-\s*\[( |x)\]/i.test(line))
    .map((line) => {
      const done = /\[x\]/i.test(line);
      const label = line.replace(/^\s*-\s*\[( |x)\]\s*/i, '').trim();
      return { label: label, done: done };
    });
}

export function appendFixPlanItem(label, cwd) {
  const workDir = cwd || process.cwd();
  const path = join(workDir, 'fix_plan.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '# fix_plan.md\n\nRunning backlog for the LehroSol Loop Engine. One item per line.\n\n';
  const updated = existing.replace(/\n?$/, '') + '\n- [ ] ' + label + '\n';
  writeFileSync(path, updated, 'utf8');
  return updated;
}
