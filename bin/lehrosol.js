#!/usr/bin/env node
// LehroSol CLI (short alias: lehr-sol) entrypoint. Zero-dependency argument
// parsing (no commander/yargs) so `npm i -g lehrosol-cli`, `bunx lehrosol-cli`,
// and the curl installer all work with nothing to resolve.
//
// Audit upgrade: parser now supports short flags (-i, -q), --key=value, and
// boolean coercion so documented examples like --dryRun=false actually work.
import { createLogger } from '../src/core/logger.js';
import { ui, configureUi, runInteractiveMode } from '../src/core/ui.js';
import { registerDoctorOutput } from '../src/commands/doctor.js';
import { runMcpCommand } from '../src/commands/mcp.js';
import { runLoopCommand } from '../src/commands/loop.js';
import { runOrchestrateCommand } from '../src/commands/orchestrate.js';
import { runPolicyCommand } from '../src/commands/policy.js';
import { runGuiCommand } from '../src/commands/gui.js';
import { runTuiCommand } from '../src/commands/tui.js';
import { runInitCommand } from '../src/commands/init.js';
import { runSessionsCommand } from '../src/commands/sessions.js';
import { runAdaptersCommand } from '../src/commands/adapters.js';
import { runConfigCommand } from '../src/commands/config.js';
import { runThreadsCommand } from '../src/commands/threads.js';
import { runModelsCommand } from '../src/commands/models.js';
import { runServeCommand } from '../src/commands/serve.js';
import { runModesCommand } from '../src/commands/modes.js';
import { runSwitchCommand } from '../src/commands/switch.js';
import { runRecommendCommand } from '../src/commands/recommend.js';
import { runVaultCommand } from '../src/commands/vault.js';
import { runDiffCommand } from '../src/commands/diff.js';
import { runProjectsCommand } from '../src/commands/projects.js';
import { runCompactCommand, runEngramsCommand } from '../src/commands/compact.js';
import { runReportCommand } from '../src/commands/report.js';
import { runMissionCommand } from '../src/commands/mission.js';
import { runOnboardCommand } from '../src/commands/onboard.js';
import { runSuperviseCommand } from '../src/commands/supervise.js';
import { runPanesCommand } from '../src/commands/panes.js';
import { runMarketplaceCommand } from '../src/commands/marketplace.js';
import { runReleaseCommand } from '../src/commands/release.js';
import { runIdeCommand } from '../src/commands/ide.js';
import { runCompletionsCommand } from '../src/commands/completions.js';
import { runLearnCommand } from '../src/commands/learn.js';
import { runUpCommand, runTryCommand, runArenaCommand, runScanCommand } from '../src/commands/quick.js';
import { runCodeCommand } from '../src/commands/code.js';
import { runAskCommand } from '../src/commands/ask.js';
import { runSkillsCommand } from '../src/core/skills.js';
import { runOptimizeCommand } from '../src/commands/optimize.js';
import { runMissionsCommand } from '../src/commands/missions.js';
import { runSupportCommand } from '../src/commands/support.js';
import { runBenchCommand } from '../src/commands/bench.js';
import { runModelLabCommand } from '../src/commands/modelLab.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0-dev';
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const raw = arg.slice(2);
      const eq = raw.indexOf('=');
      if (eq !== -1) {
        flags[toCamel(raw.slice(0, eq))] = parseValue(raw.slice(eq + 1));
        continue;
      }

      const key = toCamel(raw);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        flags[key] = true;
      } else {
        flags[key] = parseValue(next);
        i += 1;
      }
      continue;
    }

    if (/^-[A-Za-z]+$/.test(arg)) {
      for (const ch of arg.slice(1)) applyShortFlag(flags, ch);
      continue;
    }

    positional.push(arg);
  }
  return { positional: positional, flags: flags };
}

function parseValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function applyShortFlag(flags, ch) {
  switch (ch) {
    case 'i':
      flags.i = true;
      flags.interactive = true;
      break;
    case 'q':
      flags.quiet = true;
      break;
    case 'h':
      flags.help = true;
      break;
    case 'v':
      flags.version = true;
      break;
    default:
      flags[ch] = true;
  }
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const VERSION = resolveVersion();

const HELP = `
${ui.box('LehroSol CLI — Unified Agentic Engineering', { title: 'LehroSol CLI v' + VERSION })}

  ${ui.highlight('Usage:')} lehrosol <command> [subcommand] [--flags]   (or: lehr-sol <command> ...)

  ${ui.highlight('Quick lane:')}
    ${ui.filePath('up')}                             Zero-to-serving: scan drive → best-fit model → host on :7000 — one word
    ${ui.filePath('try [model]')}                    Test-bench chat REPL — latency + tok/s after every reply, /sys, history
    ${ui.filePath('arena [--prompt "..."]')}         Race your best local models on one prompt — tok/s scoreboard
    ${ui.filePath('ask "question"')}                 Direct Q&A to the hot engine — instant answer, no file loop
    ${ui.filePath('code "task"')}                    Agentic coding on THIS folder — the local model reads & writes your files
    ${ui.filePath('skills')}                          Browse reusable engineering skills and reasoning levels
    ${ui.filePath('optimize')}                        Inspect smart RAM/CPU/GPU launch settings for this machine
    ${ui.filePath('missions list|show|undo|replay')}  Mission journal — history, details, one-command rollback, re-run
    ${ui.filePath('scan [--path "D:\\AI Models"]')}   Zero-setup GGUF discovery (optionally add a folder first)

  ${ui.highlight('Commands:')}
    ${ui.filePath('doctor')}                         Read-only project health check
    ${ui.filePath('init')}                           Write starter AGENTS.md / fix_plan.md / .lehrorc.json
    ${ui.filePath('loop run --prompt "..."')}        Run the Ralph-style Loop Engine
    ${ui.filePath('adapters')}                       List live agent adapters, readiness, setup hints, and endpoints
    ${ui.filePath('config list|set|doctor|wizard')}  Configure adapters, API keys, local model endpoints, and CLI paths
    ${ui.filePath('threads list|run')}               CMUX-style parallel loop threads over sessions/worktrees
    ${ui.filePath('models list|use|current|test')}   Select, prefer, and probe Grok/local/hosted model profiles
    ${ui.filePath('serve start|stop|status|models')}  Run local models via an engine binary (Jan, llama.cpp) and wire them to the loop
    ${ui.filePath('vault list|serve|doctor|add-root')} Model Vault: scan your drive for GGUFs, rate them for this machine, host them directly — no engine app needed
    ${ui.filePath('modes list|<mode>')}               HELIX Mode Ring — flip between recon/forge/sentinel/medic/scribe (plan/code/review/fix/docs)
    ${ui.filePath('switch')}                          Interactive switchboard: sweep mode → agent adapter → model (live-probed)
    ${ui.filePath('recommend')}                       Hardware-aware model report: which local models fit your RAM/GPU and their best roles
    ${ui.filePath('diff')}                            Show exactly what the agent changed — colorized git patch captured per loop iteration
    ${ui.filePath('projects')}                        Project Constellation: every repo you run in earns a codename, sigil, and run history
    ${ui.filePath('compact')}                         Engram Distillery: distill old sessions into tiny lessons the loop reuses as field notes
    ${ui.filePath('engrams')}                         Browse distilled memory — the lessons LehroSol has learned, per project
    ${ui.filePath('report')}                          Export any session as a shareable Markdown mission report (objective, log, diff)
    ${ui.filePath('mission run|plan|list|status')}   Autonomous goal → plan → execute → verify → adapt missions
    ${ui.filePath('onboard')}                        Guided first-run: doctor → adapters → first mission in one command
    ${ui.filePath('supervise plan|run|list|status')}  Dependency-aware task-graph supervisor
    ${ui.filePath('panes plan|launch')}              tmux pane orchestration
    ${ui.filePath('marketplace list|install')}       Safe catalog + checksum-gated local plugins
    ${ui.filePath('release manifest|verify|formula')} Release integrity, SBOM, provenance, Homebrew
    ${ui.filePath('ide install --editor ...')}       VS Code, Zed, JetBrains integration
    ${ui.filePath('completions <shell>')}             Bash/Zsh/Fish/PowerShell completion
    ${ui.filePath('learn report')}                   Session-derived improvement intelligence
    ${ui.filePath('bench run|report|history|weights|forget|note')}  Internal scorecard for loop + agentic + graph engineering, with persistent user-tuned weights and corrections
    ${ui.filePath('model-lab run|tune|history|recommend')}              Measure and tune local-model quality per token
    ${ui.filePath('support create')}                 Redacted diagnostic support bundle
    ${ui.filePath('sessions list|show')}             Inspect persisted Loop Engine sessions/checkpoints
    ${ui.filePath('orchestrate spawn|list|remove')}  Manage git-worktree agent workers
    ${ui.filePath('policy evaluate --branch ...')}   Run the harness policy/OWASP gate
    ${ui.filePath('mcp start [--http] [--port]')}    Start the MCP control plane (stdio by default)
    ${ui.filePath('gui [--port]')}                   Web control plane · press t inside it to hop into the TUI cockpit
    ${ui.filePath('tui [--mode basic|intermediate|advanced]')}  Open the immersive in-terminal GUI cockpit

  ${ui.highlight('Examples:')}
    $ lehrosol up                     # zero → serving: pick + host the best model for this machine
    $ lehrosol try qwopus             # chat REPL with tok/s stats (or --prompt "..." for one-shot)
    $ lehrosol arena --count 2        # same prompt across your top models — scoreboard
    $ lehrosol scan                   # what GGUFs do I have, and what fits?
    $ lehrosol doctor
    $ lehrosol -i
    $ lehrosol tui                    # live animated cockpit (CMUX-class)
    $ lehrosol tui --mode advanced    # full control plane density
    $ lehrosol tui --static           # one-shot paint (great for pipes/CI)
    $ lehrosol tui --json             # machine-readable snapshot
    $ lehrosol loop run --prompt "harden the auth endpoint" --agentAdapter claude-code --dryRun=false
    $ lehrosol onboard                # guided first-run + safe rehearsal mission
    $ lehrosol mission run --goal "add input validation" --adapter grok --dryRun=false
    $ lehrosol models use --profile grok-4.5 --apiKey <XAI_API_KEY>
    $ lehrosol models test --adapter grok
    $ lehrosol serve start --model jan-code-4b --use   # local Jan model → preferred adapter
    $ lehrosol serve start --engine llamacpp --model "D:\\AI Models\\llamacpp\\models\\Qwopus3_5-4B-Coder-Fable5-v1-Q4_K_M" --use
    $ lehrosol serve status                            # probe the local /v1 endpoint
    $ lehrosol vault                                   # every GGUF on your drive, rated for this machine
    $ lehrosol vault serve --model qwopus --port 7000  # host straight from the hard drive + wire the loop
    $ lehrosol vault serve --model <name> --port 7000 --ctx 4096            # override the auto-picked context window
    $ lehrosol vault serve --model <name> --port 7000 --resourceProfile balanced  # pick eco|balanced|performance (sets ctx/threads/token budget)
    $ lehrosol modes plan                              # flip the loop into read-only Recon mode
    $ lehrosol switch                                  # sweep mode → adapter → model interactively
    $ lehrosol recommend                               # rate your local models against your RAM/GPU
    $ lehrosol diff                                    # see what the agent changed in the last live run
    $ lehrosol projects                                # your project constellation with codenames
    $ lehrosol compact --apply --keep 8                # distill old sessions into engram memory
    $ lehrosol engrams                                 # the lessons this tool has learned
    $ lehrosol report                                  # export the latest run as a mission report
    $ lehrosol config set --adapter nvidia --apiKey <key> --model nvidia/llama-3.1-nemotron-70b-instruct
    $ lehrosol config set --adapter ollama --baseUrl http://localhost:11434/v1 --model qwen2.5-coder:7b
    $ lehrosol loop run --prompt "add tests" --agentAdapter ollama --dryRun=false   # local OSS model + tool calling
    $ lehrosol loop run --prompt "refactor auth" --agentAdapter grok --dryRun=false     # xAI Grok + tool calling
    $ lehrosol threads run --prompt "try 3 fixes" --count 3 --agentAdapter opencode --dryRun=false
    $ lehrosol policy evaluate --branch feature/x --hasTests --reviewCount 1 --owasp-scope llm,web
    $ lehrosol orchestrate spawn --count 3 --taskPrefix feature-x

  ${ui.highlight('Options:')}
    -i, --interactive    Run in interactive wizard mode
    -q, --quiet          Suppress banner and non-essential output
    -h, --help           Show this help
    -v, --version        Print version
    --json               Machine-readable JSON output (most commands)
    --no-color           Disable ANSI color output
    --ascii              Force ASCII-only glyphs/borders (legacy consoles)
    --no-anim            Disable animations (static frames only)

  ${ui.highlight('Local-engine flags (vault serve / serve start):')}
    --model <name>       GGUF filename, folder, or vault id to host (required for llamacpp)
    --port <n>           Port to serve on (default 7000 for vault, 8080 for serve start)
    --apiKey <key>       API key the engine will require (default auto-generated; pass lehro-local for local-only)
    --ctx <n>            Context window size — overrides the auto-pick (e.g. --ctx 4096 for longer agent missions)
    --ctxSize <n>        Alias for --ctx
    --resourceProfile <p>  Memory/thread policy: eco (2048 ctx, 2 threads), balanced (4096 ctx), performance (8192 ctx)
    --ramProfile <p>     Alias for --resourceProfile
    --gpuLayers <n>      GPU layers to offload (llamacpp -ngl; default 0 on CPU-only)
    --ngl <n>            Alias for --gpuLayers
    --threads <n>        CPU threads (-t; default auto-tuned to physical cores)
    --mmproj <path>      Vision projector GGUF for multimodal models
    --use                Also wire this engine as the preferred adapter (default true for vault serve)
    --foreground         Run the engine in the foreground instead of detaching

  ${ui.highlight('Local code-lane flags:')}
    --maxSteps <n>       Tool steps per pass (default 24; max 160)
    --maxExtensions <n>  Automatic continuation passes after a budget checkpoint (default 3)
    --noAutoContinue     Stop after one pass instead of continuing automatically
    --continue           Resume the most recent code-lane task after a budget stop

  ${ui.highlight('Documentation:')} https://github.com/lehrosolutions/lehrosol-cli
`;

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);

  configureUi({ quiet: flags.quiet, noColor: flags.noColor });
  const logger = createLogger({ quiet: flags.quiet, noColor: flags.noColor });

  if (flags.version) {
    console.log(VERSION);
    return;
  }

  if (flags.interactive || flags.i) {
    try {
      const { command, options } = await runInteractiveMode(VERSION);
      switch (command) {
        case 'doctor':
          registerDoctorOutput(logger, Boolean(flags.json));
          break;
        case 'init':
          runInitCommand(options, logger);
          break;
        case 'loop':
          await runLoopCommand('run', options, logger);
          break;
        case 'adapters':
          runAdaptersCommand(flags, logger);
          break;
        case 'config':
          runConfigCommand(options.subcommand || 'wizard', options, logger);
          break;
        case 'threads':
          await runThreadsCommand(options.subcommand || 'list', options, logger);
          break;
        case 'models':
          await runModelsCommand(options.subcommand || 'list', options, logger);
          break;
        case 'serve':
          await runServeCommand(options.subcommand || 'status', options, logger);
          break;
        case 'vault':
          await runVaultCommand(options.subcommand || 'list', options, logger);
          break;
        case 'modes':
          runModesCommand(options.subcommand || 'list', options, logger);
          break;
        case 'switch':
          await runSwitchCommand(options, logger);
          break;
        case 'recommend':
          await runRecommendCommand(options, logger);
          break;
        case 'diff':
          runDiffCommand(options, logger);
          break;
        case 'projects':
          runProjectsCommand(options, logger);
          break;
        case 'compact':
          runCompactCommand(options, logger);
          break;
        case 'engrams':
          runEngramsCommand(options, logger);
          break;
        case 'report':
          runReportCommand(options, logger);
          break;
        case 'mission': await runMissionCommand(options.subcommand || 'run', options, logger); break;
        case 'onboard': await runOnboardCommand(options, logger); break;
        case 'supervise': await runSuperviseCommand(options.subcommand || 'plan', options, logger); break;
        case 'panes': runPanesCommand(options.subcommand || 'plan', options, logger); break;
        case 'marketplace': runMarketplaceCommand(options.subcommand || 'list', options, logger); break;
        case 'release': runReleaseCommand(options.subcommand || 'manifest', options, logger); break;
        case 'ide': runIdeCommand(options.subcommand || 'install', options, logger); break;
        case 'learn': runLearnCommand('report', options, logger); break;
        case 'support': runSupportCommand('create', options, logger); break;
        case 'bench': await runBenchCommand(options.subcommand || 'run', options, logger); break;
        case 'sessions':
          runSessionsCommand(options.id ? 'show' : 'list', options, logger);
          break;
        case 'orchestrate':
          runOrchestrateCommand(options.subcommand || 'spawn', options, logger);
          break;
        case 'policy':
          runPolicyCommand('evaluate', options, logger);
          break;
        case 'gui':
          runGuiCommand(flags, logger);
          break;
        case 'tui':
          await runTuiCommand(options, logger);
          break;
      }
    } catch (e) {
      ui.error('Interactive mode error', e.message);
      process.exitCode = 1;
    }
    return;
  }

  const [command, subcommand] = positional;

  if (!command || command === 'help' || flags.help) {
    ui.showLogoBanner(VERSION);
    console.log(HELP);
    return;
  }

  if (!flags.json && !flags.quiet && command !== 'mcp') {
    if (command === 'up' || command === 'try' || command === 'arena' || command === 'ask' || command === 'code') ui.showLogoBanner(VERSION);
    else ui.showCompactBanner(VERSION);
  }

  switch (command) {
    case 'doctor':
      registerDoctorOutput(logger, Boolean(flags.json));
      break;
    case 'init':
      runInitCommand(flags, logger);
      break;
    case 'loop':
      await runLoopCommand(subcommand, flags, logger);
      break;
    case 'adapters':
      runAdaptersCommand(flags, logger);
      break;
    case 'config':
      runConfigCommand(subcommand, flags, logger);
      break;
    case 'threads':
      await runThreadsCommand(subcommand, flags, logger);
      break;
    case 'models':
      await runModelsCommand(subcommand, flags, logger);
      break;
    case 'serve':
      await runServeCommand(subcommand, flags, logger);
      break;
    case 'vault':
      await runVaultCommand(subcommand, flags, logger);
      break;
    case 'modes':
      runModesCommand(subcommand, flags, logger);
      break;
    case 'switch':
      await runSwitchCommand(flags, logger);
      break;
    case 'recommend':
      await runRecommendCommand(flags, logger);
      break;
    case 'diff':
      runDiffCommand(flags, logger);
      break;
    case 'projects':
      runProjectsCommand(flags, logger);
      break;
    case 'compact':
      runCompactCommand(flags, logger);
      break;
    case 'engrams':
      runEngramsCommand(flags, logger);
      break;
    case 'report':
      runReportCommand(flags, logger);
      break;
    case 'mission': await runMissionCommand(subcommand, flags, logger); break;
    case 'onboard': await runOnboardCommand(flags, logger); break;
    case 'supervise': await runSuperviseCommand(subcommand, flags, logger); break;
    case 'panes': runPanesCommand(subcommand, flags, logger); break;
    case 'marketplace': runMarketplaceCommand(subcommand, flags, logger); break;
    case 'release': runReleaseCommand(subcommand, flags, logger); break;
    case 'ide': runIdeCommand(subcommand, flags, logger); break;
    case 'completions': runCompletionsCommand(subcommand, flags, logger); break;
    case 'learn': runLearnCommand(subcommand, flags, logger); break;
    case 'support': runSupportCommand(subcommand, flags, logger); break;
    case 'up': await runUpCommand(flags, logger); break;
    case 'try': await runTryCommand(subcommand, flags, logger); break;
    case 'arena': await runArenaCommand(flags, logger); break;
    case 'ask': await runAskCommand(positional.slice(1).join(' '), flags, logger); break;
    case 'code': await runCodeCommand(positional.slice(1).join(' '), flags, logger); break;
    case 'skills': runSkillsCommand(flags, logger); break;
    case 'optimize': runOptimizeCommand(flags, logger); break;
    case 'missions': await runMissionsCommand(subcommand || 'list', flags, logger); break;
    case 'scan': await runScanCommand(flags, logger); break;
    case 'bench': await runBenchCommand(subcommand || 'run', flags, logger); break;
    case 'model-lab': await runModelLabCommand(subcommand || 'run', flags, logger); break;
    case 'sessions':
      runSessionsCommand(subcommand, flags, logger);
      break;
    case 'orchestrate':
      runOrchestrateCommand(subcommand, flags, logger);
      break;
    case 'policy':
      runPolicyCommand(subcommand, flags, logger);
      break;
    case 'mcp':
      runMcpCommand(subcommand, flags, logger);
      break;
    case 'gui':
      runGuiCommand(flags, logger);
      break;
    case 'tui':
      await runTuiCommand(flags, logger);
      break;
    default:
      ui.error('Unknown command: ' + command);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  ui.error('LehroSol CLI failed', String((err && err.stack) || err));
  process.exitCode = 1;
});
