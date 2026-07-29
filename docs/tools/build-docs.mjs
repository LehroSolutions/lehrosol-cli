#!/usr/bin/env node
// Dependency-free docs generator for LehroSol CLI.
// Walks docs/**/*.md, extracts a structured model, and writes a sibling
// .json (structured data for tools/agents) and .html (HELIX glass-HUD themed,
// live-Mermaid-rendering, cross-linked, with on-page TOC + scroll-spy + copy
// buttons + reading-progress + prev/next nav + client-side sidebar filter).
// Run: npm run docs:build  ==  node docs/tools/build-docs.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, "..");

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "tools") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, href) => {
    const isExternal = /^https?:\/\//.test(href);
    const hrefOut = href.replace(/\.md(#|$)/, ".html$1");
    const attrs = isExternal ? ' target="_blank" rel="noopener"' : "";
    return `<a href="${hrefOut}"${attrs}>${txt}</a>`;
  });
  return t;
}

function splitTableRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((s) => s.trim());
}

function parseModel(content) {
  const lines = content.split("\n");
  let title = null;
  for (const line of lines) {
    const m = /^#\s+(.*)$/.exec(line);
    if (m) {
      title = m[1].trim();
      break;
    }
  }
  const sections = [];
  for (const line of lines) {
    const m2 = /^(#{2,3})\s+(.*)$/.exec(line);
    if (m2) {
      sections.push({ level: m2[1].length, heading: m2[2].trim(), id: slugify(m2[2].trim()) });
    }
  }
  const mermaidDiagrams = [];
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  let mm;
  while ((mm = mermaidRegex.exec(content))) mermaidDiagrams.push(mm[1].trim());

  const links = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lm;
  while ((lm = linkRegex.exec(content))) links.push({ text: lm[1], href: lm[2] });
  const relatedDocs = links.filter((l) => l.href.endsWith(".md") || l.href.includes(".md#"));

  let description = "";
  let sawTitle = false;
  for (const line of lines) {
    if (/^#\s+/.test(line)) {
      sawTitle = true;
      continue;
    }
    if (!sawTitle) continue;
    if (/^>/.test(line)) continue;
    if (line.trim() === "") continue;
    if (/^#{2,6}\s+/.test(line)) break;
    description = line.trim();
    break;
  }
  const words = content.replace(/```[\s\S]*?```/g, " ").split(/\s+/).filter(Boolean).length;
  const readingMinutes = Math.max(1, Math.round(words / 200));
  return { title: title || "Untitled", description, sections, mermaidDiagrams, links, relatedDocs, words, readingMinutes };
}

function mdToHtml(content) {
  const lines = content.split("\n");
  const html = [];
  let i = 0;
  let firstH1Seen = false;
  while (i < lines.length) {
    const line = lines[i];

    const fenceMatch = /^```(\w*)\s*$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      if (lang === "mermaid") {
        html.push(`<div class="diagram-wrap"><pre class="mermaid">\n${escapeHtml(codeLines.join("\n"))}\n</pre></div>`);
      } else {
        html.push(`<div class="code-wrap" data-lang="${escapeAttr(lang || "text")}"><pre><code class="language-${lang || "text"}">${escapeHtml(codeLines.join("\n"))}</code></pre></div>`);
      }
      continue;
    }

    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      // The first blockquote right under the H1 is the breadcrumb nav.
      const cls = firstH1Seen && html.filter((h) => h.startsWith("<blockquote")).length === 0 ? "breadcrumb" : "callout";
      html.push(`<blockquote class="${cls}">${inline(q.join(" "))}</blockquote>`);
      continue;
    }

    const hMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2].trim();
      const id = slugify(text);
      if (level === 1) {
        firstH1Seen = true;
        html.push(`<h1 id="${id}">${inline(text)}</h1>`);
      } else {
        html.push(`<h${level} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to section">#</a>${inline(text)}</h${level}>`);
      }
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      html.push("<hr/>");
      i++;
      continue;
    }

    if (/^\|.*\|$/.test(line.trim()) && i + 1 < lines.length && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/.test(lines[i + 1].trim())) {
      const headerCells = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      html.push(
        '<div class="table-wrap"><table><thead><tr>' +
          headerCells.map((c) => `<th>${inline(c)}</th>`).join("") +
          "</tr></thead><tbody>" +
          rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
          "</tbody></table></div>"
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        let itemText = lines[i].replace(/^[-*]\s+/, "");
        const todoMatch = /^\[( |x|X)\]\s+(.*)$/.exec(itemText);
        if (todoMatch) {
          const checked = todoMatch[1].toLowerCase() === "x";
          items.push(`<li class="todo"><input type="checkbox" disabled ${checked ? "checked" : ""}/> ${inline(todoMatch[2])}</li>`);
        } else {
          items.push(`<li>${inline(itemText)}</li>`);
        }
        i++;
      }
      html.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      html.push("<ol>" + items.join("") + "</ol>");
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    {
      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^#{1,6}\s+/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^\d+\.\s+/.test(lines[i]) &&
        !/^\|.*\|$/.test(lines[i].trim()) &&
        !/^-{3,}$/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      html.push(`<p>${inline(paraLines.join(" "))}</p>`);
    }
  }
  return html.join("\n");
}

const STYLE = `
  :root {
    --bg:#04060a; --bg2:#070b12; --panel:rgba(13,20,30,0.72); --panel-solid:#0b1119;
    --line:rgba(56,189,248,0.16); --line-strong:rgba(56,189,248,0.34);
    --cyan:#22d3ee; --teal:#2dd4bf; --green:#34d399; --amber:#fbbf24; --violet:#a78bfa; --blue:#38bdf8; --red:#f87171;
    --text:#e7f6fc; --dim:#9fb8c6; --muted:#657a8b; --faint:#3a4a5a;
    --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --sans:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    --radius:14px; --sidebar-w:300px; --toc-w:220px;
  }
  * { box-sizing:border-box; }
  html { scroll-behavior:smooth; scroll-padding-top:32px; }
  body { margin:0; font-family:var(--sans); color:var(--text); line-height:1.65; font-size:15.5px;
    background:
      radial-gradient(1100px 520px at 12% -8%, rgba(34,211,238,0.10), transparent 55%),
      radial-gradient(1000px 620px at 100% 0%, rgba(167,139,250,0.09), transparent 50%),
      radial-gradient(900px 700px at 50% 120%, rgba(52,211,153,0.07), transparent 55%),
      var(--bg);
    background-attachment:fixed; min-height:100vh;
  }
  a { color:var(--cyan); text-decoration:none; }
  a:hover { text-decoration:underline; }

  /* reading progress */
  #progress { position:fixed; top:0; left:0; height:2px; width:0%; z-index:60;
    background:linear-gradient(90deg,var(--cyan),var(--teal),var(--green)); box-shadow:0 0 10px rgba(34,211,238,0.6); transition:width .1s linear; }

  .layout { display:grid; grid-template-columns:var(--sidebar-w) minmax(0,1fr); align-items:start; }

  /* sidebar */
  nav.sidebar { position:sticky; top:0; height:100vh; overflow-y:auto; padding:22px 14px 40px;
    border-right:1px solid var(--line); background:linear-gradient(180deg, rgba(9,14,21,0.85), rgba(6,9,15,0.7)); backdrop-filter:blur(8px); }
  nav.sidebar::-webkit-scrollbar { width:8px; } nav.sidebar::-webkit-scrollbar-thumb { background:var(--line-strong); border-radius:8px; }
  .brand { display:flex; align-items:center; gap:10px; padding:6px 10px 14px; }
  .brand .logo { width:30px; height:30px; border-radius:9px; display:grid; place-items:center; font-size:16px;
    background:linear-gradient(135deg, rgba(34,211,238,0.22), rgba(45,212,191,0.14)); border:1px solid var(--line-strong); box-shadow:0 0 18px rgba(34,211,238,0.25); }
  .brand .name { font-weight:800; letter-spacing:.14em; text-transform:uppercase; font-size:12.5px;
    background:linear-gradient(90deg,var(--cyan),var(--teal)); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .brand .ver { font-family:var(--mono); font-size:10px; color:var(--muted); }
  .search { position:relative; margin:4px 6px 16px; }
  .search input { width:100%; padding:9px 12px 9px 30px; font-size:12.5px; color:var(--text); font-family:var(--sans);
    background:rgba(6,10,16,0.8); border:1px solid var(--line); border-radius:9px; outline:none; }
  .search input:focus { border-color:var(--line-strong); box-shadow:0 0 0 3px rgba(34,211,238,0.12); }
  .search svg { position:absolute; left:9px; top:50%; transform:translateY(-50%); width:13px; height:13px; opacity:.55; }
  .nav-group { margin:0 0 16px; }
  .nav-group .label { font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); padding:0 12px 6px; }
  nav.sidebar a.item { display:flex; align-items:center; gap:9px; padding:6px 10px; margin:1px 4px; border-radius:8px;
    color:var(--dim); font-size:13px; border:1px solid transparent; }
  nav.sidebar a.item:hover { background:rgba(34,211,238,0.08); color:var(--text); text-decoration:none; }
  nav.sidebar a.item.active { background:linear-gradient(90deg, rgba(34,211,238,0.16), rgba(34,211,238,0.03)); color:var(--cyan); border-color:var(--line); }
  nav.sidebar a.item .num { font-family:var(--mono); font-size:10.5px; min-width:20px; height:20px; display:grid; place-items:center;
    border-radius:6px; background:rgba(255,255,255,0.04); color:var(--muted); border:1px solid var(--line); }
  nav.sidebar a.item.active .num { background:rgba(34,211,238,0.18); color:var(--cyan); border-color:var(--line-strong); }
  .no-results { display:none; padding:10px 14px; color:var(--muted); font-size:12px; font-style:italic; }

  /* content shell */
  .content { padding:34px clamp(20px,4vw,64px) 80px; display:grid; grid-template-columns:minmax(0,1fr) var(--toc-w); gap:40px; align-items:start; max-width:1180px; }
  main.article { min-width:0; }

  /* hero */
  .hero { position:relative; margin-bottom:26px; padding:26px 30px; border-radius:var(--radius); overflow:hidden;
    background:linear-gradient(135deg, rgba(15,23,32,0.9), rgba(9,14,21,0.6)); border:1px solid var(--line); }
  .hero::before { content:""; position:absolute; inset:0; pointer-events:none;
    background:repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 4px); }
  .hero::after { content:""; position:absolute; right:-60px; top:-60px; width:220px; height:220px; border-radius:50%;
    background:radial-gradient(circle, rgba(34,211,238,0.18), transparent 65%); pointer-events:none; }
  .eyebrow { font-family:var(--mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--teal); margin-bottom:10px; }
  .hero h1 { margin:0 0 10px; font-size:2.05rem; line-height:1.18; letter-spacing:-0.01em;
    background:linear-gradient(92deg,#e7f6fc,var(--cyan) 60%,var(--teal)); -webkit-background-clip:text; background-clip:text; color:transparent; border:none; padding:0; }
  .hero .lede { color:var(--dim); font-size:15px; max-width:70ch; margin:0; }
  .meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
  .chip { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-family:var(--mono);
    padding:4px 10px; border-radius:999px; background:rgba(34,211,238,0.08); border:1px solid var(--line); color:var(--dim); }
  .chip b { color:var(--cyan); font-weight:600; }

  /* typography */
  main.article h1 { display:none; } /* title lives in hero */
  main.article h2 { font-size:1.5rem; margin:2.4em 0 .7em; padding-top:.5em; color:var(--text);
    border-top:1px solid var(--line); padding-top:1.2em; }
  main.article h2::before { content:""; display:inline-block; width:8px; height:8px; margin-right:10px; border-radius:2px;
    background:linear-gradient(135deg,var(--cyan),var(--teal)); box-shadow:0 0 10px rgba(34,211,238,0.6); vertical-align:middle; }
  main.article h3 { font-size:1.15rem; margin:1.8em 0 .5em; color:var(--green); }
  main.article h4 { font-size:1rem; color:var(--teal); margin:1.4em 0 .4em; }
  .anchor { opacity:0; margin-left:-1.1em; padding-right:.35em; color:var(--muted); font-weight:400; text-decoration:none; }
  h2:hover .anchor, h3:hover .anchor { opacity:1; }
  p, li, td, th { color:#dbeef6; }
  strong { color:#fff; }
  ul, ol { padding-left:1.35em; }
  li { margin:.28em 0; }
  li::marker { color:var(--cyan); }
  li.todo { list-style:none; margin-left:-1.1em; }

  /* breadcrumb + callouts */
  blockquote.breadcrumb { margin:0 0 22px; padding:9px 15px; font-size:12.5px; font-family:var(--mono);
    color:var(--dim); background:rgba(34,211,238,0.05); border:1px solid var(--line); border-radius:9px; }
  blockquote.callout { margin:1.4em 0; padding:14px 18px; border-radius:10px; color:var(--dim);
    background:linear-gradient(90deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02)); border:1px solid rgba(251,191,36,0.28); border-left:3px solid var(--amber); }

  /* code */
  .code-wrap { position:relative; margin:1.3em 0; }
  .code-wrap::after { content:attr(data-lang); position:absolute; top:8px; right:12px; font-family:var(--mono); font-size:10px;
    letter-spacing:.1em; text-transform:uppercase; color:var(--muted); pointer-events:none; }
  pre { margin:0; background:#060a10; border:1px solid var(--line); border-radius:11px; padding:18px 18px 16px; overflow-x:auto;
    font-family:var(--mono); font-size:13px; line-height:1.6; }
  pre code { background:none; border:none; padding:0; color:#cfeaf3; font-family:var(--mono); }
  code { background:rgba(34,211,238,0.1); border:1px solid var(--line); border-radius:5px; padding:1px 6px; font-size:.88em;
    color:var(--teal); font-family:var(--mono); }
  .copy-btn { position:absolute; top:7px; right:8px; font-family:var(--mono); font-size:10.5px; letter-spacing:.06em;
    padding:4px 9px; border-radius:7px; cursor:pointer; color:var(--dim); background:rgba(13,20,30,0.9);
    border:1px solid var(--line); opacity:0; transition:opacity .15s, color .15s; }
  .code-wrap:hover .copy-btn { opacity:1; }
  .copy-btn:hover { color:var(--cyan); border-color:var(--line-strong); }
  .copy-btn.copied { color:var(--green); border-color:rgba(52,211,153,0.5); }
  .diagram-wrap { margin:1.6em 0; padding:18px; border-radius:12px; text-align:center;
    background:radial-gradient(circle at 50% 0%, rgba(34,211,238,0.06), transparent 70%), rgba(8,12,19,0.6); border:1px solid var(--line); }
  pre.mermaid { background:none; border:none; padding:0; }

  /* tables */
  .table-wrap { overflow-x:auto; margin:1.4em 0; border:1px solid var(--line); border-radius:11px; }
  table { border-collapse:collapse; width:100%; font-size:.92em; }
  th, td { border-bottom:1px solid var(--line); padding:9px 14px; text-align:left; vertical-align:top; }
  thead th { background:rgba(34,211,238,0.09); color:var(--cyan); font-weight:600; letter-spacing:.02em;
    position:sticky; top:0; border-bottom:1px solid var(--line-strong); }
  tbody tr:hover { background:rgba(34,211,238,0.04); }
  tbody tr:last-child td { border-bottom:none; }

  hr { border:none; border-top:1px solid var(--line); margin:2.5em 0; }

  /* on-page TOC */
  aside.toc { position:sticky; top:24px; align-self:start; font-size:12.5px; max-height:calc(100vh - 48px); overflow-y:auto; }
  aside.toc .toc-label { font-size:10px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); margin-bottom:10px; padding-left:12px; }
  aside.toc a { display:block; padding:4px 12px; color:var(--muted); border-left:2px solid var(--line); margin:1px 0; line-height:1.4; }
  aside.toc a.sub { padding-left:24px; font-size:11.8px; }
  aside.toc a:hover { color:var(--dim); text-decoration:none; }
  aside.toc a.active { color:var(--cyan); border-left-color:var(--cyan); background:rgba(34,211,238,0.06); }

  /* prev/next */
  .pager { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:48px; }
  .pager a { display:flex; flex-direction:column; gap:4px; padding:16px 18px; border-radius:12px; text-decoration:none;
    background:var(--panel); border:1px solid var(--line); transition:border-color .15s, transform .15s; }
  .pager a:hover { border-color:var(--line-strong); transform:translateY(-2px); }
  .pager a.next { text-align:right; }
  .pager .dir { font-family:var(--mono); font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  .pager .t { color:var(--text); font-weight:600; font-size:14px; }

  footer.credit { margin-top:40px; padding-top:20px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }

  /* mobile */
  .menu-toggle { display:none; }
  @media (max-width:1080px) { .content { grid-template-columns:minmax(0,1fr); } aside.toc { display:none; } }
  @media (max-width:820px) {
    .layout { grid-template-columns:1fr; }
    nav.sidebar { position:fixed; z-index:50; width:86%; max-width:320px; transform:translateX(-102%); transition:transform .25s ease; box-shadow:0 0 60px rgba(0,0,0,0.6); }
    body.nav-open nav.sidebar { transform:translateX(0); }
    .menu-toggle { display:grid; place-items:center; position:fixed; z-index:55; top:12px; left:12px; width:42px; height:42px; border-radius:11px;
      background:var(--panel-solid); border:1px solid var(--line-strong); color:var(--cyan); font-size:18px; cursor:pointer; }
    .content { padding-top:64px; }
    .scrim { display:none; position:fixed; inset:0; z-index:45; background:rgba(0,0,0,0.5); }
    body.nav-open .scrim { display:block; }
  }
`;

function docNumber(rel) {
  const base = path.basename(rel);
  if (/^readme\.md$/i.test(base)) return "⌂";
  const m = /^(\d+)/.exec(base);
  return m ? m[1] : "◆";
}

function groupOf(rel) {
  const dir = path.dirname(rel);
  if (dir === ".") return "Guide";
  return dir.split(path.sep)[0];
}

function buildNav(catalog, currentFile) {
  const groups = [];
  const seen = new Map();
  for (const c of catalog) {
    const g = groupOf(c.rel);
    if (!seen.has(g)) { seen.set(g, []); groups.push(g); }
    seen.get(g).push(c);
  }
  const parts = [];
  for (const g of groups) {
    const items = seen.get(g).map((c) => {
      const rel = path.relative(path.dirname(currentFile), c.file).replace(/\.md$/, ".html");
      const active = c.file === currentFile ? " active" : "";
      const num = docNumber(c.rel);
      return `<a class="item${active}" href="${rel}" data-title="${escapeAttr(c.title.toLowerCase())}"><span class="num">${escapeHtml(num)}</span><span class="txt">${escapeHtml(c.title)}</span></a>`;
    }).join("\n    ");
    const label = g === "Guide" ? "Guide" : g.charAt(0).toUpperCase() + g.slice(1);
    parts.push(`<div class="nav-group"><div class="label">${escapeHtml(label)}</div>\n    ${items}\n  </div>`);
  }
  return parts.join("\n  ");
}

function buildToc(sections) {
  const usable = sections.filter((s) => s.level === 2 || s.level === 3);
  if (usable.length < 2) return "";
  const links = usable.map((s) => `<a class="${s.level === 3 ? "sub" : ""}" href="#${s.id}">${escapeHtml(s.heading)}</a>`).join("\n    ");
  return `<aside class="toc"><div class="toc-label">On this page</div>\n    ${links}\n  </aside>`;
}

function buildPager(catalog, idx, currentFile) {
  const mk = (c, dir) => {
    if (!c) return '<span></span>';
    const rel = path.relative(path.dirname(currentFile), c.file).replace(/\.md$/, ".html");
    return `<a class="${dir}" href="${rel}"><span class="dir">${dir === "next" ? "Next →" : "← Previous"}</span><span class="t">${escapeHtml(c.title)}</span></a>`;
  };
  const prev = idx > 0 ? catalog[idx - 1] : null;
  const next = idx < catalog.length - 1 ? catalog[idx + 1] : null;
  if (!prev && !next) return "";
  return `<div class="pager">${mk(prev, "prev")}${mk(next, "next")}</div>`;
}

const CLIENT_JS = [
  "(function(){",
  "  var bar=document.getElementById('progress');",
  "  function onScroll(){var h=document.documentElement;var max=h.scrollHeight-h.clientHeight;var p=max>0?(h.scrollTop/max)*100:0;if(bar)bar.style.width=p+'%';}",
  "  document.addEventListener('scroll',onScroll,{passive:true});onScroll();",
  "  // copy buttons",
  "  document.querySelectorAll('.code-wrap').forEach(function(w){var pre=w.querySelector('pre');if(!pre)return;var b=document.createElement('button');b.className='copy-btn';b.textContent='copy';b.addEventListener('click',function(){var t=pre.innerText;navigator.clipboard&&navigator.clipboard.writeText(t);b.textContent='copied';b.classList.add('copied');setTimeout(function(){b.textContent='copy';b.classList.remove('copied');},1400);});w.appendChild(b);});",
  "  // sidebar filter",
  "  var box=document.getElementById('nav-search');var empty=document.getElementById('no-results');",
  "  if(box){box.addEventListener('input',function(){var q=box.value.trim().toLowerCase();var any=false;document.querySelectorAll('nav.sidebar a.item').forEach(function(a){var hit=!q||a.getAttribute('data-title').indexOf(q)>-1;a.style.display=hit?'':'none';if(hit)any=true;});document.querySelectorAll('.nav-group').forEach(function(g){var vis=g.querySelectorAll('a.item:not([style*=\"none\"])').length;g.style.display=(!q||vis>0)?'':'none';});if(empty)empty.style.display=any?'none':'block';});}",
  "  // scroll spy for TOC",
  "  var tocLinks=Array.prototype.slice.call(document.querySelectorAll('aside.toc a'));",
  "  if(tocLinks.length){var map={};tocLinks.forEach(function(l){var id=l.getAttribute('href').slice(1);var el=document.getElementById(id);if(el)map[id]=l;});",
  "    var obs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){tocLinks.forEach(function(l){l.classList.remove('active');});var l=map[e.target.id];if(l)l.classList.add('active');}});},{rootMargin:'-10% 0px -75% 0px'});",
  "    Object.keys(map).forEach(function(id){var el=document.getElementById(id);if(el)obs.observe(el);});}",
  "  // mobile menu",
  "  var mt=document.getElementById('menu-toggle');var scrim=document.getElementById('scrim');",
  "  function close(){document.body.classList.remove('nav-open');}",
  "  if(mt)mt.addEventListener('click',function(){document.body.classList.toggle('nav-open');});",
  "  if(scrim)scrim.addEventListener('click',close);",
  "  document.querySelectorAll('nav.sidebar a.item').forEach(function(a){a.addEventListener('click',close);});",
  "})();",
].join("\n");

function renderPage({ model, bodyHtml, navHtml, tocHtml, pagerHtml, number }) {
  const desc = escapeAttr(model.description || "LehroSol CLI documentation");
  const eyebrow = number === "⌂" ? "Documentation" : (number === "◆" ? "Reference" : "Chapter " + number);
  const metaChips = [
    `<span class="chip"><b>${model.readingMinutes}</b> min read</span>`,
    `<span class="chip"><b>${model.sections.length}</b> sections</span>`,
    model.mermaidDiagrams.length ? `<span class="chip"><b>${model.mermaidDiagrams.length}</b> diagrams</span>` : "",
    model.relatedDocs.length ? `<span class="chip"><b>${model.relatedDocs.length}</b> links</span>` : "",
  ].filter(Boolean).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="description" content="${desc}"/>
<title>${escapeHtml(model.title)} · LehroSol CLI Docs</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%E2%97%88%3C/text%3E%3C/svg%3E"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>${STYLE}</style>
</head>
<body>
<div id="progress"></div>
<button id="menu-toggle" class="menu-toggle" aria-label="Toggle menu">☰</button>
<div id="scrim" class="scrim"></div>
<div class="layout">
<nav class="sidebar">
  <div class="brand">
    <div class="logo">◈</div>
    <div><div class="name">LehroSol</div><div class="ver">agentic engineering docs</div></div>
  </div>
  <div class="search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
    <input id="nav-search" type="text" placeholder="Filter docs…" autocomplete="off"/>
  </div>
  ${navHtml}
  <div id="no-results" class="no-results">No matching docs</div>
</nav>
<div class="content">
  <main class="article">
    <header class="hero">
      <div class="eyebrow">${escapeHtml(eyebrow)}</div>
      <h1>${escapeHtml(model.title)}</h1>
      ${model.description ? `<p class="lede">${inline(model.description)}</p>` : ""}
      <div class="meta">${metaChips}</div>
    </header>
    ${bodyHtml}
    ${pagerHtml}
    <footer class="credit"><span>LehroSol CLI · GPL-3.0 · free &amp; open source</span><span>Generated by docs/tools/build-docs.mjs</span></footer>
  </main>
  ${tocHtml}
</div>
</div>
<script>
  mermaid.initialize({ startOnLoad: true, theme: 'dark', themeVariables: { primaryColor: '#0f1720', primaryTextColor: '#e6faff', primaryBorderColor: '#22d3ee', lineColor: '#22d3ee', secondaryColor: '#111827', tertiaryColor: '#05070a', fontFamily: 'JetBrains Mono, monospace' } });
</script>
<script>
${CLIENT_JS}
</script>
</body>
</html>
`;
}

function orderCatalog(catalog) {
  // README first, then top-level numbered docs, then subdir docs; alpha within.
  return catalog.slice().sort((a, b) => {
    const ra = a.rel, rb = b.rel;
    const aReadme = /^readme\.md$/i.test(path.basename(ra)) && path.dirname(ra) === ".";
    const bReadme = /^readme\.md$/i.test(path.basename(rb)) && path.dirname(rb) === ".";
    if (aReadme !== bReadme) return aReadme ? -1 : 1;
    const aTop = path.dirname(ra) === ".";
    const bTop = path.dirname(rb) === ".";
    if (aTop !== bTop) return aTop ? -1 : 1;
    return ra.localeCompare(rb);
  });
}

function main() {
  const files = walk(DOCS_ROOT).sort();
  let catalog = files.map((f) => {
    const rel = path.relative(DOCS_ROOT, f);
    const content = fs.readFileSync(f, "utf8");
    const model = parseModel(content);
    return { file: f, rel, title: model.title };
  });
  catalog = orderCatalog(catalog);

  for (let idx = 0; idx < catalog.length; idx++) {
    const f = catalog[idx].file;
    const content = fs.readFileSync(f, "utf8");
    const model = parseModel(content);
    const jsonOut = {
      title: model.title,
      description: model.description,
      sourceFile: path.relative(DOCS_ROOT, f),
      readingMinutes: model.readingMinutes,
      wordCount: model.words,
      sections: model.sections,
      mermaidDiagrams: model.mermaidDiagrams,
      relatedDocs: model.relatedDocs,
      allLinks: model.links,
    };
    const jsonPath = f.replace(/\.md$/, ".json");
    fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2) + "\n", "utf8");

    const bodyHtml = mdToHtml(content);
    const navHtml = buildNav(catalog, f);
    const tocHtml = buildToc(model.sections);
    const pagerHtml = buildPager(catalog, idx, f);
    const htmlOut = renderPage({ model, bodyHtml, navHtml, tocHtml, pagerHtml, number: docNumber(catalog[idx].rel) });
    const htmlPath = f.replace(/\.md$/, ".html");
    fs.writeFileSync(htmlPath, htmlOut, "utf8");
    console.log(`built ${path.relative(DOCS_ROOT, jsonPath)} + ${path.relative(DOCS_ROOT, htmlPath)}`);
  }
  console.log(`\nDone. ${catalog.length} markdown files processed.`);
}

main();
