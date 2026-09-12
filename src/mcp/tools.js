// Self-documenting MCP tool registry, generalized from devTechish's
// src/agent/tools.js so it now exposes Lehro's three engineering disciplines
// (loop, harness, orchestrator) plus the gidevo-style doctor/workflow checks,
// the real agent-adapter registry, and the SQLite-backed session store.
import { runDoctor } from '../commands/doctorLogic.js';
import { evaluatePolicy } from '../harness/policy.js';
import { runLoop } from '../loop/loop.js';
import { listAdapters } from '../loop/adapters/index.js';
import { spawnWorktree, listWorktrees, removeWorktree } from '../orchestrator/worktree.js';
import { listSessions, getSession } from '../core/sessionStore.js';
import { planTaskGraph } from '../orchestrator/taskGraph.js';
import { runMission, planMission, listMissions } from '../agentic/mission.js';
import { runBench, benchSummary, topMovers } from '../bench/benchCore.js';
import { listRuns, setLayerWeight, recordCorrection, forgetCorrection, recordAdapterNote } from '../bench/benchStore.js';
import { listMarketplace } from '../marketplace/index.js';
import { analyzeSessions } from '../core/insights.js';
import { listAdapterConfigs, saveAdapterConfig, removeAdapterConfig } from '../core/config.js';
import { compactSessions, loadEngrams } from '../core/engrams.js';
import { listLabRuns, loadRecommendations, recommendationFor } from '../bench/modelLab.js';

