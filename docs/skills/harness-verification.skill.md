# Skill: Harness Verification

> ← [Skills index](README.md) · Full reference: [04 · Harness Engineering](../04-harness-engineering.md)

**Use this skill when:** adding a new policy rule, a new OWASP check, or a new scanner heuristic.

## Workflow

1. Read [04 · Harness Engineering](../04-harness-engineering.md) for the scoring flowchart and existing rule packs.
2. **Adding a policy rule** (non-OWASP, e.g. process/quality gate): add an entry to `POLICY_RULES` in `src/harness/policy.js` with `id`, `name`, `severity`, `category`, `autoFixable`, `fixSuggestion`, then a condition in `evaluatePolicy()` that pushes a `violation(...)`.
3. **Adding an OWASP check definition**: add it to the right scope's `checks` array in `OWASP_SCOPES` in `src/harness/owasp.js` (`llm`, `web`, or `asvs`).
4. **Adding a scanner heuristic** (a check that actually inspects file contents): add a regex + condition inside `scanOwaspBasics()` in `src/harness/owasp.js`, guarded by `inScope.has('<your-check-id>')` so it respects `--owasp-scope`.
5. Verify with a planted example, not just reasoning about the regex:
   ```bash
   printf 'your vulnerable pattern here' > /tmp/test-harness.js
   node bin/lehrosol.js policy evaluate --branch feature/x --files /tmp/test-harness.js --owasp-scope llm,web
   ```
   Confirm the violation actually appears in the output, and confirm a *clean* file does **not** trigger it (avoid false positives).
6. Run `node --check src/harness/policy.js src/harness/owasp.js`.
7. Update the tables in [04 · Harness Engineering](../04-harness-engineering.md) and regenerate docs (`npm run docs:build`).

## Common pitfalls

- Regex heuristics that are too broad (flag legitimate code) or too narrow (miss the real-world variants) — always test both a matching and a non-matching example.
- Forgetting that `owaspFindings` severity `warning` vs `error` changes whether it blocks (`violations`) or just informs (`warnings`) — see the scoring flowchart.
- Changing `CAPABILITY_TIER_PASS_BAR` without checking its effect on existing `--capabilityTier` usages in [03 · Loop Engineering](../03-loop-engineering.md).
