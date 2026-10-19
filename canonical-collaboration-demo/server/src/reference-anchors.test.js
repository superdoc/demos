import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { readParagraphPosition, resolveReferenceAnchor, verifyInsertedReference } from './reference-integration/workarounds/reference-anchors.js';
import { insertFootnoteInSnapshot } from './reference-integration/workarounds/footnote-insert.js';
import { insertCitationInSnapshot } from './reference-integration/workarounds/citation-insert.js';
import { renderReferenceFields } from './reference-integration/workarounds/reference-rendering.js';
import { citationInput } from './reference-integration/tools/citation-tool.js';
import { footnoteInput } from './reference-integration/tools/footnote-tool.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const B = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const p = (id, text, style) => `<w:p w14:paraId="${id}">${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const body = p('01', 'Overview', 'H1') + p('02', 'First overview paragraph.')
  + p('03', 'More detail', 'H2') + p('04', 'The final overview sentence.  ')
  + p('05', 'Assumptions', 'H1') + p('06', 'We model renewal risk and exchange risk.')
  + p('07', 'Preserve this paragraph exactly.');

async function fixture(t, content = body) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-anchor-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'input.docx');
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${content}</w:body></w:document>`);
  zip.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:style w:styleId="H1"><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:styleId="H2"><w:basedOn w:val="H1"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`);
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('customXml/item1.xml', `<b:Sources xmlns:b="${B}"><b:Source><b:Tag>TestSource</b:Tag><b:SourceType>Report</b:SourceType><b:Title>Example report</b:Title><b:Year>2026</b:Year><b:Author><b:Author><b:Corporate>Example Institute</b:Corporate></b:Author></b:Author></b:Source></b:Sources>`);
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

test('sectionEnd selects the final paragraph, including subsections, before the next peer heading', async (t) => {
  const file = await fixture(t);
  const { at, resolvedAnchor } = await resolveReferenceAnchor(file, { kind: 'sectionEnd', sectionHeading: 'Overview' });
  assert.equal(at.segments[0].blockId, '04');
  assert.equal(at.segments[0].range.start, 'The final overview sentence.'.length);
  assert.equal(resolvedAnchor.before, 'The final overview sentence.');
});

test('afterText finds exact phrase ends rather than guessed offsets', async (t) => {
  const file = await fixture(t);
  const result = await resolveReferenceAnchor(file, { kind: 'afterText', text: 'exchange risk', sectionHeading: 'Assumptions' });
  assert.equal(result.at.segments[0].blockId, '06');
  assert.equal(result.resolvedAnchor.before, 'We model renewal risk and exchange risk');
  assert.equal(result.resolvedAnchor.after, '.');
});

test('paragraphEnd uses the inspected ID and rejects stale paragraph IDs', async (t) => {
  const file = await fixture(t, body + p('08', ''));
  assert.equal((await resolveReferenceAnchor(file, { kind: 'paragraphEnd', blockId: '08' })).resolvedAnchor.offset, 0);
  await assert.rejects(resolveReferenceAnchor(file, { kind: 'paragraphEnd', blockId: 'missing' }), /paragraph anchor changed/);
});

test('ambiguous/missing text and duplicate headings fail without changing the file', async (t) => {
  const file = await fixture(t, body + p('08', 'Another renewal risk.') + p('09', 'Overview', 'H1'));
  const before = await fs.readFile(file);
  for (const anchor of [
    { kind: 'afterText', text: 'renewal risk' },
    { kind: 'afterText', text: 'not present' },
    { kind: 'sectionEnd', sectionHeading: 'Overview' },
  ]) await assert.rejects(resolveReferenceAnchor(file, anchor), /matched|uniquely/);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await resolveReferenceAnchor(file, { kind: 'afterText', text: 'renewal risk', blockId: '06' })).resolvedAnchor.blockId, '06');
});

test('visible coordinates handle split runs, UTF-16, deleted text, and native markers', async (t) => {
  const xml = `<w:p xmlns:w="${W}" xmlns:w14="${W14}" w14:paraId="01"><w:r><w:t>😀 renewal </w:t></w:r><w:del><w:r><w:delText>removed</w:delText></w:r></w:del><w:ins><w:r><w:t>risk</w:t></w:r></w:ins><w:r><w:footnoteReference w:id="1"/><w:tab/><w:t>end</w:t></w:r></w:p>`;
  const paragraph = parse(xml).documentElement;
  assert.equal(readParagraphPosition(paragraph).text, '😀 renewal risk\ufffc\tend');
  const file = await fixture(t, xml);
  const result = await resolveReferenceAnchor(file, { kind: 'afterText', text: 'end' });
  assert.equal(result.resolvedAnchor.offset, '😀 renewal risk\ufffc\tend'.length);
});

