// Factory for a real agent-CLI adapter: detects the binary on PATH, shells
// out to it non-interactively with the caller's prompt via execFile (never a
// shell string, to avoid injection), then derives a policyInput for the
// Score Agent from the resulting git diff.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandExists, launchSpec, isGitRepo, unavailableResult, failureResult, successResult } from './shared.js';
import { getAdapterConfig } from '../../core/config.js';

const execFileAsync = promisify(execFile);

export function createCliAdapter(options) {
  const meta = { id: options.id, label: options.label, kind: 'cli', bin: options.bin, docs: options.docs || null, install: options.install || null, headless: options.headless || null };

  async function run(context) {
    const ctx = context || {};
    const cwd = ctx.cwd || process.cwd();
    const cfg = getAdapterConfig(meta.id);
    const envKey = 'LEHRO_' + meta.id.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_BIN';
    const bin = cfg.bin || process.env[envKey] || meta.bin;
    const runtimeMeta = Object.assign({}, meta, { bin });
    if (!commandExists(bin)) return unavailableResult(runtimeMeta, ctx);
    const beforeRef = isGitRepo(cwd) ? 'HEAD' : null;
    try {
      const args = options.buildArgs(ctx);
      const spec = launchSpec(bin, args);
      if (!spec.ok) return unavailableResult(runtimeMeta, ctx);
      const { stdout } = await execFileAsync(spec.file, spec.args, {
        cwd: cwd,
        timeout: ctx.timeoutMs || 180000,
        maxBuffer: 20 * 1024 * 1024,
        env: process.env
      });
      return successResult(runtimeMeta, cwd, beforeRef, stdout, ctx);
    } catch (err) {
      return failureResult(runtimeMeta, ctx, err);
    }
  }

  return { meta: meta, run: run };
}
