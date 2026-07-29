// Model Vault — the drive is the source of truth for local models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { parseQuant, scanVault, findLlamaServer, resolveVaultModel, recommendLaunch } = await import('../src/core/modelVault.js');
const { resolveCommand } = await import('../src/loop/adapters/shared.js');
const { classifyGpuName, rateModelFit, recommendThreads } = await import('../src/core/hardware.js');
const { runVaultCommand } = await import('../src/commands/vault.js');

// Mirrors a real Jan data folder: models under llamacpp/models/<name>/ and a
// bundled llama-server binary under llamacpp/backends/**.
function makeVault() {
  const root = mkdtempSync(join(tmpdir(), 'lehro-vault-'));
  const models = join(root, 'llamacpp', 'models');
  mkdirSync(join(models, 'alpha-7b-Q4_K_M'), { recursive: true });
  writeFileSync(join(models, 'alpha-7b-Q4_K_M', 'model.gguf'), Buffer.alloc(2048));
  mkdirSync(join(models, 'beta'), { recursive: true });
  writeFileSync(join(models, 'beta', 'beta-9b-IQ4_XS-00001-of-00002.gguf'), Buffer.alloc(1024));
  writeFileSync(join(models, 'beta', 'beta-9b-IQ4_XS-00002-of-00002.gguf'), Buffer.alloc(1024));
  mkdirSync(join(models, 'gemma-vision-Q2_K_XL'), { recursive: true });
  writeFileSync(join(models, 'gemma-vision-Q2_K_XL', 'model.gguf'), Buffer.alloc(512));
  writeFileSync(join(models, 'gemma-vision-Q2_K_XL', 'mmproj.gguf'), Buffer.alloc(64));
  const binDir = join(root, 'llamacpp', 'backends', 'b6653', 'win-avx2-x64', 'build', 'bin');
  mkdirSync(binDir, { recursive: true });
  const bin = join(binDir, 'llama-server.exe');
  writeFileSync(bin, '#!/bin/sh\n');
  return { root, bin };
}

test('parseQuant reads quant tags from model names', () => {
  assert.equal(parseQuant('alpha-7b-Q4_K_M'), 'Q4_K_M');
  assert.equal(parseQuant('beta-9b-IQ4_XS-00001-of-00002'), 'IQ4_XS');
  assert.equal(parseQuant('gemma-4-E4B-it-qat-UD-Q2_K_XL'), 'Q2_K_XL');
  assert.equal(parseQuant('Ornith-1_0-9B-BF16-ASHQ1-4850'), 'BF16');
  assert.equal(parseQuant('no-quant-here'), null);
});

