import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { renderGallery } from "./render-gallery.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "superdoc-gallery-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const demos = ['first', 'second', 'history'].map((id) => ({
    id, title: id, description: id, screenshot: `${id}.png`, liveDemoUri: `/${id}/`,
    sourceUri: `https://example.com/${id}`, packageDirectory: id,
  }));
  demos[2].superdocVersionException = { version: '2.30.0-next.4', reason: 'Changes API prerelease' };
  await writeFile(path.join(root, 'demos.json'), JSON.stringify(demos));
  await mkdir(path.join(root, 'dist-landing'));
  await writeFile(path.join(root, 'dist-landing/index.html'), `
    <p class="site-version">SuperDoc v0.0.0</p>
    <!-- DEMO_CARDS:START --><!-- DEMO_CARDS:END -->
  `);
  for (const demo of demos) {
    const directory = path.join(root, demo.packageDirectory, 'node_modules/superdoc');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({
      version: demo.id === 'history' ? '2.30.0-next.4' : '2.29.0',
    }));
  }
  return { root, demos };
}

test('gallery keeps exempt demos visible while deriving its shared version from the stable demos', async (t) => {
  const { root } = await fixture(t);
  await renderGallery({ root, mode: 'production', output: 'index.html' });
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /SuperDoc v2\.29\.0/);
  assert.match(html, /<h2>history<\/h2>/);
  assert.match(html, /href="\/history\/"/);
  assert.match(html, /class="site-version">SuperDoc v2\.29\.0/);
  assert.deepEqual([...html.matchAll(/class="card-version"[^>]*>(.*?)<\/span>/g)].map((match) => match[1]), [
    'v2.29.0', 'v2.29.0', 'v2.30.0-next.4',
  ]);
});

test('local gallery labels remote demos from their manifests and includes legacy unversioned cards', async (t) => {
  const { root, demos } = await fixture(t);
  demos[0].localSourceDirectory = demos[0].packageDirectory;
  demos[1].versioned = false;
  await writeFile(path.join(root, 'demos.json'), JSON.stringify(demos));
  await writeFile(path.join(root, 'second/package.json'), JSON.stringify({ dependencies: { superdoc: '2.28.0' } }));
  await writeFile(path.join(root, 'history/package.json'), JSON.stringify({ dependencies: { superdoc: '2.30.0-next.4' } }));
  await renderGallery({ root, mode: 'local', output: 'index.html' });
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /class="site-version">SuperDoc v2\.29\.0/);
  assert.deepEqual([...html.matchAll(/class="card-version"[^>]*>(.*?)<\/span>/g)].map((match) => match[1]), [
    'v2.29.0', 'v2.28.0', 'v2.30.0-next.4',
  ]);
});

test('gallery still rejects mismatched stable demos and unexpected exception versions', async (t) => {
  const { root } = await fixture(t);
  const render = () => renderGallery({ root, mode: 'production', output: 'index.html' });
  await writeFile(path.join(root, 'first/node_modules/superdoc/package.json'), JSON.stringify({ version: '2.28.0' }));
  await assert.rejects(render(), /different SuperDoc versions/);
  await writeFile(path.join(root, 'first/node_modules/superdoc/package.json'), JSON.stringify({ version: '2.29.0' }));
  await writeFile(path.join(root, 'history/node_modules/superdoc/package.json'), JSON.stringify({ version: '2.30.0-next.5' }));
  await assert.rejects(render(), /expected exception version/);
});

test('removing the gallery exception restores strict version equality', async (t) => {
  const { root, demos } = await fixture(t);
  delete demos[2].superdocVersionException;
  await writeFile(path.join(root, 'demos.json'), JSON.stringify(demos));
  await assert.rejects(renderGallery({ root, mode: 'production', output: 'index.html' }), /different SuperDoc versions/);
});
