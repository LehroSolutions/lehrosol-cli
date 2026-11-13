import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256, verifyRelease } from '../src/core/releaseIntegrity.js';

test('release verification rejects empty, escaping, missing and tampered artifacts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'lehrosol-integrity-'));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  const out = join(root, 'out'); mkdirSync(out);
  const checksums = join(out, 'SHA256SUMS');
  writeFileSync(checksums, '\n');
  assert.equal(verifyRelease(out).ok, false);
  const outside = join(root, 'outside.tgz'); writeFileSync(outside, 'outside');
  writeFileSync(checksums, `${sha256(outside)}  ../outside.tgz\n`);
  assert.equal(verifyRelease(out).ok, false);
  writeFileSync(checksums, `${sha256(outside)}  ..\\outside.tgz\n`);
  assert.equal(verifyRelease(out).ok, false);
  const artifact = join(out, 'package.tgz'); writeFileSync(artifact, 'verified');
  writeFileSync(checksums, `${sha256(artifact)}  package.tgz\n`);
  assert.equal(verifyRelease(out).ok, true);
  writeFileSync(artifact, 'tampered');
  assert.equal(verifyRelease(out).ok, false);
  rmSync(artifact);
  assert.equal(verifyRelease(out).ok, false);
});
