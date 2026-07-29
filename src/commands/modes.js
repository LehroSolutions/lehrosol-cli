// `lehrosol modes` — list and flip HELIX operating modes.
// UX: `lehrosol modes plan` flips straight into Recon; `lehrosol modes list`
// shows the ring; `lehrosol modes current` prints the active mode.
import { MODES, getMode, getPreferredMode, setPreferredMode } from '../core/modes.js';
import { ui } from '../core/ui.js';

export function runModesCommand(subcommand, flags = {}, logger = console) {
  const cmd = subcommand || 'list';

  if (cmd === 'list') {
    const preferred = getPreferredMode();
    if (flags.json) {
      logger.json({ modes: MODES.map((m) => ({ id: m.id, aliases: m.aliases, label: m.label, tagline: m.tagline })), preferred: preferred ? preferred.id : null });
      return;
    }
    ui.sectionHeader('HELIX Mode Ring');
    ui.table(
      ['', 'Mode', 'Aliases', 'What it does'],
      MODES.map((m) => [
        (preferred && preferred.id === m.id ? '\u25cf' : ' ') + ' ' + m.glyph,
        `${m.label} (${m.id})`,
        m.aliases.join(', '),
        m.tagline,
      ]),
    );
    ui.keyValue('Active', preferred ? `${preferred.glyph} ${preferred.label} (${preferred.id})` : '(none \u2014 loop runs the raw prompt)');
    ui.nextSteps([
      'Flip a mode:  lehrosol modes plan   (or: code, review, fix, docs)',
      'One-off run:  lehrosol loop run --mode sentinel --prompt "..." --dryRun=false',
      'Full sweep:   lehrosol switch',
    ]);
    return { modes: MODES, preferred: preferred ? preferred.id : null };
  }

  if (cmd === 'current') {
    const preferred = getPreferredMode();
    if (flags.json) { logger.json({ preferred: preferred ? preferred.id : null }); return; }
    ui.sectionHeader('Active Mode');
    ui.keyValue('Mode', preferred ? `${preferred.glyph} ${preferred.label} (${preferred.id})` : '(none)');
    if (preferred) ui.keyValue('Focus', preferred.tagline);
    return { preferred: preferred ? preferred.id : null };
  }

  // `modes use --mode X`, or the fast path: `modes plan` / `modes forge` / ...
  const target = cmd === 'use' ? (flags.mode || flags.id) : cmd;
  const mode = getMode(target);
  if (!mode) {
    ui.error(`Unknown mode: ${target}`, `Valid modes: ${MODES.map((m) => `${m.id} (${m.aliases.join('/')})`).join(', ')}`);
    process.exitCode = 1;
    return { ok: false, reason: 'unknown-mode' };
  }
  setPreferredMode(mode.id);
  if (flags.json) { logger.json({ ok: true, mode: mode.id }); return { ok: true, mode: mode.id }; }
  ui.sectionHeader('Mode Switched');
  ui.keyValue('Now in', `${mode.glyph} ${mode.label} (${mode.id})`);
  ui.keyValue('Focus', mode.tagline);
  ui.nextSteps([
    `Run it: lehrosol loop run --prompt "..." --agentAdapter <id> --dryRun=false`,
    'The mode preamble is applied to every loop run until you switch again.',
  ]);
  return { ok: true, mode: mode.id };
}
