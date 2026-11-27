import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const entries = [
  ['template-builder-api-v2', 'template-builder-document-api-v2-demo/index.html', 'app', 'template-builder-document-api-v2-demo/src/components/Topbar.vue'],
  ['agentic-collaboration', 'canonical-collaboration-demo/client/index.html', 'root', 'canonical-collaboration-demo/client/src/components/Topbar.tsx'],
  ['custom-word-editor', 'custom-word-editor/index.html', 'root', 'custom-word-editor/src/demo/components/topbar/Topbar.tsx'],
];
const manifest = JSON.parse(await readFile(new URL('../demos.json', import.meta.url), 'utf8'));

for (const [id, file, mount, component] of entries) {
  test(`${id} has readable entry content and matching public page identity`, async () => {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const demo = manifest.find(item => item.id === id);
    assert.ok(demo, 'Existing resource identity must remain registered');
    const canonical = `https://demos.superdoc.dev${demo.liveDemoUri}`;
    assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`));
    const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
    assert.ok(description.length > 30);
    const fallback = html.match(new RegExp(`<div id="${mount}">([\\s\\S]*?)</main>\\s*</div>`))[1];
    const noscripts = [...fallback.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map(match => match[1]);
    assert.equal(noscripts.length, 1, 'Only the JavaScript notice is limited to visitors without JavaScript');
    assert.match(noscripts[0], /Enable JavaScript/);
    const visible = fallback.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
    assert.equal((visible.match(/<h1\b/g) ?? []).length, 1);
    assert.doesNotMatch(visible, /<noscript|\bhidden\b|display:\s*none|Enable JavaScript/);
    for (const link of [demo.sourceUri, 'https://docs.superdoc.dev/', '/']) {
      assert.ok(visible.includes(`href="${link}"`), `Missing usable link: ${link}`);
    }
    assert.ok(visible.includes(description));
    assert.match(visible, /Loading the interactive demo/);
    assert.ok(html.includes(`<meta property="og:url" content="${canonical}"`));
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(schemas.length, 1);
    const page = JSON.parse(schemas[0][1]);
    assert.equal(page['@type'], 'WebPage');
    assert.equal(page.url, canonical);
    assert.equal(page.description, description);
    assert.equal(page.publisher.name, 'SuperDoc');
    for (const unsupported of ['author', 'datePublished', 'dateModified', 'aggregateRating']) assert.equal(page[unsupported], undefined);
    const source = await readFile(new URL(`../${component}`, import.meta.url), 'utf8');
    assert.equal((source.match(/<h1\b/g) ?? []).length, 1, 'The mounted title keeps semantic heading identity');
    if (id === 'agentic-collaboration') {
      assert.match(source, /aria-label="File actions"/);
      assert.match(source, /Build this/);
    } else {
      assert.match(source, /aria-label="File"/);
      assert.match(source, /BuildThis/);
    }
  });
}
