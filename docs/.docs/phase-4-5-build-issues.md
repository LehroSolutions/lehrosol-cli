# Phase 4/5 build issue log

## Bash completion interpolation

- **Failure:** `ReferenceError: COMP_WORDS is not defined` during the first completion-generator validation.
- **Cause:** JavaScript evaluated Bash `${COMP_WORDS[...]}` inside a template literal.
- **Fix:** emitted the Bash expression literally using escaped interpolation.
- **Verification:** Bash, Zsh, Fish, and PowerShell completion tests pass.

## Command router placement

- **Failure:** `lehrosol supervise plan --json` initially fell through to help.
- **Cause:** generated cases were inserted into the interactive switch, not the primary CLI switch, and referenced the wrong variables.
- **Fix:** corrected both interactive and direct command routing.
- **Verification:** supervisor and marketplace command smoke tests pass; full suite is green.

## Sandbox recovery

- **Failure:** the execution sandbox reset during a batch write.
- **Recovery:** restored the verified v1.2.0 artifact, reapplied changes in smaller verified stages, and reran all checks.
