import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { readCitationImport, preserveCitationImport } from './reference-integration/workarounds/citation-import.js';
import { DocumentService } from './document-service.js';

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

async function referenceHarness(t, zip) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-reference-test-'));
  const service = new DocumentService();
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const input = path.join(directory, 'input.docx');
  if (zip) await fs.writeFile(input, await zip.generateAsync({ type: 'nodebuffer' }));
  else await fs.copyFile(new URL('../assets/blank.docx', import.meta.url), input);
  await service.initialize();
  const document = await service.open({ id: 'original', filename: 'input.docx', path: input });
  const api = (operationId, args = {}) => document.dispatch('superdoc_api_call', { operationId, args });
  const reopen = async (id, file) => service.open({ id, filename: path.basename(file), path: file });
  return { directory, service, document, api, reopen };
}

async function addNativeCitation(document, sourceId) {
  const api = (operationId, args = {}) => document.dispatch('superdoc_api_call', { operationId, args });
  await api('doc.create.paragraph', { text: 'An unchanged control passage.', at: { kind: 'documentEnd' } });
  const blocks = await api('doc.blocks.list', { includeText: true, limit: 100 });
  const block = blocks.blocks.find(item => item.text === 'An unchanged control passage.');
  const result = await api('doc.citations.insert', { sourceIds: [sourceId], at: { kind: 'text', segments: [{ blockId: block.nodeId, range: { start: 28, end: 28 } }] } });
  assert.equal(result.success, true);
  return api('doc.citations.list');
}

test('app source creation feeds native insertion and survives exports, formatting, and reloads', { timeout: 60_000 }, async t => {
  const { document, api, directory, reopen } = await referenceHarness(t);
  const catalog = await document.citationSources();
  const created = await document.manageReferences({ action: 'create', type: 'book', fields: { title: 'A synthetic book', year: '2026', corporateAuthor: 'Synthetic Organization' }, expectedRevision: catalog.evaluatedRevision });
  const id = created.source.sourceId;
  assert.equal((await api('doc.citations.sources.list')).items[0].sourceId, id);
  assert.equal((await addNativeCitation(document, id)).total, 1);
  await assert.rejects(document.manageReferences({ action: 'delete', sourceId: id, expectedRevision: (await document.citationSources()).evaluatedRevision }), /still cited/);
  await document.setBibliographyStyle('Chicago', (await document.citationSources()).evaluatedRevision);
  const exported = path.join(directory, 'export.docx');
  await document.save(exported);
  const imported = await readCitationImport(await fs.readFile(exported));
  assert.match(imported.records[0].xml, /Corporate>Synthetic Organization/);
  const reloaded = await reopen('reloaded', exported);
  assert.deepEqual((await reloaded.citationSources()).items.map(item => item.sourceId), [id]);
  const citations = await reloaded.dispatch('superdoc_api_call', { operationId: 'doc.citations.list', args: {} });
  assert.deepEqual(citations.items[0].sourceIds, [id]);
  const secondExport = path.join(directory, 'second-export.docx');
  await reloaded.save(secondExport);
  const again = await reopen('again', secondExport);
  assert.deepEqual((await again.citationSources()).items.map(item => item.sourceId), [id]);
});

test('native-created sources appear in the app; native updates and deletions remain authoritative', { timeout: 60_000 }, async t => {
  const { document, api, directory, reopen } = await referenceHarness(t);
  const created = await api('doc.citations.sources.insert', { type: 'report', fields: { title: 'Native report', year: '2026' } });
  const id = created.source.sourceId;
  const target = { kind: 'entity', entityType: 'citationSource', sourceId: id };
  assert.equal((await document.citationSources()).items[0].sourceId, id);
  await api('doc.citations.sources.update', { target, patch: { title: 'Updated native report' } });
  assert.equal((await document.citationSources()).items[0].fields.title, 'Updated native report');
  await document.manageReferences({ action: 'update', sourceId: id, fields: { year: '2027' }, expectedRevision: (await document.citationSources()).evaluatedRevision });
  assert.equal((await api('doc.citations.sources.list')).items[0].fields.year, '2027');
  const exported = path.join(directory, 'native-export.docx');
  await document.save(exported);
  const reloaded = await reopen('reloaded', exported);
  const sources = await reloaded.citationSources();
  assert.equal(sources.items.length, 1);
  assert.equal(sources.items[0].sourceId, id);
  assert.equal(sources.items[0].fields.title, 'Updated native report');
  await reloaded.manageReferences({ action: 'delete', sourceId: id, expectedRevision: sources.evaluatedRevision });
  assert.equal((await reloaded.citationSources()).items.length, 0);
  const empty = path.join(directory, 'empty.docx');
  await reloaded.save(empty);
  assert.equal((await readCitationImport(await fs.readFile(empty))).records.length, 0);
  await api('doc.citations.sources.remove', { target });
  assert.equal((await document.citationSources()).items.length, 0);
  await document.save(path.join(directory, 'native-deleted.docx'));
  assert.equal((await readCitationImport(await fs.readFile(path.join(directory, 'native-deleted.docx')))).records.length, 0);
});

