import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRelease, sha256, verifyRelease } from '../src/core/releaseIntegrity.js';

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

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'lehrosol-integrity-'));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', license: 'MIT' }));
  const out = join(root, 'out'); mkdirSync(out);
  const artifact = join(out, 'package.tgz'); writeFileSync(artifact, 'verified');
  return { root, out, artifact };
}

test('release preparation refuses missing, directory, duplicate and reserved artifacts before writing metadata', (t) => {
  const { root, out, artifact } = fixture(t);
  for (const artifacts of [[artifact, 'missing.tgz'], [out], [artifact, artifact]]) {
    assert.throws(() => prepareRelease({ root, outDir: out, artifacts }), /missing|regular file|duplicate/);
    assert.equal(existsSync(join(out, 'release-manifest.json')), false);
  }
  const reserved = join(root, 'SHA256SUMS'); writeFileSync(reserved, 'preserved');
  assert.throws(() => prepareRelease({ root, outDir: out, artifacts: [reserved] }), /reserved/);
});

test('release verification detects omitted, duplicated and inconsistent manifest artifacts', (t) => {
  const { root, out, artifact } = fixture(t);
  const release = prepareRelease({ root, outDir: out, artifacts: [artifact] });
  assert.equal(verifyRelease(out).ok, true);
  const manifestPath = join(out, 'release-manifest.json');
  const original = release.manifest.artifacts[0];
  const variants = [[], [original, original], [{ ...original, name: 'missing.tgz' }], [{ ...original, sha256: '0'.repeat(64) }], [{ ...original, bytes: original.bytes + 1 }], [null]];
  for (const artifacts of variants) {
    writeFileSync(manifestPath, JSON.stringify({ ...release.manifest, artifacts }));
    assert.equal(verifyRelease(out).ok, false);
  }
  writeFileSync(manifestPath, '{bad json');
  assert.equal(verifyRelease(out).ok, false);
});

test('release verification refuses duplicate checksum entries', (t) => {
  const { out, artifact } = fixture(t);
  const line = `${sha256(artifact)}  package.tgz\n`;
  writeFileSync(join(out, 'SHA256SUMS'), line + line);
  assert.equal(verifyRelease(out).ok, false);
});

test('release artifacts cannot resolve through a symlink to outside files', (t) => {
  const { root, out } = fixture(t);
  const outside = join(root, 'outside.tgz'); writeFileSync(outside, 'outside');
  const linked = join(out, 'linked.tgz');
  try { symlinkSync(outside, linked, 'file'); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) { t.skip('Windows does not permit symlink creation for this process'); return; }
    throw error;
  }
  assert.throws(() => prepareRelease({ root, outDir: out, artifacts: [linked] }), /regular file/);
  writeFileSync(join(out, 'SHA256SUMS'), `${sha256(outside)}  linked.tgz\n`);
  assert.equal(verifyRelease(out).ok, false);
});
