# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 3.2.x (beta) | ✅ |
| ≤ 3.1.x | ❌ (GPL-era releases; upgrade to 3.2+) |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email `security@lehro.dev` (or open a private GitHub security advisory on this repository) with:

1. A description of the issue and its impact.
2. Steps to reproduce, or a proof-of-concept.
3. Any known mitigations.

You will get an acknowledgment within 72 hours and a status update at least every 7 days until the issue is resolved.

## Scope notes

LehroSol is a local-first developer tool; its main trust boundaries are:

- **MCP HTTP endpoint** (`lehrosol gui` / `startHttpServer`) — binds to `127.0.0.1` by default, rejects remote browser origins and DNS-rebinding hosts on loopback, accepts JSON requests, and enforces a 1 MB body cap. Network-facing bindings require bearer authentication through `--token` or `LEHRO_MCP_TOKEN`.
- **Adapter execution** — agent-CLI adapters shell out with `execFile` + argument arrays (never shell strings) to avoid prompt-driven shell injection; adapters must degrade gracefully when a binary is absent.
- **Path safety** — `src/core/pathSafety.js` guards against path escapes; weakening it silently is a security regression, not a refactor.
- **Secrets** — config values that look like API keys are never echoed back by tool outputs (see the `config_set` regression test).
