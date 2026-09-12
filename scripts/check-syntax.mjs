#!/usr/bin/env node
// Cross-platform syntax gate: `node --check` every .js/.mjs under bin/, src/,
// docs/tools/ and scripts/. Replaces the previous `find | xargs node --check`
// pipeline, which only worked on Unix shells and silently skipped the check on
// Windows — a first-class target for this project.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIRS = ['bin', 'src', join('docs', 'tools'), 'scripts'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = TARGET_DIRS.flatMap((dir) => {
  const full = join(ROOT, dir);
  try {
    return statSync(full).isDirectory() ? walk(full) : [];
  } catch {
    return []; // optional dir missing — nothing to check
  }
});

if (files.length === 0) {
  console.error('check-syntax: no .js/.mjs files found to check — refusing to pass vacuously');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failed += 1;
    console.error('Syntax error in ' + relative(ROOT, file) + ':\n' + String((err && err.stderr) || err.message || err));
  }
}

if (failed) {
  console.error(`\n${failed} of ${files.length} file(s) failed node --check`);
  process.exit(1);
}
console.log(`node --check OK — ${files.length} files (bin, src, docs/tools, scripts)`);
