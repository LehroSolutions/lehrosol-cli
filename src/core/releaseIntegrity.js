import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';import{existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync}from'node:fs';import{basename,join,relative,resolve,sep}from'node:path';let CORE_LICENSE='Apache-2.0';try{const p=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));if(p&&typeof p.license==='string'&&p.license)CORE_LICENSE=p.license;}catch{}export function sha256(path){return createHash('sha256').update(readFileSync(path)).digest('hex');}function walk(dir,root=dir,out=[]){for(const n of readdirSync(dir)){if(['.git','node_modules','dist'].includes(n))continue;const f=join(dir,n),s=statSync(f);s.isDirectory()?walk(f,root,out):s.isFile()&&out.push(relative(root,f).replace(/\\/g,'/'));}return out;}export function generateSbom(root=process.cwd()){const p=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));return{bomFormat:'CycloneDX',specVersion:'1.5',version:1,metadata:{timestamp:new Date().toISOString(),component:{type:'application',name:p.name,version:p.version}},components:[{type:'application',name:p.name,version:p.version,licenses:[{license:{id:p.license}}]}]};}export function prepareRelease({root=process.cwd(),outDir,artifacts=[]}={}){root=resolve(root);const p=JSON.parse(readFileSync(join(root,'package.json'),'utf8')),dir=resolve(root,outDir||join('dist',`lehrosol-${p.version}`)),files=walk(root).sort(),paths=artifacts.map(a=>resolve(root,a)).filter(existsSync);mkdirSync(dir,{recursive:true});const manifest={name:p.name,version:p.version,generatedAt:new Date().toISOString(),node:process.version,sourceFiles:files.length,artifacts:paths.map(a=>({name:basename(a),sha256:sha256(a),bytes:statSync(a).size}))};writeFileSync(join(dir,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');writeFileSync(join(dir,'sbom.cdx.json'),JSON.stringify(generateSbom(root),null,2)+'\n');writeFileSync(join(dir,'provenance.intoto.jsonl'),JSON.stringify({_type:'https://in-toto.io/Statement/v1',subject:manifest.artifacts.map(a=>({name:a.name,digest:{sha256:a.sha256}})),predicateType:'https://slsa.dev/provenance/v1',predicate:{builder:{id:'lehrosol-cli/release'}}})+'\n');writeFileSync(join(dir,'SHA256SUMS'),manifest.artifacts.map(a=>`${a.sha256}  ${a.name}`).join('\n')+(paths.length?'\n':''));return{outDir:dir,manifest,files:['release-manifest.json','sbom.cdx.json','provenance.intoto.jsonl','SHA256SUMS']};}export function verifyRelease(dir) {
  dir = resolve(dir);
  const file = join(dir, 'SHA256SUMS');
  if (!existsSync(file)) return { ok: false, reason: 'SHA256SUMS not found', checked: [] };
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { ok: false, reason: 'SHA256SUMS contains no artifacts', checked: [] };
  const checked = lines.map((line) => {
    const match = /^([a-f0-9]{64})\s{2}(.+)$/.exec(line);
    if (!match) return { file: line, ok: false };
    const name = match[2];
    const path = resolve(dir, name);
    if (/[\\/]/.test(name) || !path.startsWith(dir + sep)) return { file: name, ok: false, reason: 'Artifact must be a filename inside the release directory' };
    try {
      const actual = existsSync(path) && statSync(path).isFile() ? sha256(path) : null;
      return { file: name, expected: match[1], actual, ok: actual === match[1] };
    } catch {
      return { file: name, expected: match[1], actual: null, ok: false };
    }
  });
  return { ok: checked.every((entry) => entry.ok), checked };
}
export function homebrewFormula({version,url,checksum,license=CORE_LICENSE}){if(!version||!url||!checksum)throw new Error('Formula requires version, url, checksum.');return`class Lehrosol < Formula\n  desc \"Unified agentic engineering console\"\n  homepage \"https://github.com/lehrosolutions/lehrosol-cli\"\n  url \"${url}\"\n  version \"${version}\"\n  sha256 \"${checksum}\"\n  license \"${license}\"\n  depends_on \"node@20\"\n  def install\n    libexec.install Dir[\"*\"]\n    bin.install_symlink libexec/\"bin/lehrosol.js\" => \"lehrosol\"\n  end\n  test do\n    assert_match version.to_s, shell_output(\"#{bin}/lehrosol --version\")\n  end\nend\n`;}export function signArtifact(path,{output=`${path}.asc`}={}){execFileSync('gpg',['--batch','--yes','--armor','--detach-sign','--output',output,path],{stdio:'inherit'});return{signed:true,artifact:path,signature:output};}
