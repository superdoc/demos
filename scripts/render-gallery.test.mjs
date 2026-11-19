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
  assert.doesNotMatch(html, /class="card-version"/);
});

test('local gallery includes remote and legacy unversioned cards without card version labels', async (t) => {
  const { root, demos } = await fixture(t);
  demos[0].localSourceDirectory = demos[0].packageDirectory;
  demos[1].versioned = false;
  await writeFile(path.join(root, 'demos.json'), JSON.stringify(demos));
  await writeFile(path.join(root, 'second/package.json'), JSON.stringify({ dependencies: { superdoc: '2.28.0' } }));
  await writeFile(path.join(root, 'history/package.json'), JSON.stringify({ dependencies: { superdoc: '2.30.0-next.4' } }));
  await renderGallery({ root, mode: 'local', output: 'index.html' });
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /class="site-version">SuperDoc v2\.29\.0/);
  assert.match(html, /<h2>second<\/h2>/);
  assert.match(html, /<h2>history<\/h2>/);
  assert.doesNotMatch(html, /class="card-version"/);
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

test('production gallery preserves a single canonical and matching Open Graph destination', async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'dist-landing/index.html'), await readFile(new URL('../dist-landing/index.html', import.meta.url), 'utf8'));
  await renderGallery({root, mode:'production', output:'index.html'});
  const html=await readFile(path.join(root,'index.html'),'utf8');
  const canonicals=[...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)];
  assert.equal(canonicals.length,1);assert.equal(canonicals[0][1],'https://demos.superdoc.dev/');
  assert.match(html,/<meta property="og:url" content="https:\/\/demos\.superdoc\.dev\/"/);
  assert.match(html,/<meta name="description" content="Explore working SuperDoc demos/);
  assert.equal((html.match(/<h1\b/g)||[]).length,1);
});

test('production gallery identifies its actual website and publisher in server HTML', async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'dist-landing/index.html'), await readFile(new URL('../dist-landing/index.html', import.meta.url), 'utf8'));
  await renderGallery({ root, mode: 'production', output: 'index.html' });
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'Rendered server HTML must contain one structured identity graph');
  const schema = JSON.parse(scripts[0][1]);
  assert.equal(schema['@context'], 'https://schema.org');
  const organization = schema['@graph'].filter(node => node['@type'] === 'Organization');
  const websites = schema['@graph'].filter(node => node['@type'] === 'WebSite');
  assert.equal(organization.length, 1);
  assert.equal(websites.length, 1);
  assert.deepEqual(organization[0], {
    '@type': 'Organization', '@id': 'https://www.superdoc.dev/#organization',
    name: 'SuperDoc', url: 'https://www.superdoc.dev/',
  });
  assert.equal(websites[0]['@id'], 'https://demos.superdoc.dev/#website');
  assert.equal(websites[0].url, 'https://demos.superdoc.dev/');
  assert.equal(websites[0].name, 'SuperDoc Demos');
  assert.deepEqual(websites[0].publisher, { '@id': organization[0]['@id'] });
  assert.equal(schema['@graph'].length, 2);
  assert.equal(websites[0].potentialAction, undefined);
  assert.equal(websites[0].aggregateRating, undefined);
});
