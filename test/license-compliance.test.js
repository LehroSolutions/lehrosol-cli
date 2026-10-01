import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GPL_RE = /\bA?GPL\b/i;

// A GPL token is tolerated on a line that is itself explaining the relicense —
// the comments recording "this used to say GPL before 3.2.0" are the fix, not
// the bug. A shipped license string never reads like that.
const HISTORY_RE = /relicens|outlived|superseded|hardcoded/i;

const SCAN_DIRS = ['src', 'gui/src', 'docs/tools', 'bin', 'scripts', 'extensions', 'packaging'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.yml', '.yaml', '.rb', '.sh', '.ps1', '.toml']);

// Sanctioned carve-outs. docs/12-adr.md is the ADR ledger, so superseded
// ADR-0002 keeps its original text; the other docs pages that still mention the
// GPL era are pinned by their own dedicated tests below, which sweep the parts
// that describe LehroSol itself. Generated .html/.json are excluded on purpose:
// they are rebuilt by `npm run docs:build` from docs/tools/build-docs.mjs, which
// is in scope, so sweeping output would only make the test order-dependent.
const CARVE_OUT = new Set([
  'docs/12-adr.md',
  'docs/01-architecture.md',
  'docs/02-competitors.md',
]);

function extname(p) {
  const base = p.replace(/\\/g, '/').slice(p.replace(/\\/g, '/').lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
}

function rel(p) {
  return relative(ROOT, p).replace(/\\/g, '/');
}

async function walk(dir, exts, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, exts, out);
    else if (entry.isFile() && exts.has(extname(entry.name))) out.push(full);
  }
  return out;
}

async function gplHits(files) {
  const hits = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    for (const line of lines) {
      if (GPL_RE.test(line) && !HISTORY_RE.test(line)) hits.push(`${rel(file)}: ${line.trim().slice(0, 100)}`);
    }
  }
  return hits;
}

test('relicense surfaces carry no GPL identifier (ADR-0012 regression guard)', async () => {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = join(ROOT, dir);
    if (await stat(full).then((s) => s.isDirectory()).catch(() => false)) {
      files.push(...await walk(full, TEXT_EXT));
    }
  }
  files.push(...await walk(join(ROOT, 'docs'), new Set(['.md'])));

  const scanned = [...new Set(files.map(rel))].sort();
  assert.ok(scanned.length > 50, `sweep found only ${scanned.length} files — refusing to pass vacuously`);
  for (const dir of SCAN_DIRS) {
    assert.ok(scanned.some((f) => f.startsWith(`${dir}/`)), `scan scope must include ${dir}/`);
  }
  for (const must of ['docs/01-architecture.md', 'docs/02-competitors.md', 'docs/12-adr.md', 'gui/src/App.jsx', 'src/marketplace/catalog.js', 'src/core/ui.js', 'docs/tools/build-docs.mjs']) {
    assert.ok(scanned.includes(must), `scan scope must include ${must}`);
  }

  const hits = (await gplHits(files)).filter((h) => !CARVE_OUT.has(h.slice(0, h.indexOf(': '))));
  assert.deepEqual(hits, [], `GPL identifier survived the relicense in:\n  ${hits.join('\n  ')}`);
});

test('competitors doc describes competitors in GPL but LehroSol in Apache-2.0', async () => {
  const relPath = 'docs/02-competitors.md';
  const text = await readFile(join(ROOT, relPath), 'utf8');
  const cut = text.search(/##\s+LehroSol[^\n]*differentiation/i);
  assert.notEqual(cut, -1, `${relPath} must keep a "LehroSol's differentiation" section`);

  assert.match(text.slice(0, cut), GPL_RE, 'the competitor table should still record third-party GPL/AGPL tools');
  assert.doesNotMatch(text.slice(cut), GPL_RE, `${relPath} must not advertise LehroSol as GPL`);
  assert.match(text.slice(cut), /Apache-2\.0/, `${relPath} must state the current Apache-2.0 positioning`);
});

test('architecture roadmap does not assert the superseded GPL license', async () => {
  const text = await readFile(join(ROOT, 'docs/01-architecture.md'), 'utf8');
  assert.doesNotMatch(text, GPL_RE);
});

test('docs/12-adr.md keeps the superseded ADR-0002 history intact', async () => {
  const text = await readFile(join(ROOT, 'docs/12-adr.md'), 'utf8');
  assert.match(text, /ADR-0002[^\n]*GPL-3\.0-or-later[^\n]*superseded by ADR-0012/);
  assert.match(text, /^## ADR-0012 .*Apache-2\.0/m);
  assert.match(text, /\*\*Decision\*\*: Relicense the entire repository under \*\*Apache License 2\.0\*\*/);
});

test('LICENSE is verbatim Apache 2.0 and NOTICE ships with it', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.license, 'Apache-2.0');
  assert.ok(pkg.files.includes('LICENSE'), 'LICENSE must be published');
  assert.ok(pkg.files.includes('NOTICE'), 'NOTICE must be published');

  const license = await stat(join(ROOT, 'LICENSE'));
  const notice = await stat(join(ROOT, 'NOTICE'));
  assert.ok(license.size > 10_000, `LICENSE looks like a placeholder (${license.size} bytes)`);
  assert.ok(notice.size > 200, `NOTICE looks like a placeholder (${notice.size} bytes)`);

  const licenseText = await readFile(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(licenseText, /Apache License/);
  assert.match(licenseText, /Version 2\.0, January 2004/);
  assert.match(licenseText, /http:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0/);
  assert.doesNotMatch(licenseText, GPL_RE);

  const noticeText = await readFile(join(ROOT, 'NOTICE'), 'utf8');
  assert.match(noticeText, /Lehro/i);
  assert.doesNotMatch(noticeText, GPL_RE);
});

test('shipped license strings are derived from package.json, not hardcoded', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

  const catalog = await import('../src/marketplace/catalog.js');
  for (const item of catalog.listCatalog()) {
    if (item.source !== 'bundled') continue;
    assert.equal(item.license, pkg.license, `bundled first-party artifact "${item.id}" must be ${pkg.license}`);
  }

  const { homebrewFormula } = await import('../src/core/releaseIntegrity.js');
  const formula = homebrewFormula({ version: pkg.version, url: 'https://example.invalid/a.tgz', checksum: '0'.repeat(64) });
  assert.match(formula, new RegExp(`license "${pkg.license}"`));
  assert.doesNotMatch(formula, GPL_RE);

  const { stdout } = await new Promise((res, rej) => {
    execFile(process.execPath, [join(ROOT, 'bin', 'lehrosol.js'), '--help'], {
      cwd: ROOT,
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
      maxBuffer: 5 * 1024 * 1024,
    }, (err, so) => (err ? rej(err) : res({ stdout: so })));
  });
  assert.match(stdout, new RegExp(`v${pkg.version.replace(/\./g, '\\.')} . ${pkg.license.replace(/\./g, '\\.')}.`), 'CLI banner must display the package.json license');
  assert.doesNotMatch(stdout, GPL_RE);
});
