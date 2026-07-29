// Local dry-run/demo adapter: invokes nothing, always "passes" so the Loop
// Engine, Score Agent, and orchestrator can be exercised without any
// external agent CLI installed. This is the default adapter.
export const meta = { id: 'local', label: 'Local (dry-run)', bin: null, docs: null };

export async function run(context) {
  const ctx = context || {};
  return {
    adapter: meta.id,
    available: true,
    summary: 'local adapter: no external agent invoked (dry-run/demo mode).',
    changedFiles: [],
    policyInput: { hasTests: true, secretScanPassed: true, reviewCount: 1, branch: 'lehro/loop', owaspScope: ctx.owaspScope || [] }
  };
}
