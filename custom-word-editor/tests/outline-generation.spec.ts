import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { buildOutlineSkeleton, readOutline } from '../src/outline/generate-outline';

test('native outline excludes empty page-break headings and preserves authored headings', async () => {
  const headings = [
    { nodeId: 'real-heading', text: 'Real section', level: 1 },
    { nodeId: 'page-break-only', text: '', level: 1 },
    { nodeId: 'whitespace-only', text: ' \n\t', level: 2 },
    { nodeId: 'authored-label', text: '[page break]', level: 2 },
  ];
  const doc = {
    info: async () => ({ outline: headings }),
  } as unknown as Parameters<typeof readOutline>[0];
  const entries = await readOutline(doc);
  expect(entries.map((entry) => entry.text)).toEqual(['Real section', '[page break]']);
  expect(entries.map((entry) => entry.within.nodeId)).toEqual(['real-heading', 'authored-label']);
});

test('projection placeholders are excluded while authored text and block identity remain intact', async ({ page }) => {
  const source = stripTypeScriptTypes(await readFile(
    new URL('../src/outline/custom-outline.ts', import.meta.url), 'utf8',
  ));
  await page.setContent('<!doctype html><html><body></body></html>');
  const entries = await page.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      const { outlineFromHtml } = await import(url);
      const html = '<h1>Real section</h1>' +
        '<h1><span data-superdoc-placeholder="page-break">[page break]</span></h1>' +
        '<h2>Page break <span data-superdoc-placeholder="page-break">[page break]</span>guidance</h2>' +
        '<p><strong><span data-superdoc-placeholder="image">[image]</span>Useful details</strong></p>' +
        '<p><strong><span data-superdoc-placeholder="page-break">[page break]</span></strong></p>' +
        '<h2>[page break]</h2>';
      const start = html.indexOf('<h2>Page break ');
      return outlineFromHtml(html, [{
        identity: 'public',
        blockId: 'authored-heading',
        nodeType: 'heading',
        output: { start, end: html.indexOf('</h2>', start) + 5 },
      }]);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, source);
  expect(entries.map((entry: { text: string }) => entry.text)).toEqual([
    'Real section', 'Page break guidance', 'Useful details', '[page break]',
  ]);
  expect(entries[1].within.nodeId).toBe('authored-heading');
});

test('outline skeleton preserves heading hierarchy and duplicate labels by ID', () => {
  expect(buildOutlineSkeleton([
    { id: 'plan', text: 'Plan', level: 1 },
    { id: 'milestones', text: 'Milestones', level: 2 },
    { id: 'first-notes', text: 'Notes', level: 3 },
    { id: 'second-notes', text: 'Notes', level: 2 },
    { id: 'decisions', text: 'Decisions', level: 1 },
  ])).toEqual([
    { id: 'plan', text: 'Plan', children: [
      { id: 'milestones', text: 'Milestones', children: [
        { id: 'first-notes', text: 'Notes', children: [] },
      ] },
      { id: 'second-notes', text: 'Notes', children: [] },
    ] },
    { id: 'decisions', text: 'Decisions', children: [] },
  ]);
});

test('outline skeleton supports empty outlines and skipped heading levels', () => {
  expect(buildOutlineSkeleton([])).toEqual([]);
  expect(buildOutlineSkeleton([
    { id: 'root', text: 'Root', level: 1 },
    { id: 'detail', text: 'Detail', level: 3 },
    { id: 'next', text: 'Next', level: 2 },
  ])).toEqual([{ id: 'root', text: 'Root', children: [
    { id: 'detail', text: 'Detail', children: [] },
    { id: 'next', text: 'Next', children: [] },
  ] }]);
});
