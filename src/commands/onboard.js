// World-class first-run experience: one command that takes an engineer from
// "just installed" to "watched an agentic mission succeed" in under a minute,
// with zero required configuration (the rehearsal path uses the local adapter).
import { runDoctor } from './doctorLogic.js';
import { listAdapters } from '../loop/adapters/index.js';
import { getFavorites } from '../core/favorites.js';
import { runMission } from '../agentic/mission.js';
import { ui } from '../core/ui.js';

function recommendation(adapters) {
  const ready = adapters.filter((a) => a.configured && a.id !== 'local');
  if (ready.length) return { id: ready[0].id, why: 'already configured and ready to run live', setup: null };
  const grok = adapters.find((a) => a.id === 'grok');
  if (grok) return { id: 'grok', why: 'frontier tool-calling model with one-line setup', setup: 'lehrosol models use --profile grok-4.5 --apiKey <XAI_API_KEY>' };
  return { id: 'ollama', why: 'free local models, no API key', setup: 'lehrosol models use --profile ollama-qwen-coder' };
}

export async function runOnboardCommand(flags, logger = console) {
  const steps = [];
  const doctor = runDoctor({ cwd: process.cwd() });
  steps.push({ step: 'doctor', ok: doctor.ok, detail: `${doctor.checks.filter((c) => c.ok).length}/${doctor.checks.length} checks passing` });

  const adapters = listAdapters();
  const ready = adapters.filter((a) => a.configured);
  steps.push({ step: 'adapters', ok: ready.length > 0, detail: `${ready.length}/${adapters.length} ready (${ready.slice(0, 5).map((a) => a.id).join(', ')})` });

  const rec = recommendation(adapters);
  steps.push({ step: 'recommendation', ok: true, detail: `${rec.id} — ${rec.why}` });

  let missionReport = null;
  if (flags.mission !== false) {
    missionReport = await runMission('Onboarding rehearsal: inspect this repository and propose one safe, high-value improvement.', { autonomy: 'readonly', id: `onboard-${Date.now().toString(36)}` });
    steps.push({ step: 'first-mission', ok: missionReport.status === 'succeeded', detail: `${missionReport.phases.length} phases · ${missionReport.status} (dry-run rehearsal)` });
  }

  const result = { steps, recommendation: rec, mission: missionReport ? { id: missionReport.id, status: missionReport.status } : null, preferredAdapter: getFavorites().preferredAdapter };
  if (flags.json) return logger.json ? logger.json(result) : console.log(JSON.stringify(result, null, 2));

  ui.sectionHeader('Welcome to LehroSol — guided onboarding');
  ui.table(['Step', 'Result', 'Detail'], steps.map((s) => [s.step, s.ok ? ui.highlight('OK') : 'ATTENTION', s.detail]));
  if (missionReport) {
    ui.success('You just ran your first agentic mission (safe rehearsal)', `mission ${missionReport.id} → ${missionReport.status}`);
  }
  const next = [];
  if (rec.setup) next.push(`Connect a model: ${rec.setup}`);
  next.push(`Probe it: lehrosol models test --adapter ${rec.id}`);
  next.push(`Go live: lehrosol mission run --goal "<your goal>" --adapter ${rec.id} --dryRun=false`);
  next.push('Open the cockpit: lehrosol tui --mode advanced');
  ui.nextSteps(next);
  return result;
}
