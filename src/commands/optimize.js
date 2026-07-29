// `lehrosol optimize` — inspect the live machine and show the conservative
// resource plan that will be used for local serving and agent work.
import { scanVault, vaultRoots, resolveVaultModel } from '../core/modelVault.js';
import { detectHardware, rateModelFit } from '../core/hardware.js';
import { normalizeResourceProfile, planResources, RESOURCE_PROFILES } from '../core/resourcePlanner.js';
import { ui } from '../core/ui.js';

export function runOptimizeCommand(flags = {}, logger = console) {
  const hardware = detectHardware();
  const profile = normalizeResourceProfile(flags.resourceProfile || flags.ramProfile || flags.profile);
  const entries = scanVault({ roots: vaultRoots() });
  const entry = flags.model ? resolveVaultModel(String(flags.model), entries) : null;
  const fit = entry ? { ...entry, ...rateModelFit(entry.sizeBytes, hardware) } : {};
  const plan = planResources(hardware, fit, profile);
  const payload = { ok: true, profile, profiles: Object.keys(RESOURCE_PROFILES), hardware, model: entry ? { id: entry.id, sizeBytes: entry.sizeBytes } : null, plan };
  if (flags.json) {
    if (logger.json) logger.json(payload); else logger.log(JSON.stringify(payload, null, 2));
    return payload;
  }
  ui.sectionHeader('Resource Optimizer');
  ui.keyValue('Profile', `${plan.label} (${profile})`);
  ui.keyValue('Hardware', `${hardware.cpuModel} · ${hardware.cpuCores} logical CPU threads${hardware.gpu ? ` · ${hardware.gpu.name}` : ''}`);
  ui.keyValue('Memory', `${plan.totalMemGB} GB total · ${plan.freeMemGB} GB free · ${plan.reserveGB} GB reserved for the system`);
  ui.keyValue('Safe engine budget', `${plan.budgetGB} GB`);
  ui.keyValue('Recommended launch', `context ${plan.ctxSize} · threads ${plan.threads} · GPU layers ${plan.gpuLayers}`);
  if (entry) ui.keyValue('Selected model', entry.id);
  if (plan.warning) ui.warning('Memory pressure risk', plan.warning);
  ui.nextSteps([
    `Serve with this profile: lehrosol vault serve --model <name> --resourceProfile ${profile}`,
    'Use Eco when multitasking; use Balanced for normal work; use Performance only with comfortable free memory.',
  ]);
  return payload;
}
