// Resource planner — conservative local-engine settings from live hardware.
// It never allocates RAM itself. Instead it reserves OS headroom and chooses
// context/thread/offload settings that reduce memory pressure before launch.

const round1 = (n) => Math.round(n * 10) / 10;

export const RESOURCE_PROFILES = Object.freeze({
  eco: { reserveFraction: 0.26, minReserveGB: 3.5, maxContext: 2048, tokenBudget: 640, label: 'Eco' },
  balanced: { reserveFraction: 0.20, minReserveGB: 2.5, maxContext: 4096, tokenBudget: 1024, label: 'Balanced' },
  performance: { reserveFraction: 0.14, minReserveGB: 2.0, maxContext: 8192, tokenBudget: 1536, label: 'Performance' },
});

export function normalizeResourceProfile(value) {
  const profile = String(value || 'balanced').trim().toLowerCase();
  return Object.hasOwn(RESOURCE_PROFILES, profile) ? profile : 'balanced';
}

export function planResources(hw, fit = {}, profile = 'balanced') {
  const id = normalizeResourceProfile(profile);
  const policy = RESOURCE_PROFILES[id];
  const total = Number(hw?.totalMemGB || 0);
  const free = Number(hw?.freeMemGB || total);
  const reserveGB = round1(Math.max(policy.minReserveGB, total * policy.reserveFraction));
  const freeForEngineGB = round1(Math.max(1, free - reserveGB));
  const fitBudget = Number(fit?.budgetGB || total * 0.7);
  const budgetGB = round1(Math.min(fitBudget, freeForEngineGB));
  const requiredGB = Number(fit?.requiredGB || 0);
  const constrained = requiredGB > 0 && requiredGB > budgetGB;
  const ctxSize = constrained ? 2048 : Math.min(policy.maxContext, budgetGB < 5 ? 2048 : budgetGB < 9 ? 4096 : policy.maxContext);
  const baseThreads = Number(hw?.recommendedThreads || 1);
  const threads = id === 'eco' ? Math.max(1, Math.min(2, baseThreads)) : baseThreads;
  const gpuLayers = fit?.accelerated ? 999 : 0;
  const warning = constrained
    ? `Estimated working set ${requiredGB} GB exceeds the currently safe ${budgetGB} GB budget. Close memory-heavy apps, choose a smaller quant, or use Eco mode.`
    : null;
  return {
    profile: id,
    label: policy.label,
    totalMemGB: total,
    freeMemGB: free,
    reserveGB,
    budgetGB,
    requiredGB: requiredGB || null,
    ctxSize,
    threads,
    gpuLayers,
    constrained,
    warning,
    rationale: `Reserves ${reserveGB} GB for the system; ${budgetGB} GB is currently safe for the engine.`,
  };
}
