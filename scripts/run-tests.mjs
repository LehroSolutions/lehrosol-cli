import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'lehrosol-suite-'));
const args = process.argv.slice(2);
const hasTargets = args.some((arg) => !arg.startsWith('-')
  && (/\.test\.[cm]?js$/.test(arg) || existsSync(resolve(repoRoot, arg))));
const targets = hasTargets ? [] : readdirSync(join(repoRoot, 'test'))
  .filter((name) => name.endsWith('.test.js')).sort().map((name) => join('test', name));
try {
  const result = spawnSync(process.execPath, ['--import', './test/setup.mjs', '--test', ...args, ...targets], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, LEHRO_TEST_ROOT: root },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  catch (err) { console.warn(`Could not remove temporary test homes in ${root}: ${err.message}`); }
}
