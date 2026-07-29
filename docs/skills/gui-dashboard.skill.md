# Skill: GUI Dashboard

> ← [Skills index](README.md) · Full reference: [07 · GUI Dashboard](../07-gui-dashboard.md)

**Use this skill when:** adding a new panel to the GUI, or wiring a new MCP tool into it.

## Workflow

1. Read [07 · GUI Dashboard](../07-gui-dashboard.md) for the panel map and design tokens.
2. If you're exposing a **new** backend capability, add its MCP tool first (see [06 · MCP Control Plane](../06-mcp-control-plane.md)) so the GUI has something real to call — never mock data in the GUI layer.
3. Add a new `gui/src/components/<Name>Panel.jsx`, following the existing panels' shape: use `gui/src/lib/rpcClient.js` to call the MCP tool, render inside the shared `Panel.jsx` wrapper for the glass-panel/HUD styling.
4. Register the tab in `gui/src/App.jsx`.
5. Use only the design tokens already defined in `gui/tailwind.config.js` / `gui/src/styles.css` (`hud.bg`, `hud.panel`, `hud.border`, `hud.cyan`, `hud.green`, `hud.amber`, `hud.red`) — do not introduce new colors ad hoc, so the dashboard and the doc site (`docs/tools/build-docs.mjs` output) stay visually consistent.
6. Verify: `cd gui && npm install && npm run build` (requires internet access for the one-time `npm install`); also run `npx --no-install prettier --check gui/src/components/<Name>Panel.jsx` if a full install isn't available.
7. Update the panel map in [07 · GUI Dashboard](../07-gui-dashboard.md) and regenerate docs (`npm run docs:build`).

## Common pitfalls

- Adding a GUI-only code path that doesn't exist as a CLI command / MCP tool — breaks the "three surfaces, one function" rule in [`AGENTS.md`](../../AGENTS.md).
- Introducing a runtime dependency outside `gui/` — only the GUI is allowed npm packages.
- Forgetting `gui/vite.config.js`'s dev proxy target (`LEHRO_CONTROL_PLANE_URL`, default `http://localhost:4177`) when testing against a non-default MCP port.
