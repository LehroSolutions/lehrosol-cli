import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const runner = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url));
const configUrl = new URL('../src/core/config.js', import.meta.url).href;

function runTests(args, cwd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  // This is a new runner, not another worker in the outer node:test run.
  delete env.NODE_TEST_CONTEXT;
  return execFileAsync(process.execPath, [runner, ...args], { cwd, env, timeout: 30000 });
}

test('test runner isolates workers, protects caller config, and cleans up after SQLite closes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lehro-runner-check-'));
  try {
    const config = join(dir, 'config.json');
    await writeFile(config, '{"sentinel":true}');
    const fixtures = [];
    for (const index of [0, 1]) {
      const fixture = join(dir, `worker-${index}.test.mjs`);
      const report = join(dir, `worker-${index}.json`);
      await writeFile(fixture, `
        import test from 'node:test';
        import { writeFileSync } from 'node:fs';
        import { LEHRO_HOME, saveAdapterConfig } from ${JSON.stringify(configUrl)};
        import { join } from 'node:path';
        let DatabaseSync;
        try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}
        test('isolated state', () => {
          saveAdapterConfig('test', { model: 'fixture' });
          if (DatabaseSync) new DatabaseSync(join(LEHRO_HOME, 'open.sqlite'));
          writeFileSync(${JSON.stringify(report)}, JSON.stringify({ home: LEHRO_HOME }));
        });
      `);
      fixtures.push(fixture);
    }
    await runTests(fixtures, dir, { LEHRO_HOME: dir });
    assert.equal(await readFile(config, 'utf8'), '{"sentinel":true}');
    const reports = await Promise.all([0, 1].map(async (index) => JSON.parse(await readFile(join(dir, `worker-${index}.json`), 'utf8'))));
    assert.notEqual(reports[0].home, reports[1].home);
    for (const report of reports) assert.equal(existsSync(report.home), false, 'worker state must be removed after exit');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('test runner preserves a failing test exit status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lehro-runner-failure-'));
  try {
    const fixture = join(dir, 'failure.test.mjs');
    await writeFile(fixture, "import test from 'node:test'; test('failure', () => { throw new Error('expected fixture failure'); });");
    await assert.rejects(runTests([fixture], dir), (err) => err.code === 1 && /expected fixture failure/.test(err.stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
