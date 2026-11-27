import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const html = await readFile(new URL('../rag/apps/web/index.html', import.meta.url), 'utf8');
const canonical = 'https://demos.superdoc.dev/docrag/';
const description = 'Get cited answers from paragraphs, comments, and tracked changes. Click a citation to see the source.';
const source = 'https://github.com/superdoc/demos/tree/main/rag';
const docs = 'https://docs.superdoc.dev';

test('DocRAG server HTML has one visible heading and useful links outside the React mount', () => {
  const root = html.indexOf('<div id="root">');
  assert.ok(root > 0);
  const persistent = html.slice(html.indexOf('<body>'), root);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(persistent, /<h1[^>]*>DocRAG<\/h1>/);
  assert.doesNotMatch(persistent, /\bhidden\b|display:\s*none|<noscript/);
  for (const link of [source, docs]) assert.ok(persistent.includes(`href="${link}"`));
  assert.match(persistent, />SuperDoc<\/a>/);
});

test('DocRAG canonical, social metadata and page identity describe the same public route', () => {
  assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`));
  assert.ok(html.includes(`<meta property="og:url" content="${canonical}"`));
  assert.ok(html.includes(`<meta name="description" content="${description}"`));
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const page = JSON.parse(scripts[0][1]);
  assert.equal(page['@context'], 'https://schema.org');
  assert.equal(page['@type'], 'WebPage');
  assert.equal(page.name, 'DocRAG — Document Q&A with Citations');
  assert.equal(page.url, canonical);
  assert.equal(page.description, description);
  assert.equal(page.publisher.name, 'SuperDoc');
  for (const invented of ['author', 'datePublished', 'dateModified', 'aggregateRating']) assert.equal(page[invented], undefined);
});

test('The server introduction reuses public demo wording and keeps the existing mount entry', async () => {
  const readme = await readFile(new URL('../rag/README.md', import.meta.url), 'utf8');
  const chat = await readFile(new URL('../rag/apps/web/components/ChatPanel.tsx', import.meta.url), 'utf8');
  assert.ok(readme.includes('Ask your documents. Get cited answers.'));
  assert.match(html, /<h2>Ask your documents\. Get cited answers\.<\/h2>/);
  assert.ok(html.includes(`<p>${description}</p>`));
  assert.ok(chat.replace(/\s+/g, ' ').includes(description));
  assert.match(html, /<script type="module" src="\.\/App\.tsx"><\/script>/);
  const manifest = JSON.parse(await readFile(new URL('../demos.json', import.meta.url), 'utf8'));
  const demo = manifest.find(item => item.id === 'docrag');
  assert.equal(demo.liveDemoUri, '/docrag/');
  assert.equal(demo.packageDirectory, 'rag/apps/web');
  assert.equal(demo.sourceUri, source);
});