export const TOOL_DEFINITIONS = {
  doctor_check: {
    name: 'doctor_check',
    description: 'Read-only health check of the current project: runtime, config, plugins, path safety.',
    inputSchema: { type: 'object', properties: { spec: { type: 'string' } } },
  },
  policy_evaluate: {
    name: 'policy_evaluate',
    description: 'Evaluate a change (PR-like input) against harness policy rules, including OWASP-scoped checks and scanner findings, with fix suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        branch: { type: 'string' },
        hasTests: { type: 'boolean' },
        secretScanPassed: { type: 'boolean' },
        reviewCount: { type: 'number' },
        owaspScope: { type: 'array', items: { type: 'string' } },
        owaspFindings: { type: 'array', items: { type: 'object' }, description: 'Findings from adapters_scan or a custom scanner: [{check, severity, file, autoFixable, note}]' },
      },
      required: ['branch'],
    },
  },
  loop_run: {
    name: 'loop_run',
    description: 'Run the Ralph-style Loop Engine: iterate a prompt against AGENTS.md + fix_plan.md until the harness Score Agent passes or the iteration budget is exhausted. Every iteration is checkpointed to the SQLite/JSON session store.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        maxIterations: { type: 'number', default: 12, minimum: 1, maximum: 100, description: 'Iteration budget. Resource profiles do not reduce this value.' },
        dryRun: { type: 'boolean', default: true },
        agentAdapter: { type: 'string', default: 'local', description: 'Adapter id: local, claude-code, codex, opencode, gemini-cli, aider, goose, hermes-agent, cursor, qwen, qoder, zencoder, amp, ollama, lmstudio, vllm, localai, nvidia, grok, or a custom adapter id.' },
        owaspScope: { type: 'array', items: { type: 'string' } },
        capabilityTier: { type: 'string', enum: ['frontier', 'standard', 'small', 'local'], default: 'standard' },
        toolSteps: { type: 'number', default: 64, minimum: 1, maximum: 200, description: 'Tool calls per adapter pass. Local HTTP adapters default 64, remote 24; LEHRO_TOOL_STEPS sets a machine-wide default. The harness challenges premature completions and continues from checkpoints.' },
      },
      required: ['prompt'],
    },
  },

  config_list: {
    name: 'config_list',
    description: 'List saved LehroSol adapter configuration with secrets masked by callers/UI.',
    inputSchema: { type: 'object', properties: {} },
  },
  config_set: {
    name: 'config_set',
    description: 'Save adapter configuration such as apiKey, apiKeyEnv, baseUrl, model, or bin path.',
    inputSchema: {
      type: 'object',
      properties: {
        adapter: { type: 'string' },
        apiKey: { type: 'string' },
        apiKeyEnv: { type: 'string' },
        baseUrl: { type: 'string' },
        model: { type: 'string' },
        bin: { type: 'string' },
      },
      required: ['adapter'],
    },
  },
  config_unset: {
    name: 'config_unset',
    description: 'Remove saved adapter configuration.',
    inputSchema: { type: 'object', properties: { adapter: { type: 'string' } }, required: ['adapter'] },
  },
  threads_list: {
    name: 'threads_list',
    description: 'List CMUX-style loop sessions and worktree workers.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
  },
  threads_run: {
    name: 'threads_run',
    description: 'Run multiple independent loop threads, optionally backed by git worktrees.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        count: { type: 'number', default: 2 },
        agentAdapter: { type: 'string', default: 'local' },
        dryRun: { type: 'boolean', default: true },
        worktrees: { type: 'boolean', default: true },
        maxIterations: { type: 'number', default: 3 },
      },
      required: ['prompt'],
    },
  },
  mission_run: { name: 'mission_run', description: 'Run an autonomous mission: decompose a goal into recon/implement/verify phases, execute each through the graded Loop Engine, and apply retry/replan recovery. Defaults to a safe dry-run rehearsal; set dryRun=false with a configured adapter for live execution.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, autonomy: { type: 'string', enum: ['readonly', 'guarded', 'full'], default: 'guarded' }, dryRun: { type: 'boolean', default: true }, adapter: { type: 'string' }, maxIterations: { type: 'number', default: 8, minimum: 1, maximum: 48 }, harden: { type: 'boolean' }, document: { type: 'boolean' } }, required: ['goal'] } },
  mission_plan: { name: 'mission_plan', description: 'Preview the dependency-aware phase plan for a mission goal without executing it.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, harden: { type: 'boolean' }, document: { type: 'boolean' } }, required: ['goal'] } },
  mission_list: { name: 'mission_list', description: 'List recorded missions with goal, status, autonomy, and adapter.', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 30 } } } },
  supervise_plan: { name: 'supervise_plan', description: 'Validate and schedule a dependency-aware task graph into execution waves.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, tasks: { type: 'array', items: { type: 'object' } } }, required: ['tasks'] } },
  marketplace_list: { name: 'marketplace_list', description: 'List the reviewed LehroSol adapter/extension/distribution catalog.', inputSchema: { type: 'object', properties: { type: { type: 'string' } } } },
  learn_report: { name: 'learn_report', description: 'Analyze persisted sessions and return deterministic self-improvement recommendations.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  adapters_list: {
    name: 'adapters_list',
    description: 'List every built-in/custom agent adapter, readiness, saved config status, target endpoint/binary, and setup metadata.',
    inputSchema: { type: 'object', properties: {} },
  },
  sessions_list: {
    name: 'sessions_list',
    description: 'List recent Loop Engine sessions from the SQLite (or JSON-fallback) session store.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
  },
  sessions_show: {
    name: 'sessions_show',
    description: 'Show one Loop Engine session, including every iteration checkpoint.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  sessions_diff: {
    name: 'sessions_diff',
    description: 'Return the workspace diff (git patch, stat, untracked files) recorded for a session — latest iteration by default, or a specific iteration.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, iteration: { type: 'number' } }, required: ['id'] },
  },
  sessions_compact: {
    name: 'sessions_compact',
    description: 'Engram Distillery: distill sessions older than the newest N into compact lesson engrams and delete their bulky checkpoints. Preview by default; pass apply=true to execute.',
    inputSchema: { type: 'object', properties: { keep: { type: 'number', default: 8 }, apply: { type: 'boolean', default: false } } },
  },
  memory_engrams: {
    name: 'memory_engrams',
    description: 'List distilled session engrams (project, adapter, verdict, lesson) — the long-term memory produced by sessions_compact.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
  },
  orchestrate_spawn: {
    name: 'orchestrate_spawn',
    description: 'Spawn N isolated git-worktree workers. If baseBranch is omitted, LehroSol auto-detects the current branch, or the current commit in detached HEAD; it never assumes main.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', default: 1 },
        baseBranch: { type: 'string', description: 'Optional git ref. Omit to auto-detect current branch/commit.' },
        taskPrefix: { type: 'string', default: 'lehro-worker' },
      },
    },
  },
  orchestrate_list: {
    name: 'orchestrate_list',
    description: 'List active Lehro-managed git worktree workers.',
    inputSchema: { type: 'object', properties: {} },
  },
  orchestrate_remove: {
    name: 'orchestrate_remove',
    description: 'Tear down a Lehro-managed git-worktree worker.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },

  // -- LehroSol internal benchmark for agentic, loop, and graph engineering --
  bench_run: {
    name: 'bench_run',
    description: 'Run the LehroSol internal benchmark across the requested scorecards (loop, mission, graph). Persists the run and reports per-layer deltas vs the previous run. The scorecard weights come from ~/.lehro/bench/preferences.json and are tunable per layer.',
    inputSchema: {
      type: 'object',
      properties: {
        layers: { type: 'string', description: 'Comma-separated layer ids (loop, mission, graph) or "all".', default: 'all' },
        prompt: { type: 'string', description: 'Optional user prompt — recorded on the run for traceability.' },
      },
    },
  },
  bench_history: {
    name: 'bench_history',
    description: 'List persisted bench runs (newest first).',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
  },
  bench_summary: {
    name: 'bench_summary',
    description: 'Show the latest bench run with per-layer scorecards, top movers, and active user corrections.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 }, movers: { type: 'number', default: 5 } } },
  },
  bench_movers: {
    name: 'bench_movers',
    description: 'Top regressions and improvements for a single layer across recent runs.',
    inputSchema: { type: 'object', properties: { layer: { type: 'string', enum: ['loop', 'mission', 'graph'] }, limit: { type: 'number', default: 5 } }, required: ['layer'] },
  },
  bench_weight_set: {
    name: 'bench_weight_set',
    description: 'Tune a per-layer scoring weight (0..1). Persisted in ~/.lehro/bench/preferences.json and applied to all future runs.',
    inputSchema: { type: 'object', properties: { layer: { type: 'string', enum: ['loop', 'mission', 'graph'] }, value: { type: 'number', minimum: 0, maximum: 1 } }, required: ['layer', 'value'] },
  },
  bench_correct: {
    name: 'bench_correct',
    description: 'Record a user reward (+0.1) or penalize (-0.1) on a specific bench testId. Multiplicative accumulation persists across runs until you forget it.',
    inputSchema: { type: 'object', properties: { testId: { type: 'string' }, delta: { type: 'number' }, reason: { type: 'string' } }, required: ['testId'] },
  },
  bench_forget: {
    name: 'bench_forget',
    description: 'Clear a persisted per-test correction.',
    inputSchema: { type: 'object', properties: { testId: { type: 'string' } }, required: ['testId'] },
  },
  bench_note: {
    name: 'bench_note',
    description: 'Record a free-form observation about an adapter (surfaced as a warning on future runs that touch it).',
    inputSchema: { type: 'object', properties: { adapter: { type: 'string' }, note: { type: 'string' } }, required: ['adapter', 'note'] },
  },
  model_lab_run: {
    name: 'model_lab_run',
    description: 'Run deterministic local-model quality tests, measure quality per output token, persist the experiment, and update the model-specific recommendation.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', default: 'local' },
        maxTokens: { type: 'number', default: 256, minimum: 32, maximum: 4096 },
        temperature: { type: 'number', default: 0.2, minimum: 0, maximum: 2 },
        port: { type: 'number', default: 7000 },
        apiKey: { type: 'string' },
        case: { type: 'string', description: 'Optional comma-separated lab case ids.' },
        workflow: { type: 'string', enum: ['general', 'ask', 'code'], default: 'general' },
      },
    },
  },
  model_lab_tune: {
    name: 'model_lab_tune',
    description: 'Run a bounded matrix of deterministic local-model quality tests and promote the lowest-token passing settings.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', default: 'local' },
        maxTokens: { type: 'number', default: 256, minimum: 32, maximum: 4096 },
        temperature: { type: 'number', default: 0.2, minimum: 0, maximum: 2 },
        port: { type: 'number', default: 7000 },
        apiKey: { type: 'string' },
        case: { type: 'string', description: 'Optional comma-separated lab case ids.' },
        workflow: { type: 'string', enum: ['general', 'ask', 'code'], default: 'general' },
        maxExperiments: { type: 'number', default: 9, minimum: 1, maximum: 12, description: 'Hard cap on tuning candidates; each candidate runs every selected case.' },
      },
    },
  },
  model_lab_history: {
    name: 'model_lab_history',
    description: 'List persisted model-lab experiments with quality, tokens, and quality-per-token.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
  },
  model_lab_recommend: {
    name: 'model_lab_recommend',
    description: 'Return the lowest-total-token passing model-lab settings for a model workflow, or all saved recommendations.',
    inputSchema: { type: 'object', properties: { model: { type: 'string' }, workflow: { type: 'string', enum: ['general', 'ask', 'code'], default: 'general' } } },
  },
};

