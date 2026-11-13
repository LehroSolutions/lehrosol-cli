import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { launchSpec } from '../src/loop/adapters/shared.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'lehrosol launch '));
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); rmSync(root, { recursive: true, force: true }); });
  return root;
}

const prompt = 'Preserve "quotes", %PATH%, !variables!, & operators | pipes\nand a new line';

test('explicit Node adapter entrypoints preserve prompt arguments without shell expansion', (t) => {
  const root = fixture(t);
  const entry = join(root, 'adapter.mjs');
  writeFileSync(entry, 'console.log(JSON.stringify(process.argv.slice(2)));');
  const spec = launchSpec(entry, [prompt]);
  assert.equal(spec.file, process.execPath);
  assert.deepEqual(JSON.parse(execFileSync(spec.file, spec.args, { encoding: 'utf8' })), [prompt]);
});

test('Windows npm adapter shims execute their Node entrypoint with literal arguments', { skip: process.platform !== 'win32' }, (t) => {
  const root = fixture(t);
  const folder = join(root, 'node_modules', '@fixture', 'adapter', 'bin'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'adapter.js'), 'console.log(JSON.stringify(process.argv.slice(2)));');
  const shim = join(root, 'adapter.cmd');
  writeFileSync(shim, '@ECHO OFF\r\n"node.exe" "%dp0%\\node_modules\\@fixture\\adapter\\bin\\adapter.js" %*\r\n');
  const spec = launchSpec(shim, [prompt]);
  assert.equal(spec.file, process.execPath);
  assert.deepEqual(JSON.parse(execFileSync(spec.file, spec.args, { encoding: 'utf8' })), [prompt]);
});

test('custom Windows shell wrappers fail before reparsing an adapter prompt', { skip: process.platform !== 'win32' }, (t) => {
  const root = fixture(t);
  const shim = join(root, 'custom.cmd'); writeFileSync(shim, '@echo %*\r\n');
  assert.throws(() => launchSpec(shim, [prompt]), /cannot safely preserve adapter arguments/);
});
