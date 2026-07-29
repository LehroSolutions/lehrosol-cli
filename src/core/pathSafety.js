// Path safety guard, generalized from gidevo-api-tool's core/pathSafety.ts.
// Ensures generated files, worktrees, and loop outputs cannot escape the
// project root unless the caller explicitly opts in.
import { resolve, relative, isAbsolute } from 'node:path';

export class PathSafetyError extends Error {
  constructor(message, attemptedPath) {
    super(message);
    this.name = 'PathSafetyError';
    this.attemptedPath = attemptedPath;
  }
}

/**
 * @param {string} targetPath
 * @param {string} root
 * @param  allowOutside?: boolean  [opts]
 */
export function assertInsideRoot(targetPath, root = process.cwd(), opts = {}) {
  const allowOutside = opts.allowOutside || process.env.LEHRO_ALLOW_UNSAFE_PATHS === '1';
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(root, targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);
  const escapes = rel.startsWith('..') || isAbsolute(rel);
  if (escapes && !allowOutside) {
    throw new PathSafetyError(
      `Refusing to write outside project root: ${resolvedTarget}. Pass --allow-outside-project or set LEHRO_ALLOW_UNSAFE_PATHS=1 to override.`,
      resolvedTarget,
    );
  }
  return resolvedTarget;
}