export function listTools() {
  return Object.values(TOOL_DEFINITIONS);
}

export async function executeTool(name, args = {}) {
  switch (name) {
    case 'doctor_check':
      return runDoctor(args);
    case 'policy_evaluate':
      return evaluatePolicy(args);
    case 'loop_run':
      return runLoop(args);

    case 'config_list': {
      const configs = listAdapterConfigs();
      for (const cfg of Object.values(configs)) { if (cfg && cfg.apiKey) cfg.apiKey = '********'; }
      return { adapters: configs };
    }
    case 'config_set': {
      saveAdapterConfig(args.adapter, args);
      return { adapter: args.adapter, saved: true };
    }
    case 'config_unset':
      return { adapter: args.adapter, removed: removeAdapterConfig(args.adapter) };
    case 'threads_list':
      return { threads: listSessions({ limit: args.limit || 20 }), worktrees: listWorktrees().worktrees || [] };
    case 'threads_run': {
      const count = Math.max(1, Math.min(Number(args.count || 2), 12));
      const results = [];
      for (let i = 0; i < count; i += 1) {
        // Sequential inside MCP to keep resource usage bounded; CLI command runs in parallel.
        results.push(await runLoop({
          prompt: `${args.prompt}\n\nThread ${i + 1}/${count}: pursue an independent implementation path.`,
          maxIterations: args.maxIterations || 3,
          dryRun: args.dryRun !== false,
          agentAdapter: args.agentAdapter || 'local',
        }));
      }
      return { count, results };
    }
    case 'mission_run': return runMission(args.goal, args);
    case 'mission_plan': return planMission(args.goal, args);
    case 'mission_list': return { missions: listMissions(args) };
    case 'supervise_plan': return planTaskGraph(args);
    case 'marketplace_list': return { items: listMarketplace(args) };
    case 'learn_report': return analyzeSessions(args);
    case 'adapters_list':
      return { adapters: listAdapters() };
    case 'sessions_list':
      return { sessions: listSessions(args) };
    case 'sessions_show':
      return getSession(args.id);
    case 'sessions_diff': {
      const session = getSession(args.id);
      if (!session) throw new Error('No session found with id ' + args.id);
      const entries = (session.checkpoints || [])
        .map((cp) => ({ iteration: cp.iteration || (cp.data || cp).iteration, diff: (cp.data || cp).diff }))
        .filter((e) => e.diff && !e.diff.empty);
      const wanted = args.iteration != null
        ? entries.find((e) => Number(e.iteration) === Number(args.iteration))
        : entries[entries.length - 1];
      return {
        sessionId: session.id,
        iterationsWithDiffs: entries.map((e) => e.iteration),
        iteration: wanted ? wanted.iteration : null,
        diff: wanted ? wanted.diff : null,
      };
    }
    case 'sessions_compact':
      return compactSessions({ keep: args.keep, apply: args.apply === true });
    case 'memory_engrams': {
      const book = loadEngrams();
      const limit = Math.max(1, Number(args.limit || 20));
      return { total: book.length, engrams: [...book].sort((a, b) => String(b.distilledAt || '').localeCompare(String(a.distilledAt || ''))).slice(0, limit) };
    }
    case 'orchestrate_spawn':
      return spawnWorktree(args);
    case 'orchestrate_list':
      return listWorktrees();
    case 'orchestrate_remove':
      return removeWorktree(args.name);
    case 'bench_run':
      return runBench({ layers: args.layers || 'all', prompt: args.prompt || null, triggeredBy: 'mcp' });
    case 'bench_history':
      return { count: listRuns({ limit: Math.max(1, Math.min(Number(args.limit || 20), 200)) }).length, runs: listRuns({ limit: Math.max(1, Math.min(Number(args.limit || 20), 200)) }) };
    case 'bench_summary': {
      const summary = benchSummary({ limit: Number(args.limit || 10) });
      const moversArg = Math.max(1, Math.min(Number(args.movers || 5), 20));
      summary.moversByLayer = {};
      for (const layer of (summary.latest && summary.latest.layers ? summary.latest.layers : ['loop', 'mission', 'graph'])) {
        summary.moversByLayer[layer] = topMovers(layer, { limit: moversArg }).movers;
      }
      return summary;
    }
    case 'bench_movers':
      return topMovers(args.layer, { limit: Math.max(1, Math.min(Number(args.limit || 5), 50)) });
    case 'bench_weight_set':
      return { weights: setLayerWeight(args.layer, args.value).weights };
    case 'bench_correct':
      return recordCorrection(args.testId, args.delta == null ? 0.1 : args.delta, args.reason || null);
    case 'bench_forget':
      return forgetCorrection(args.testId);
    case 'bench_note':
      return recordAdapterNote(args.adapter, args.note);
    case 'model_lab_history':
      return { runs: listLabRuns({ limit: Math.max(1, Math.min(Number(args.limit || 20), 200)) }) };
    case 'model_lab_recommend': {
      const model = String(args.model || '').trim();
      const recommendations = loadRecommendations();
      if (!model) return recommendations;
      const { recommendationForWorkflow } = await import('../bench/modelLab.js');
      return recommendationForWorkflow(model, args.workflow || 'general', recommendations, { fallbackGeneral: false })
        || recommendationFor(model, undefined, { workflow: args.workflow || 'general' });
    }
    case 'model_lab_run': {
      const { runModelLab, selectLabCases } = await import('../bench/modelLab.js');
      const { chatOnce, ensureServing, DEFAULT_PORT, DEFAULT_KEY } = await import('../commands/quick.js');
      const model = String(args.model || 'local');
      const settings = { model, maxTokens: Number(args.maxTokens || 256), temperature: args.temperature == null ? 0.2 : Number(args.temperature) };
      const cases = selectLabCases(args.workflow || 'general', args.case);
      return runModelLab({
        model,
        workflow: args.workflow || 'general',
        settings,
        cases,
        executor: async (prompt) => {
          const serving = await ensureServing({ model, port: Number(args.port || DEFAULT_PORT), apiKey: args.apiKey || DEFAULT_KEY, showWarmup: false }, { json: true }, { json() {} });
          if (!serving.ok) return { ok: false, text: '', error: serving.reason };
          const result = await chatOnce({ baseUrl: serving.baseUrl, apiKey: args.apiKey || DEFAULT_KEY, prompt, maxTokens: settings.maxTokens, temperature: settings.temperature, timeoutMs: 600000 });
          return result.ok ? result : { ...result, text: '' };
        },
      });
    }
    case 'model_lab_tune': {
      const { selectLabCases, tuneModelLab } = await import('../bench/modelLab.js');
      const { chatOnce, ensureServing, DEFAULT_PORT, DEFAULT_KEY } = await import('../commands/quick.js');
      const model = String(args.model || 'local');
      const settings = { model, maxTokens: Number(args.maxTokens || 256), temperature: args.temperature == null ? 0.2 : Number(args.temperature) };
      const cases = selectLabCases(args.workflow || 'general', args.case);
      return tuneModelLab({
        model,
        workflow: args.workflow || 'general',
        settings,
        maxExperiments: Number(args.maxExperiments || 9),
        cases,
        executor: async (prompt, experimentSettings) => {
          const serving = await ensureServing({ model, port: Number(args.port || DEFAULT_PORT), apiKey: args.apiKey || DEFAULT_KEY, showWarmup: false }, { json: true }, { json() {} });
          if (!serving.ok) return { ok: false, text: '', error: serving.reason };
          const result = await chatOnce({ baseUrl: serving.baseUrl, apiKey: args.apiKey || DEFAULT_KEY, prompt, maxTokens: experimentSettings.maxTokens, temperature: experimentSettings.temperature, timeoutMs: 600000 });
          return result.ok ? result : { ...result, text: '' };
        },
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
