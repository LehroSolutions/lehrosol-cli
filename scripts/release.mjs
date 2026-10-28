#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRelease, verifyRelease } from '../src/core/releaseIntegrity.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, process.argv[2] || 'dist');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run release:prepare (npm supplies its cross-platform CLI path).');
mkdirSync(out, { recursive: true });
const staging = mkdtempSync(join(out, '.pack-'));
try {
  execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', staging], { cwd: root, stdio: 'inherit' });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const expected = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
  const files = readdirSync(staging).filter((name) => name.endsWith('.tgz'));
  if (files.length !== 1 || files[0] !== expected) throw new Error('npm pack did not produce the expected release tarball.');
  const artifact = join(out, expected);
  renameSync(join(staging, expected), artifact);
  const release = prepareRelease({ root, outDir: out, artifacts: [artifact] });
  if (!verifyRelease(out).ok) throw new Error('Release checksum verification failed.');
  console.log(JSON.stringify({ artifact, ...release }, null, 2));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