test('scanVault groups shards, attaches mmproj, names generic files by folder', () => {
  const { root } = makeVault();
  try {
    const entries = scanVault({ roots: [root] });
    assert.equal(entries.length, 3);
    const alpha = entries.find((e) => e.id === 'alpha-7b-Q4_K_M');
    assert.ok(alpha, 'generic model.gguf takes its folder name');
    assert.equal(alpha.quant, 'Q4_K_M');
    assert.equal(alpha.sizeBytes, 2048);
    const beta = entries.find((e) => e.id === 'beta-9b-IQ4_XS');
    assert.ok(beta, 'shards collapse into one entry');
    assert.equal(beta.shards, 2);
    assert.equal(beta.sizeBytes, 2048);
    assert.match(beta.path, /-00001-of-00002\.gguf$/);
    const gemma = entries.find((e) => e.id === 'gemma-vision-Q2_K_XL');
    assert.ok(gemma);
    assert.ok(gemma.mmprojPath, 'vision companion is attached');
    assert.ok(!entries.some((e) => /mmproj/i.test(e.id)), 'mmproj is not listed as a model');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('findLlamaServer discovers the engine binary bundled under a vault root', () => {
  const { root, bin } = makeVault();
  const savedEnv = process.env.LEHRO_LLAMACPP_BIN;
  delete process.env.LEHRO_LLAMACPP_BIN;
  try {
    const found = findLlamaServer({ roots: [root] });
    assert.ok(found, 'expected a llama-server discovery result');
    if (found.source !== 'path') {
      assert.equal(found.source, 'vault');
      assert.equal(found.bin, bin);
    }
  } finally {
    if (savedEnv !== undefined) process.env.LEHRO_LLAMACPP_BIN = savedEnv;
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveCommand accepts explicit file paths (vault-discovered binaries)', () => {
  const { root, bin } = makeVault();
  try {
    const res = resolveCommand(bin);
    assert.equal(res.ok, true);
    assert.equal(res.command, bin);
    assert.equal(resolveCommand(join(root, 'nope', 'missing-bin')).ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('resolveVaultModel matches by exact id, substring, then path', () => {
  const { root } = makeVault();
  try {
    const entries = scanVault({ roots: [root] });
    assert.equal(resolveVaultModel('alpha-7b-Q4_K_M', entries).id, 'alpha-7b-Q4_K_M');
    assert.equal(resolveVaultModel('beta', entries).id, 'beta-9b-IQ4_XS');
    assert.equal(resolveVaultModel('GEMMA', entries).id, 'gemma-vision-Q2_K_XL');
    assert.equal(resolveVaultModel('zzz-not-there', entries), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('recommendLaunch tunes context and GPU offload to the fit', () => {
  assert.deepEqual(recommendLaunch({ fit: 'great', accelerated: true }), { ctxSize: 8192, gpuLayers: 999 });
  assert.deepEqual(recommendLaunch({ fit: 'tight', accelerated: false }), { ctxSize: 4096, gpuLayers: 0 });
  assert.deepEqual(recommendLaunch({ fit: 'no-fit', accelerated: false }), { ctxSize: 2048, gpuLayers: 0 });
});

test('recommendLaunch adds a physical-core thread count when hardware is known', () => {
  assert.deepEqual(
    recommendLaunch({ fit: 'great', accelerated: false }, { recommendedThreads: 4 }),
    { ctxSize: 8192, gpuLayers: 0, threads: 4 },
  );
});

test('classifyGpuName tells integrated from dedicated adapters', () => {
  assert.deepEqual(classifyGpuName('Intel(R) UHD Graphics 620'), { vendor: 'intel', integrated: true });
  assert.deepEqual(classifyGpuName('NVIDIA GeForce RTX 3060'), { vendor: 'nvidia', integrated: false });
  assert.deepEqual(classifyGpuName('Intel(R) Arc(TM) A770 Graphics'), { vendor: 'intel', integrated: false });
  assert.equal(classifyGpuName(''), null);
});

test('integrated GPUs never inflate the memory budget or claim acceleration', () => {
  const hw = { totalMemGB: 8, gpu: { vendor: 'intel', name: 'Intel(R) UHD Graphics 620', vramGB: null, integrated: true } };
  const fit = rateModelFit(3 * 1024 ** 3, hw);
  assert.equal(fit.accelerated, false);
  assert.equal(fit.budgetGB, 5.6);
  assert.equal(fit.fit, 'tight');
});

test('recommendThreads targets physical cores on SMT machines', () => {
  assert.equal(recommendThreads(8), 4);
  assert.equal(recommendThreads(4), 2);
  assert.equal(recommendThreads(2), 2);
});

test('vault list --json reports roots, engine, and rated models', async () => {
  const { root } = makeVault();
  const savedDir = process.env.LEHRO_MODELS_DIR;
  process.env.LEHRO_MODELS_DIR = root;
  let captured = null;
  try {
    await runVaultCommand('list', { json: true }, { json: (obj) => { captured = obj; } });
    assert.ok(captured, 'expected JSON output');
    assert.ok(captured.roots.length >= 1);
    assert.ok(captured.models.length >= 3);
    assert.ok(captured.models.every((m) => typeof m.fit === 'string' && m.launch && m.launch.ctxSize > 0));
  } finally {
    if (savedDir !== undefined) process.env.LEHRO_MODELS_DIR = savedDir; else delete process.env.LEHRO_MODELS_DIR;
    rmSync(root, { recursive: true, force: true });
  }
});
