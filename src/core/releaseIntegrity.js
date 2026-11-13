import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

let CORE_LICENSE = 'Apache-2.0';
try {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  if (typeof pkg?.license === 'string' && pkg.license) CORE_LICENSE = pkg.license;
} catch {}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir, root = dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['.git', 'node_modules', 'dist'].includes(name)) continue;
    const file = join(dir, name), info = lstatSync(file);
    if (info.isDirectory()) walk(file, root, out);
    else if (info.isFile()) out.push(relative(root, file).replace(/\\/g, '/'));
  }
  return out;
}

export function generateSbom(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: pkg.name, version: pkg.version } },
    components: [{ type: 'application', name: pkg.name, version: pkg.version, licenses: [{ license: { id: pkg.license } }] }],
  };
}

export function prepareRelease({ root = process.cwd(), outDir, artifacts = [] } = {}) {
  root = resolve(root);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dir = resolve(root, outDir || join('dist', `lehrosol-${pkg.version}`));
  const paths = artifacts.map((artifact) => resolve(root, artifact));
  const names = new Set();
  for (const path of paths) {
    if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`Release artifact is missing or is not a regular file: ${path}`);
    const name = basename(path);
    if (/[\r\n]/.test(name) || names.has(name.toLowerCase())) throw new Error(`Invalid or duplicate release artifact filename: ${name}`);
    if (['sha256sums', 'release-manifest.json', 'sbom.cdx.json', 'provenance.intoto.jsonl'].includes(name.toLowerCase())) throw new Error(`Artifact filename is reserved for release metadata: ${name}`);
    names.add(name.toLowerCase());
  }
  const manifest = {
    name: pkg.name, version: pkg.version, generatedAt: new Date().toISOString(),
    node: process.version, sourceFiles: walk(root).length,
    artifacts: paths.map((path) => ({ name: basename(path), sha256: sha256(path), bytes: statSync(path).size })),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(dir, 'sbom.cdx.json'), JSON.stringify(generateSbom(root), null, 2) + '\n');
  writeFileSync(join(dir, 'provenance.intoto.jsonl'), JSON.stringify({
    _type: 'https://in-toto.io/Statement/v1',
    subject: manifest.artifacts.map((artifact) => ({ name: artifact.name, digest: { sha256: artifact.sha256 } })),
    predicateType: 'https://slsa.dev/provenance/v1', predicate: { builder: { id: 'lehrosol-cli/release' } },
  }) + '\n');
  writeFileSync(join(dir, 'SHA256SUMS'), manifest.artifacts.map((artifact) => `${artifact.sha256}  ${artifact.name}`).join('\n') + (paths.length ? '\n' : ''));
  return { outDir: dir, manifest, files: ['release-manifest.json', 'sbom.cdx.json', 'provenance.intoto.jsonl', 'SHA256SUMS'] };
}

export function verifyRelease(dir) {
  dir = resolve(dir);
  const file = join(dir, 'SHA256SUMS');
  if (!existsSync(file)) return { ok: false, reason: 'SHA256SUMS not found', checked: [] };
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { ok: false, reason: 'SHA256SUMS contains no artifacts', checked: [] };
  const names = new Set();
  const checked = lines.map((line) => {
    const match = /^([a-f0-9]{64})\s{2}(.+)$/.exec(line);
    if (!match) return { file: line, ok: false };
    const name = match[2];
    const path = resolve(dir, name);
    if (/[\\/]/.test(name) || !path.startsWith(dir + sep)) return { file: name, ok: false, reason: 'Artifact must be a filename inside the release directory' };
    if (names.has(name.toLowerCase())) return { file: name, ok: false, reason: 'Duplicate artifact filename' };
    names.add(name.toLowerCase());
    try {
      const actual = existsSync(path) && lstatSync(path).isFile() ? sha256(path) : null;
      return { file: name, expected: match[1], actual, ok: actual === match[1] };
    } catch {
      return { file: name, expected: match[1], actual: null, ok: false };
    }
  });
  if (!checked.every((entry) => entry.ok)) return { ok: false, checked };
  const manifestPath = join(dir, 'release-manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const remaining = new Map(checked.map((entry) => [entry.file, entry]));
      if (!Array.isArray(manifest?.artifacts) || manifest.artifacts.length !== checked.length) throw new Error('Artifact count differs');
      for (const artifact of manifest.artifacts) {
        const entry = remaining.get(artifact?.name);
        if (!entry || artifact.sha256 !== entry.actual || artifact.bytes !== statSync(join(dir, entry.file)).size) throw new Error('Artifact identity differs');
        remaining.delete(artifact.name);
      }
    } catch {
      return { ok: false, reason: 'Release manifest does not match the verified artifacts', checked };
    }
  }
  return { ok: true, checked };
}
export function homebrewFormula({version,url,checksum,license=CORE_LICENSE}){if(!version||!url||!checksum)throw new Error('Formula requires version, url, checksum.');return`class Lehrosol < Formula\n  desc \"Unified agentic engineering console\"\n  homepage \"https://github.com/lehrosolutions/lehrosol-cli\"\n  url \"${url}\"\n  version \"${version}\"\n  sha256 \"${checksum}\"\n  license \"${license}\"\n  depends_on \"node@20\"\n  def install\n    libexec.install Dir[\"*\"]\n    bin.install_symlink libexec/\"bin/lehrosol.js\" => \"lehrosol\"\n  end\n  test do\n    assert_match version.to_s, shell_output(\"#{bin}/lehrosol --version\")\n  end\nend\n`;}export function signArtifact(path,{output=`${path}.asc`}={}){execFileSync('gpg',['--batch','--yes','--armor','--detach-sign','--output',output,path],{stdio:'inherit'});return{signed:true,artifact:path,signature:output};}
