import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

test('docs generation produces portable links and deterministic output from CRLF sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lehro-docs-generation-'));
  const docs = join(root, 'docs');
  try {
    await mkdir(join(docs, 'tools'), { recursive: true });
    await mkdir(join(docs, 'skills'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', license: 'Apache-2.0' }));
    await copyFile(new URL('../docs/tools/build-docs.mjs', import.meta.url), join(docs, 'tools', 'build-docs.mjs'));
    const pages = ['README', '01-guide', 'skills/example'];
    for (const page of pages) {
      await writeFile(join(docs, `${page}.md`), `# ${page}\r\n\r\n## One\r\n\r\nHello.\r\n\r\n## Two\r\n\r\nMore.\r\n`);
    }
    const build = () => execFileAsync(process.execPath, [join(docs, 'tools', 'build-docs.mjs')], { timeout: 10000 });
    await build();
    const originals = new Map();
    for (const page of pages) {
      const jsonPath = join(docs, `${page}.json`);
      const json = await readFile(jsonPath, 'utf8');
      assert.equal(JSON.parse(json).sourceFile, `${page}.md`);
      originals.set(jsonPath, json);
      const htmlPath = join(docs, `${page}.html`);
      const html = await readFile(htmlPath, 'utf8');
      originals.set(htmlPath, html);
      assert.equal(html.includes('\r'), false);
      const localLinks = [...html.matchAll(/href="([^"#]+\.html)"/g)].map((match) => match[1]);
      assert.ok(localLinks.length >= pages.length, 'navigation must include all fixture pages');
      for (const link of localLinks) {
        assert.equal(link.includes('\\'), false, 'web links must use forward slashes on every OS');
        await readFile(resolve(dirname(htmlPath), link));
      }
    }
    await build();
    for (const [file, original] of originals) assert.equal(await readFile(file, 'utf8'), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
