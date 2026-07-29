import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BIN = join(ROOT, 'bin', 'lehrosol.js');

async function runCli(args, opts = {}) {
  const home = opts.home || await mkdtemp(join(tmpdir(), 'lehro-test-home-'));
  return execFileAsync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, LEHRO_HOME: home, NO_COLOR: '1', CI: '1' },
    maxBuffer: 10 * 1024 * 1024,
  });
}

test('CLI supports --key=value and boolean false for --dryRun=false', async () => {
  const { stdout, stderr } = await runCli(['loop', 'run', '--prompt=audit parser', '--agentAdapter=local', '--dryRun=false', '--maxIterations=2', '--owaspScope=llm']);
  assert.match(stdout, /Dry Run\s+no \(real agent calls\)/);
  assert.match(stdout, /\[1\/2\]/);
  assert.doesNotMatch(stderr, /ExperimentalWarning/);
});

test('doctor output is not polluted by node:sqlite ExperimentalWarning', async () => {
  const { stdout, stderr } = await runCli(['doctor']);
  assert.match(stdout, /PROJECT DOCTOR/);
  assert.doesNotMatch(stderr, /ExperimentalWarning/);
});

test('sessions show reads nested SQLite checkpoint score data correctly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'lehro-test-home-'));
  const run = await runCli(['loop', 'run', '--prompt=session score', '--agentAdapter=local', '--maxIterations=2', '--owaspScope=llm'], { home });
  const match = /Session ID:\s+([0-9a-f-]+)/i.exec(run.stdout);
  assert.ok(match, 'loop output should include a session id');
  const show = await runCli(['sessions', 'show', '--id', match[1]], { home });
  assert.match(show.stdout, /95\/80|100\/80/);
  assert.doesNotMatch(show.stdout, /-\/-/);
});

test('policy blocks default protected branches main and master', async () => {
  const main = await runCli(['policy', 'evaluate', '--branch=main', '--hasTests', '--reviewCount=1', '--owasp-scope=llm']);
  assert.match(main.stdout, /BLOCKED/);
  assert.match(main.stdout, /Branch Protection/);

  const master = await runCli(['policy', 'evaluate', '--branch=master', '--hasTests', '--reviewCount=1', '--owasp-scope=llm']);
  assert.match(master.stdout, /BLOCKED/);
  assert.match(master.stdout, /Branch Protection/);
});

test('OWASP scanner refuses files outside the project root', async () => {
  const project = await mkdtemp(join(tmpdir(), 'lehro-scan-project-'));
  const outside = await mkdtemp(join(tmpdir(), 'lehro-scan-outside-'));
  const outsideFile = join(outside, 'secret.js');
  await writeFile(outsideFile, 'const api_key = "sk-EXAMPLE123456789012345";\n');
  await mkdir(join(project, 'src'), { recursive: true });

  // Use pathToFileURL so dynamic import works on Windows too (a bare
  // absolute path like C:\... is rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME).
  const { scanOwaspBasics } = await import(pathToFileURL(join(ROOT, 'src', 'harness', 'owasp.js')).href);
  const findings = scanOwaspBasics({ cwd: project, files: [outsideFile], owaspScope: ['llm'] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'excessive-agency');
});
