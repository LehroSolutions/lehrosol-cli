# Skill: Docs Authoring

> ← [Skills index](README.md) · Full reference: [docs/README.md](../README.md)

**Use this skill when:** adding or updating any file under `docs/`, so it matches this design system and its `.json`/`.html` counterparts stay in sync.

## Workflow

1. Write/edit the `.md` source only — `.json` and `.html` are always generated, never hand-edited.
2. Every doc should open with a breadcrumb line: `> ← [Previous doc](...) · [Docs home](../README.md) · Next: [Next doc](...)`, and close with a `## See also` section linking related docs — this is the "ultra-link" pattern used throughout `docs/`: every page reachable from every other related page, not just from the index.
3. Prefer at least one Mermaid diagram per substantial doc. Use this init line for visual consistency with the GUI's dark glass-HUD theme:
   ```
   %%{init: {'theme':'dark', 'themeVariables': {'primaryColor':'#0f1720','primaryTextColor':'#e6faff','primaryBorderColor':'#22d3ee','lineColor':'#22d3ee','secondaryColor':'#111827','tertiaryColor':'#05070a'}}}%%
   ```
4. After editing, regenerate the counterparts:
   ```bash
   npm run docs:build
   ```
   This runs `docs/tools/build-docs.mjs`, which walks every `.md` under `docs/` and writes a matching `.json` (structured: title, sections, mermaid diagram sources, related-doc links) and `.html` (dark-HUD themed, live Mermaid rendering via CDN, shared nav) next to it.
5. Spot-check: open the regenerated `.html` in a browser (or at minimum confirm it was written and contains a `<pre class="mermaid">` block for each diagram) and confirm the `.json` parses (`node -e "JSON.parse(require('fs').readFileSync('docs/<name>.json','utf8'))"`).
6. If you added a brand-new doc file, add it to the sitemap diagram and reading-order table in [docs/README.md](../README.md), and to [09 · Agents & Skills Map](../09-agents-and-skills.md) if it documents an agent-facing file or skill.

## Common pitfalls

- Forgetting the breadcrumb/`See also` links — breaks the "ultra-link" navigability that makes the doc set feel like one connected site instead of loose files.
- Editing a generated `.json`/`.html` directly — it will be silently overwritten next time `npm run docs:build` runs.
- Using a color outside the shared HUD palette (`#05070a`, `#22d3ee`, `#34d399`, `#fbbf24`, `#f87171`) in a diagram's `themeVariables`, breaking visual consistency with the GUI and the rest of the doc site.