test('tracked footnote uses resolved anchor, preserves visible body text, and verifies the marker', async (t) => {
  const file = await fixture(t);
  const { at } = await resolveReferenceAnchor(file, { kind: 'afterText', text: 'exchange risk' });
  const result = await insertFootnoteInSnapshot(file, { at, content: 'Exact note text.', changeMode: 'tracked' });
  const target = { kind: 'footnote', blockId: '06', offset: at.segments[0].range.start, noteId: result.footnote.noteId };
  assert.equal(await verifyInsertedReference(file, target), true);
  await assert.rejects(verifyInsertedReference(file, { ...target, offset: target.offset - 1 }), /did not match/);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const document = parse(await zip.file('word/document.xml').async('string'));
  const paragraphs = Array.from(document.getElementsByTagNameNS(W, 'p'));
  const originals = Array.from(parse(`<w:document xmlns:w="${W}" xmlns:w14="${W14}">${body}</w:document>`).getElementsByTagNameNS(W, 'p'));
  assert.equal(paragraphs.map((node) => readParagraphPosition(node).text.replaceAll('\ufffc', '')).join('\n'),
    originals.map((node) => readParagraphPosition(node).text).join('\n'));
});

test('citation section-end placement is verified after formatting and retains the control paragraph', async (t) => {
  const file = await fixture(t);
  const { at } = await resolveReferenceAnchor(file, { kind: 'sectionEnd', sectionHeading: 'Overview' });
  const inserted = await insertCitationInSnapshot(file, { at, sourceIds: ['TestSource'], changeMode: 'tracked' });
  await renderReferenceFields(file, { style: 'APA', fieldCodes: false });
  assert.equal(await verifyInsertedReference(file, { kind: 'citation', ...inserted }), true);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const document = parse(await zip.file('word/document.xml').async('string'));
  const control = Array.from(document.getElementsByTagNameNS(W, 'p')).find((node) => node.getAttributeNS(W14, 'paraId') === '07');
  assert.equal(readParagraphPosition(control).text, 'Preserve this paragraph exactly.');
});

test('a second note resolves against the current text and existing marker in the same paragraph', async (t) => {
  const file = await fixture(t);
  const first = await resolveReferenceAnchor(file, { kind: 'afterText', text: 'renewal risk' });
  await insertFootnoteInSnapshot(file, { at: first.at, content: 'First note.', changeMode: 'tracked' });
  const second = await resolveReferenceAnchor(file, { kind: 'afterText', text: 'exchange risk' });
  assert.equal(second.resolvedAnchor.offset, 'We model renewal risk and exchange risk'.length + 1);
  const result = await insertFootnoteInSnapshot(file, { at: second.at, content: 'Second note.', changeMode: 'tracked' });
  assert.equal(await verifyInsertedReference(file, { kind: 'footnote', blockId: '06', offset: second.resolvedAnchor.offset, noteId: result.footnote.noteId }), true);
});

test('toolbar numeric cursor insertion continues to work independently of agent semantic anchors', async (t) => {
  const file = await fixture(t);
  const at = { kind: 'text', coordinateSpace: 'visible', segments: [{ blockId: '02', range: { start: 0, end: 0 } }] };
  const inserted = await insertCitationInSnapshot(file, { at, sourceIds: ['TestSource'] });
  assert.equal(await verifyInsertedReference(file, { kind: 'citation', ...inserted }), true);
  const note = await insertFootnoteInSnapshot(file, { at, content: 'At the cursor.' });
  assert.equal(await verifyInsertedReference(file, { kind: 'footnote', blockId: '02', offset: 0, noteId: note.footnote.noteId }), true);
});

test('agent insertion tools reject the old numeric contract and require semantic anchors', () => {
  assert.throws(() => citationInput({ blockId: '06', offset: 5, sourceId: 'TestSource', expectedRevision: '1' }), /anchor/);
  assert.throws(() => footnoteInput({ blockId: '06', offset: 5, content: 'Note', expectedRevision: '1' }), /anchor/);
  assert.throws(() => footnoteInput({ anchor: { kind: 'afterText', text: 'risk', offset: 5 }, content: 'Note', expectedRevision: '1' }), /anchor/);
  assert.equal(footnoteInput({ anchor: { kind: 'afterText', text: 'exchange risk' }, content: 'Note', expectedRevision: '1', changeMode: 'tracked' }).changeMode, 'tracked');
});
