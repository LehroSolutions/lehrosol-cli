#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRelease, verifyRelease } from '../src/core/releaseIntegrity.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, process.argv[2] || 'dist');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script with npm run release:prepare (npm supplies its cross-platform CLI path).');
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (revision.status !== 0) throw new Error('Release preparation requires an identifiable Git checkout.');
mkdirSync(out, { recursive: true });
const staging = mkdtempSync(join(out, '.pack-'));
try {
  execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', staging], { cwd: root, stdio: 'inherit' });
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const expected = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${pkg.version}.tgz`;
  const files = readdirSync(staging).filter((name) => name.endsWith('.tgz'));
  if (files.length !== 1 || files[0] !== expected) throw new Error('npm pack did not produce the expected release tarball.');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) throw new Error('Could not identify the release source state.');
  const dirty = Boolean(status.stdout.trim());
  if (process.env.CI && dirty) throw new Error('CI release preparation requires an unchanged source checkout after documentation generation.');
  const artifact = join(out, expected);
  renameSync(join(staging, expected), artifact);
  const release = prepareRelease({ root, outDir: out, artifacts: [artifact] });
  release.manifest.source = { revision: revision.stdout.trim(), dirty };
  writeFileSync(join(out, 'release-manifest.json'), JSON.stringify(release.manifest, null, 2) + '\n');
  if (!verifyRelease(out).ok) throw new Error('Release checksum verification failed.');
  console.log(JSON.stringify({ artifact, ...release }, null, 2));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