test('legacy Word tags, existing citations and opaque metadata reconcile without duplicate native sources', { timeout: 60_000 }, async t => {
  const zip = await fixture();
  zip.file('customXml/item42.xml', `<Sources xmlns="${bibliographyNS}" StyleName="APA">${source.replace('<SourceType>Book</SourceType>', '<SourceType>BookSection</SourceType>')}</Sources>`);
  const xml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', xml.replace(/<w:body>[\s\S]*<\/w:body>/, '<w:body><w:p><w:r><w:t>Control text. </w:t></w:r><w:fldSimple w:instr="CITATION History"><w:r><w:t>(Example Museum, 2020)</w:t></w:r></w:fldSimple></w:p></w:body>'));
  const { document, api, directory, reopen } = await referenceHarness(t, zip);
  const catalog = await document.citationSources();
  assert.equal(catalog.items.length, 1);
  const id = catalog.items[0].sourceId;
  assert.notEqual(id, 'History');
  assert.equal((await api('doc.citations.sources.list')).items[0].sourceId, id);
  const citations = await api('doc.citations.list');
  assert.deepEqual(citations.items[0].sourceIds, [id]);
  assert.equal(citations.items[0].displayText, '(Example Museum, 2020)');
  assert.equal((await addNativeCitation(document, id)).total, 2);
  const exported = path.join(directory, 'legacy-export.docx');
  await document.save(exported);
  const imported = await readCitationImport(await fs.readFile(exported));
  assert.equal(imported.records.length, 1);
  assert.equal(imported.records[0].tag, 'History');
  assert.match(imported.records[0].xml, /SourceType>BookSection/);
  assert.match(imported.records[0].xml, /Preserve this original field/);
  assert.equal(imported.aliases.History, id);
  for (let turn = 0, file = exported; turn < 2; turn++) {
    const reloaded = await reopen('reload-' + turn, file);
    assert.deepEqual((await reloaded.citationSources()).items.map(item => item.sourceId), [id]);
    const marks = await reloaded.dispatch('superdoc_api_call', { operationId: 'doc.citations.list', args: {} });
    assert.equal(marks.total, 2);
    assert.ok(marks.items.every(item => item.sourceIds[0] === id));
    file = path.join(directory, `reload-${turn}.docx`);
    await reloaded.save(file);
    assert.match((await readCitationImport(await fs.readFile(file))).records[0].xml, /Preserve this original field/);
  }
});

test('duplicate source metadata retains distinct identities through the persisted Word/native mapping', { timeout: 60_000 }, async t => {
  const zip = await fixture();
  zip.file('customXml/item42.xml', `<Sources xmlns="${bibliographyNS}" StyleName="APA">${source}${source.replace('<Tag>History</Tag>', '<Tag>AnotherTag</Tag>').replace('Preserve this original field', 'A different opaque field')}</Sources>`);
  const { document, directory, reopen } = await referenceHarness(t, zip);
  const ids = (await document.citationSources()).items.map(item => item.sourceId);
  assert.equal(new Set(ids).size, 2);
  const exported = path.join(directory, 'duplicates.docx');
  await document.save(exported);
  const before = await readCitationImport(await fs.readFile(exported));
  const reloaded = await reopen('duplicates', exported);
  assert.deepEqual((await reloaded.citationSources()).items.map(item => item.sourceId), ids);
  const output = path.join(directory, 'duplicates-again.docx');
  await reloaded.save(output);
  const after = await readCitationImport(await fs.readFile(output));
  assert.deepEqual(after.aliases, before.aliases);
  assert.match(after.records.find(item => item.tag === 'History').xml, /Preserve this original field/);
  assert.match(after.records.find(item => item.tag === 'AnotherTag').xml, /A different opaque field/);
});

test('legacy source reconciliation also survives raw SDK persistence used by autosave', { timeout: 60_000 }, async t => {
  const { SuperDocClient } = await import('@superdoc/sdk');
  const { document, directory, reopen } = await referenceHarness(t, await fixture());
  const id = (await document.citationSources()).items[0].sourceId;
  const exported = path.join(directory, 'export.docx');
  await document.save(exported);
  const client = new SuperDocClient({ runtime: 'v2' });
  await client.connect();
  let handle;
  const persisted = path.join(directory, 'raw-autosave.docx');
  try {
    handle = await client.open({ doc: exported });
    await handle.save({ out: persisted, force: true });
  } finally {
    await handle?.close({ discard: true });
    await client.dispose();
  }
  const reloaded = await reopen('autosaved', persisted);
  assert.deepEqual((await reloaded.citationSources()).items.map(item => item.sourceId), [id]);
  const final = path.join(directory, 'final.docx');
  await reloaded.save(final);
  const imported = await readCitationImport(await fs.readFile(final));
  assert.equal(imported.records[0].tag, 'History');
  assert.match(imported.records[0].xml, /Preserve this original field/);
});

test('source remapping spans complex field runs and leaves citation switches and locators unchanged', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'citation-instruction-test-'));
  try {
    const zip = await fixture();
    const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    zip.file('word/document.xml', `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> CITATION </w:instrText></w:r><w:r><w:instrText>History \\m "second source" \\p 42 \\l 1033</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Original display</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`);
    const file = path.join(directory, 'input.docx');
    await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
    await preserveCitationImport(file, await readCitationImport(await fs.readFile(file)), new Map([
      ['History', 'native-first'], ['second source', 'native-second'], ['42', 'wrong-locator'], ['1033', 'wrong-locale'],
    ]));
    const result = await JSZip.loadAsync(await fs.readFile(file));
    const xml = await result.file('word/document.xml').async('string');
    assert.match(xml, /CITATION native-first \\m "native-second" \\p 42 \\l 1033/);
    assert.match(xml, /Original display/);
    assert.doesNotMatch(xml, /wrong-locator|wrong-locale/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
