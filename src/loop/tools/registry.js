// LehroSol CLI — Agent Tool Registry ("frontier tool calling")
// -----------------------------------------------------------------------------
// A zero-dependency, cwd-sandboxed tool surface that any adapter (HTTP model,
// MCP client, or custom) can expose to an LLM for function/tool calling. Every
// filesystem tool is guarded by assertInsideRoot() so a model can never read or
// write outside the project root. Shell execution is DENY-by-default and must be
// explicitly enabled with LEHRO_TOOLS_ALLOW_EXEC=1.
//
// The schema shape is OpenAI-compatible ({ type:'function', function:{...} }),
// which is also accepted by Ollama, NVIDIA NIM, vLLM, LM Studio, Groq, Together,
// Mistral, and most OpenAI-compatible gateways.
import {
  readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync,
} from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { assertInsideRoot } from '../../core/pathSafety.js';

const MAX_READ = 256 * 1024;
const MAX_WRITE = 1024 * 1024;
const MAX_LIST = 400;
const MAX_MATCHES = 100;
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.lehro']);

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI-compatible JSON schema)
// ---------------------------------------------------------------------------
export const TOOL_DEFS = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the project. Returns file contents (truncated if very large).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the project root.' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a text file inside the project. Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        content: { type: 'string', description: 'Full new file contents.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace the first (or all) occurrences of a literal string in a file. Safer than rewriting the whole file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        find: { type: 'string', description: 'Exact substring to replace.' },
        replace: { type: 'string', description: 'Replacement text.' },
        all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
      },
      required: ['path', 'find', 'replace'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries (files and folders) of a directory inside the project.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path relative to root (default ".").' } },
    },
  },
  {
    name: 'search_text',
    description: 'Recursively search project text files for a substring or regex and return matching lines.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring or JS regex source to search for.' },
        regex: { type: 'boolean', description: 'Treat query as a regular expression (default false).' },
        path: { type: 'string', description: 'Subdirectory to search (default ".").' },
      },
      required: ['query'],
    },
  },
  {
    name: 'git_diff',
    description: 'Return the current git diff against HEAD for the project (empty if not a git repo).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'run_tests',
    description: 'Run the project test suite (npm test) and return the tail of the output. May be slow.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project root. DENIED unless LEHRO_TOOLS_ALLOW_EXEC=1 is set.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Shell command to execute.' } },
      required: ['command'],
    },
  },
];

