import { startHttpServer } from '../mcp/server.js';
import { ui } from '../core/ui.js';
import { isTTY, motionEnabled, startKeyReader } from '../core/anim.js';
import { fg, palette, glyph } from '../core/theme.js';

// GUI-to-terminal crossover: this command starts the same MCP HTTP endpoint
// the GUI dashboard talks to, and — when run in an interactive terminal —
// becomes a live switchboard: press `t` to drop into the TUI cockpit in this
// same process (the HTTP plane keeps serving underneath), quit the cockpit to
// land back here, still live. One control plane, two front-ends, shared
// session/worktree/loop/engram state under ~/.lehro.
export async function runGuiCommand(flags = {}, logger = console) {
  const port = flags.port ? Number(flags.port) : 4177;

  ui.sectionHeader('GUI — Control Plane');
  ui.keyValue('HTTP Port', String(port));
  ui.keyValue('Endpoint', ui.filePath('http://localhost:' + port));

  const server = startHttpServer({ port: port });

  ui.success('Control plane is live', `POST JSON-RPC 2.0 messages to http://localhost:${port}`);

  ui.divider();

  ui.sectionHeader('Available MCP Tools');
  ui.list([
    'doctor_check — Environment health check',
    'policy_evaluate — Harness policy + OWASP gate',
    'loop_run — Start a graded agent loop',
    'adapters_list — List agent adapters',
    'sessions_list — List past loop sessions',
    'sessions_show — Inspect a specific session',
    'sessions_diff — Recorded workspace diff (git patch) for a session',
    'sessions_compact — Distill old sessions into lesson engrams',
    'memory_engrams — Browse distilled long-term memory',
    'orchestrate_spawn — Create parallel git-worktree workers',
    'orchestrate_list — List active workers',
    'orchestrate_remove — Remove a worker',
  ], '12 JSON-RPC tools available');

  ui.nextSteps([
    'From a source checkout, run the dashboard separately: cd gui && npm install && npm run dev',
    'Or drive from any MCP-aware agent CLI',
    'Press t to switch to the terminal cockpit (control plane keeps running)',
    'Press q or Ctrl+C to stop the control plane',
  ]);

  // Non-interactive shells (pipes, services, CI) keep the old behavior: the
  // server holds the process open until the user kills it.
  if (flags.headless || !isTTY() || !motionEnabled()) return;

  const hint = () => {
    console.log(fg(palette.muted, `  ${glyph.caret} press `) + fg(palette.cyan, 't')
      + fg(palette.muted, ' for the terminal cockpit · ') + fg(palette.cyan, 'q')
      + fg(palette.muted, ' to stop the control plane'));
  };
  hint();

  await new Promise((resolveDone) => {
    let busy = false;
    let stop = null;
    const attach = () => startKeyReader(async (key) => {
      if (busy) return;
      if (key === 'q' || key === 'ctrl-c') {
        if (stop) stop();
        try { server.close(); } catch { /* already down */ }
        console.log(fg(palette.muted, `  ${glyph.info} control plane stopped.`));
        resolveDone();
        return;
      }
      if (key === 't') {
        busy = true;
        if (stop) stop();
        try {
          const { runTuiCommand } = await import('./tui.js');
          await runTuiCommand({ mode: flags.mode }, logger);
        } catch (err) {
          console.log(fg(palette.red, `  cockpit failed: ${(err && err.message) || err}`));
        }
        console.log(fg(palette.muted, `  ${glyph.info} back at the control plane — still serving `) + fg(palette.text, `http://localhost:${port}`));
        hint();
        busy = false;
        stop = attach();
      }
    });
    stop = attach();
  });
}
