import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { readCitationImport, preserveCitationImport } from './reference-integration/workarounds/citation-import.js';
import { DocumentService } from './document-service.js';
import { referenceInput } from './reference-integration/tools/reference-tool.js';

const bibliographyNS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
const source = `<Source><Tag>History</Tag><SourceType>Book</SourceType><Title>History &amp; Invention</Title><Year>2020</Year><URL>https://example.com/history</URL><Author><Author><Corporate>Example Museum</Corporate></Author><Editor><NameList><Person><First>Ada</First><Last>Editor</Last></Person></NameList></Editor></Author><Comments>Preserve this original field</Comments></Source>`;

async function fixture() {
  const zip = await JSZip.loadAsync(await fs.readFile(new URL('../assets/blank.docx', import.meta.url)));
  zip.file('customXml/item42.xml', `<Sources xmlns="${bibliographyNS}" StyleName="APA">${source}</Sources>`);
  zip.file('customXml/unrelated.xml', '<settings><color>blue</color></settings>');
  return zip;
}

test('reads source catalogs by namespace in any customXml part and retains corporate authors and editors', async () => {
  const zip = await fixture();
  zip.file('customXml/item99.xml', `<x:Sources xmlns:x="${bibliographyNS}"><x:Source><x:Tag>Second</x:Tag><x:SourceType>JournalArticle</x:SourceType><x:Title>Another source</x:Title><x:DOI>10.1000/test</x:DOI><x:Volume>2</x:Volume><x:Pages>3-8</x:Pages></x:Source></x:Sources>`);
  const imported = await readCitationImport(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(imported.records.length, 2);
  assert.deepEqual(imported.records[0].fields.authors, [{ last: 'Example Museum' }]);
  assert.deepEqual(imported.records[0].fields.editor, [{ first: 'Ada', middle: undefined, last: 'Editor' }]);
  assert.equal(imported.records[1].type, 'journalArticle');
  assert.equal(imported.records[1].fields.doi, '10.1000/test');
  assert.equal(imported.records[1].fields.pages, '3-8');
});

test('deduplicates repeated source tags and rejects conflicting records', async () => {
  const zip = await fixture();
  zip.file('customXml/duplicate.xml', `<Sources xmlns="${bibliographyNS}">${source}</Sources>`);
  assert.equal((await readCitationImport(await zip.generateAsync({ type: 'nodebuffer' }))).records.length, 1);
  zip.file('customXml/duplicate.xml', `<Sources xmlns="${bibliographyNS}">${source.replace('2020', '2021')}</Sources>`);
  await assert.rejects(readCitationImport(await zip.generateAsync({ type: 'nodebuffer' })), /conflicting reference records/);
});

test('restores original tags and opaque source metadata while remapping new simple and complex citation fields', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'citation-export-'));
  try {
    const zip = await fixture();
    const imported = await readCitationImport(await zip.generateAsync({ type: 'nodebuffer' }));
    zip.file('customXml/item42.xml', `<Sources xmlns="${bibliographyNS}">${source.replace('<Tag>History</Tag>', '<Tag>runtime-id</Tag>')}</Sources>`);
    zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:fldSimple w:instr="CITATION runtime-id"><w:r><w:t>New citation</w:t></w:r></w:fldSimple><w:r><w:instrText> CITATION runtime-id \\l 1033 </w:instrText></w:r><w:fldSimple w:instr="CITATION History"><w:r><w:t>Original citation</w:t></w:r></w:fldSimple></w:p></w:body></w:document>`);
    const output = path.join(directory, 'export.docx');
    await fs.writeFile(output, await zip.generateAsync({ type: 'nodebuffer' }));
    await preserveCitationImport(output, imported, new Map([['runtime-id', 'History']]));
    const saved = await JSZip.loadAsync(await fs.readFile(output));
    const records = await readCitationImport(await fs.readFile(output));
    assert.equal(records.records.length, 1);
    assert.equal(records.records[0].tag, 'History');
    assert.match(records.records[0].xml, /Preserve this original field/);
    const document = await saved.file('word/document.xml').async('string');
    assert.doesNotMatch(document, /runtime-id/);
    assert.equal(document.match(/CITATION History/g).length, 3);
    assert.equal(await saved.file('customXml/unrelated.xml').async('string'), '<settings><color>blue</color></settings>');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('SDK import makes references reusable, preserves their tags on export, and clears them on replacement', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'citation-import-'));
  const service = new DocumentService();
  try {
    const zip = await fixture();
    const input = path.join(directory, 'input.docx');
    await fs.writeFile(input, await zip.generateAsync({ type: 'nodebuffer' }));
    await service.initialize();
    const document = await service.open({ id: 'citation-test', filename: 'input.docx', path: input });
    const sources = await document.citationSources();
    assert.equal(sources.items.length, 1);
    assert.equal(sources.items[0].fields.title, 'History & Invention');
    const saved = path.join(directory, 'export.docx');
    await document.save(saved);
    assert.equal((await readCitationImport(await fs.readFile(saved))).records[0].tag, 'History');
    const replacement = path.join(directory, 'replacement.docx');
    await fs.copyFile(new URL('../assets/blank.docx', import.meta.url), replacement);
    await document.replace('replacement.docx', replacement);
    assert.equal((await document.citationSources()).items.length, 0);
  } finally {
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('native full-preset source edits reach the toolbar and export without stale-cache restoration', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-source-export-'));
  const service = new DocumentService();
  try {
    const input = path.join(directory, 'input.docx');
    await fs.copyFile(new URL('../assets/blank.docx', import.meta.url), input);
    await service.initialize();
    const document = await service.open({ id: 'native-source-test', filename: 'input.docx', path: input });
    const toolkit = service.getToolkit();
    const call = (operationId, args) => toolkit.dispatch(document.handle, 'superdoc_api_call', { operationId, args });
    const created = await call('doc.citations.sources.insert', { type: 'report', fields: { title: 'Native source', year: '2026' } });
    assert.equal(created.success, true);
    const sourceId = created.source.sourceId;
    assert.equal((await document.citationSources()).items[0].sourceId, sourceId);
    const target = { kind: 'entity', entityType: 'citationSource', sourceId };
    assert.equal((await call('doc.citations.sources.update', { target, patch: { title: 'Updated native source' } })).success, true);
    const saved = path.join(directory, 'export.docx');
    await document.save(saved);
    assert.equal((await readCitationImport(await fs.readFile(saved))).records[0].fields.title, 'Updated native source');
    assert.equal((await call('doc.citations.sources.remove', { target })).success, true);
    await document.save(saved);
    assert.equal((await readCitationImport(await fs.readFile(saved))).records.length, 0);
    assert.equal((await document.citationSources()).items.length, 0);
  } finally {
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('app library CRUD preserves document text and refuses deleting a cited source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'app-source-library-'));
  const service = new DocumentService();
  try {
    const input = path.join(directory, 'input.docx');
    await fs.copyFile(new URL('../assets/blank.docx', import.meta.url), input);
    await service.initialize();
    const document = await service.open({ id: 'app-library-test', filename: 'input.docx', path: input });
    const before = await document.handle.getText({});
    const catalog = await document.citationSources();
    const created = await document.manageReferences(referenceInput({ action: 'create', type: 'report',
      fields: { title: 'App source', year: '2026', corporateAuthor: 'Example Organization' }, expectedRevision: catalog.evaluatedRevision }));
    const sourceId = created.source.sourceId;
    assert.equal(created.success, true);
    const updated = await document.manageReferences(referenceInput({ action: 'update', sourceId,
      fields: { title: 'Updated app source' }, expectedRevision: created.evaluatedRevision }));
    assert.equal(updated.source.fields.title, 'Updated app source');
    assert.equal(await document.handle.getText({}), before, 'Library metadata must not insert body prose.');
    const snapshot = path.join(directory, 'export.docx');
    await document.save(snapshot);
    const saved = await readCitationImport(await fs.readFile(snapshot));
    assert.equal(saved.records[0].fields.title, 'Updated app source');
    assert.match(saved.records[0].xml, /Corporate/);
    const paragraph = (await document.handle.blocks.list({})).blocks[0];
    await document.insertCitation({ sourceIds: [sourceId], expectedRevision: updated.evaluatedRevision,
      changeMode: 'direct', at: { kind: 'text', segments: [{ blockId: paragraph.nodeId, range: { start: 0, end: 0 } }] } });
    const current = await document.citationSources();
    await assert.rejects(document.manageReferences(referenceInput({ action: 'delete', sourceId,
      expectedRevision: current.evaluatedRevision })), /cited/i);
    assert.equal((await document.citationSources()).items.length, 1);
  } finally {
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