export function toolSchemas() {
  return TOOL_DEFS.map((d) => ({
    type: 'function',
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
}

export function toolNames() {
  return TOOL_DEFS.map((d) => d.name);
}

// ---------------------------------------------------------------------------
// Handlers (all bounded + sandboxed)
// ---------------------------------------------------------------------------
function handleRead(args, cwd) {
  const target = assertInsideRoot(String(args.path || ''), cwd);
  if (!existsSync(target)) throw new Error(`File not found: ${args.path} — call list_dir to discover the actual layout`);
  const raw = readFileSync(target, 'utf8');
  if (raw.length > MAX_READ) return raw.slice(0, MAX_READ) + `\n… [truncated ${raw.length - MAX_READ} bytes]`;
  return raw;
}

function handleWrite(args, cwd) {
  const content = String(args.content == null ? '' : args.content);
  if (content.length > MAX_WRITE) throw new Error(`content exceeds ${MAX_WRITE} byte cap`);
  const target = assertInsideRoot(String(args.path || ''), cwd);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return `Wrote ${content.length} bytes to ${args.path}`;
}

function handleEdit(args, cwd) {
  const target = assertInsideRoot(String(args.path || ''), cwd);
  if (!existsSync(target)) throw new Error(`File not found: ${args.path} — call list_dir to discover the actual layout`);
  const before = readFileSync(target, 'utf8');
  const find = String(args.find == null ? '' : args.find);
  if (!find) throw new Error('edit_file requires a non-empty "find"');
  if (!before.includes(find)) throw new Error(`No occurrence of the given "find" text in ${args.path} — read_file first and copy the exact text`);
  const replace = String(args.replace == null ? '' : args.replace);
  const after = args.all ? before.split(find).join(replace) : before.replace(find, replace);
  if (after.length > MAX_WRITE) throw new Error(`result exceeds ${MAX_WRITE} byte cap`);
  writeFileSync(target, after, 'utf8');
  const count = args.all ? before.split(find).length - 1 : 1;
  return `Edited ${args.path} (${count} replacement${count === 1 ? '' : 's'})`;
}

function handleList(args, cwd) {
  const target = assertInsideRoot(String(args.path || '.'), cwd);
  if (!existsSync(target)) throw new Error(`Directory not found: ${args.path || '.'} — call list_dir with "." for the project root`);
  const entries = readdirSync(target).slice(0, MAX_LIST).map((name) => {
    let kind = 'file';
    try { kind = statSync(join(target, name)).isDirectory() ? 'dir' : 'file'; } catch { /* ignore */ }
    return `${kind === 'dir' ? '[dir] ' : '      '}${name}`;
  });
  return entries.length ? entries.join('\n') : '(empty)';
}

function walkFiles(root, out, limit) {
  let stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop();
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (IGNORE_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) stack.push(full);
      else if (st.size <= MAX_READ) out.push(full);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function handleSearch(args, cwd) {
  const base = assertInsideRoot(String(args.path || '.'), cwd);
  const q = String(args.query || '');
  if (!q) throw new Error('search_text requires a "query"');
  const matcher = args.regex ? new RegExp(q) : null;
  const files = walkFiles(base, [], 2000);
  const matches = [];
  for (const file of files) {
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const hit = matcher ? matcher.test(lines[i]) : lines[i].includes(q);
      if (hit) {
        matches.push(`${relative(cwd, file).split(sep).join('/')}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        if (matches.length >= MAX_MATCHES) return matches.join('\n') + `\n… [capped at ${MAX_MATCHES} matches]`;
      }
    }
  }
  return matches.length ? matches.join('\n') : `No matches for ${q}`;
}

function handleGitDiff(_args, cwd) {
  try {
    return execSync('git diff HEAD', { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).slice(0, MAX_READ) || '(no changes)';
  } catch {
    return '(not a git repository or git unavailable)';
  }
}

function handleRunTests(_args, cwd) {
  try {
    const out = execSync('npm test', { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    return out.slice(-4000);
  } catch (e) {
    return `Tests failed or errored:\n${String(e.stdout || '').slice(-3000)}\n${String(e.stderr || e.message).slice(-1000)}`;
  }
}

function handleRunCommand(args, cwd) {
  if (process.env.LEHRO_TOOLS_ALLOW_EXEC !== '1') {
    // Throw (not return a string): executeTool maps throws to { ok:false } so
    // the completion-evidence gate can tell "verification attempted" from
    // "verification silently refused". Returning the notice as a successful
    // result let models cite it as if verification had happened.
    throw new Error('run_command is disabled on this machine. Verification by execution is unavailable — inspect the code instead and state plainly in your final answer that you could NOT run anything. Set LEHRO_TOOLS_ALLOW_EXEC=1 to enable shell execution.');
  }
  const command = String(args.command || '');
  if (!command) throw new Error('run_command requires a "command"');
  try {
    return execSync(command, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 }).slice(-4000);
  } catch (e) {
    return `Command failed:\n${String(e.stdout || '').slice(-2000)}\n${String(e.stderr || e.message).slice(-1000)}`;
  }
}

const HANDLERS = {
  read_file: handleRead,
  write_file: handleWrite,
  edit_file: handleEdit,
  list_dir: handleList,
  search_text: handleSearch,
  git_diff: handleGitDiff,
  run_tests: handleRunTests,
  run_command: handleRunCommand,
};

// ---------------------------------------------------------------------------
// Executor — returns { ok, output } and never throws.
// ---------------------------------------------------------------------------
export function executeTool(name, args = {}, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, output: `Unknown tool: ${name}` };
  try {
    return { ok: true, output: String(handler(args || {}, cwd, opts)) };
  } catch (e) {
    return { ok: false, output: `Error running ${name}: ${(e && e.message) || e}` };
  }
}

export const toolRegistry = { TOOL_DEFS, toolSchemas, toolNames, executeTool };
export default toolRegistry;
