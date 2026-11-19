import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentService } from './document-service.js';
import { createReferenceAgentAdapter } from './reference-integration/agent/reference-agent-adapter.js';

async function harness(t, changeMode = 'direct', prompt = 'Manage document references.') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'full-reference-api-'));
  const service = new DocumentService();
  t.after(async () => { await service.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const input = path.join(directory, 'input.docx');
  await fs.copyFile(new URL('../assets/blank.docx', import.meta.url), input);
  await service.initialize();
  const document = await service.open({ id: 'api', filename: 'input.docx', path: input });
  const adapter = await createReferenceAgentAdapter({ document, toolkit: service.getToolkit(), prompt, changeMode });
  const execute = (operationId, args = {}) => adapter.execute('superdoc_api_call', { operationId, args });
  return { document, adapter, execute };
}
const source = { type: 'book', fields: { title: 'Synthetic API book', year: '2026', authors: [{ first: 'Ada', last: 'Example' }] } };
const target = sourceId => ({ kind: 'entity', entityType: 'citationSource', sourceId });

test('five-tool agent saves metadata in Reviewing mode and reads native lists successfully', { timeout: 60_000 }, async t => {
  const { document, adapter, execute } = await harness(t, 'tracked');
  assert.equal(adapter.tools.length, 5);
  assert.doesNotMatch(adapter.systemPrompt + JSON.stringify(adapter.tools), /superdoc_references|superdoc_bibliographies/);
  const created = await execute('doc.citations.sources.insert', { ...source, changeMode: 'tracked' });
  assert.equal(created.failed, false);
  assert.equal(created.result.changeMode, 'direct');
  const sourceId = created.result.source.sourceId;
  const listed = await execute('doc.citations.sources.list');
  assert.equal(listed.failed, false);
  assert.equal(listed.result.items[0].sourceId, sourceId);
  const updated = await execute('doc.citations.sources.update', { target: target(sourceId), patch: { year: '2027' } });
  assert.equal(updated.failed, false);
  assert.equal((await document.citationSources()).items[0].fields.year, '2027');
  const bibliography = await execute('doc.citations.bibliography.insert', { at: { kind: 'documentEnd' }, style: 'APA' });
  assert.equal(bibliography.failed, true);
  assert.equal((await document.dispatch('superdoc_api_call', { operationId: 'doc.fields.list', args: {} })).total, 0);
  const removed = await execute('doc.citations.sources.remove', { target: target(sourceId) });
  assert.equal(removed.failed, false);
  assert.equal((await document.citationSources()).items.length, 0);
});

test('source metadata in a tracked batch cannot authorize a direct citation or bibliography write', { timeout: 60_000 }, async t => {
  const { document, adapter } = await harness(t, 'tracked');
  for (const operationId of ['doc.citations.insert', 'doc.citations.bibliography.insert']) {
    const result = await adapter.execute('superdoc_api_call', { calls: [
      { operationId: 'doc.citations.sources.insert', args: source },
      { operationId, args: { at: { kind: 'documentEnd' }, sourceIds: ['irrelevant'] } },
    ] });
    assert.equal(result.failed, true);
    assert.match(result.result.error, /refused under enforceChangeMode/);
    assert.equal((await document.citationSources()).items.length, 0);
  }
});

test('native bibliography operations retain app formatting and preserve sources', { timeout: 60_000 }, async t => {
  const { document, adapter, execute } = await harness(t, 'direct', 'Add a bibliography to the last page.');
  assert.equal(adapter.initialToolChoice.function.name, 'superdoc_api_search');
  const created = await execute('doc.citations.sources.insert', source);
  assert.equal(created.failed, false);
  const inserted = await execute('doc.citations.bibliography.insert', { at: { kind: 'documentEnd' }, style: 'APA' });
  assert.equal(inserted.failed, false);
  assert.equal(inserted.result.formattingWarning, undefined);
  const bibliography = inserted.result.bibliography;
  assert.equal((await execute('doc.citations.sources.insert', { type: 'report', fields: { title: 'Second API source', year: '2025', authors: [{ last: 'Babbage' }] } })).failed, false);
  for (const style of ['APA', 'Chicago', 'MLA']) {
    const configured = await execute('doc.citations.bibliography.configure', { target: bibliography, style });
    assert.equal(configured.failed, false, JSON.stringify(configured.result));
    assert.equal((await execute('doc.citations.bibliography.rebuild', { target: bibliography })).failed, false);
    const info = await execute('doc.citations.bibliography.get', { target: bibliography });
    assert.equal(info.failed, false);
    assert.equal(info.result.style, style);
    assert.equal(info.result.sourceCount, 2);
    const fields = await execute('doc.fields.list');
    assert.equal(fields.failed, false);
    assert.match(fields.result.items[0].resolvedText, /Example/);
    assert.match(fields.result.items[0].resolvedText, /2026/);
  }
  const updated = await execute('doc.citations.sources.update', { target: target(created.result.source.sourceId), patch: { year: '2027' } });
  assert.equal(updated.failed, false);
  assert.match((await execute('doc.fields.list')).result.items[0].resolvedText, /2027/);
  const removedBibliography = await execute('doc.citations.bibliography.remove', { target: bibliography });
  assert.equal(removedBibliography.failed, false, JSON.stringify(removedBibliography.result));
  assert.equal((await execute('doc.fields.list')).result.total, 0);
  assert.equal((await document.citationSources()).items.length, 2);
});

test('cited-source deletion is guarded at each native invocation inside a batch', { timeout: 60_000 }, async t => {
  const { document, adapter, execute } = await harness(t);
  const created = await execute('doc.citations.sources.insert', source);
  const sourceId = created.result.source.sourceId;
  const paragraph = await document.dispatch('superdoc_api_call', { operationId: 'doc.create.paragraph', args: { text: 'Control text.', at: { kind: 'documentEnd' } } });
  const result = await adapter.execute('superdoc_api_call', { calls: [
    { operationId: 'doc.citations.insert', args: { sourceIds: [sourceId], at: { kind: 'text', segments: [{ blockId: paragraph.paragraph.nodeId, range: { start: 13, end: 13 } }] } } },
    { operationId: 'citations.sources.remove', args: { target: target(sourceId) } },
  ] });
  assert.equal(result.failed, true);
  assert.equal(result.result.completed, 1);
  assert.match(result.result.receipts[1].error, /still cited/);
  assert.equal((await document.citationSources()).items.length, 1);
});

test('partial native batches preserve saved-source receipts in interruption reports', { timeout: 60_000 }, async t => {
  const { document, adapter } = await harness(t);
  const result = await adapter.execute('superdoc_api_call', { calls: [
    { operationId: 'doc.citations.sources.insert', args: source },
    { operationId: 'doc.citations.sources.update', args: { target: target('missing-source'), patch: { year: '2028' } } },
  ] });
  assert.equal(result.failed, true);
  assert.equal(result.result.completed, 1);
  assert.equal((await document.citationSources()).items.length, 1);
  assert.match(adapter.interruptionReport('turn_limit'), /Saved reference "Synthetic API book"/);
  assert.doesNotMatch(adapter.interruptionReport('turn_limit'), /Updated reference/);
});

test('native citations render the selected style immediately without a later bibliography refresh', { timeout: 60_000 }, async t => {
  const { document, execute } = await harness(t);
  const created = await execute('doc.citations.sources.insert', source);
  const paragraph = await document.dispatch('superdoc_api_call', { operationId: 'doc.create.paragraph', args: { text: 'Control text.', at: { kind: 'documentEnd' } } });
  const inserted = await execute('doc.citations.insert', { sourceIds: [created.result.source.sourceId],
    at: { kind: 'text', segments: [{ blockId: paragraph.paragraph.nodeId, range: { start: 13, end: 13 } }] } });
  assert.equal(inserted.failed, false);
  assert.equal(inserted.result.formattingWarning, undefined);
  const citations = await execute('doc.citations.list');
  assert.equal(citations.result.total, 1);
  assert.equal(citations.result.items[0].displayText, ' (Example, 2026)');
  // Repeated rendering must not accumulate separator spaces.
  await execute('doc.citations.sources.update', { target: target(created.result.source.sourceId), patch: { year: '2027' } });
  assert.equal((await execute('doc.citations.list')).result.items[0].displayText, ' (Example, 2027)');
  for (const text of ['Already spaced. ', '(', '']) {
    const paragraph = await document.dispatch('superdoc_api_call', { operationId: 'doc.create.paragraph', args: { text, at: { kind: 'documentEnd' } } });
    const nodeId = paragraph.paragraph.nodeId;
    await execute('doc.citations.insert', { sourceIds: [created.result.source.sourceId],
      at: { kind: 'text', segments: [{ blockId: nodeId, range: { start: text.length, end: text.length } }] } });
    const citation = (await execute('doc.citations.list')).result.items.find(item => item.address.anchor.start.blockId === nodeId);
    assert.equal(citation.displayText, '(Example, 2027)', `No extra separator after ${JSON.stringify(text)}`);
  }

});

test('bibliography argument and target errors allow a corrected native retry', { timeout: 60_000 }, async t => {
  const { execute } = await harness(t);
  await execute('doc.citations.sources.insert', source);
  const inserted = await execute('doc.citations.bibliography.insert', { at: { kind: 'documentEnd' }, style: 'APA' });
  const missing = await execute('doc.citations.bibliography.rebuild', {});
  assert.equal(missing.failed, true);
  assert.equal(missing.stop, undefined);
  const fields = await execute('doc.fields.list');
  const field = fields.result.items.find(item => item.fieldType === 'BIBLIOGRAPHY');
  const wrong = await execute('doc.citations.bibliography.configure', { target: { kind: 'block', nodeType: 'paragraph', nodeId: field.address.fieldId }, style: 'Chicago' });
  assert.equal(wrong.failed, true);
  assert.equal(wrong.stop, undefined);
  const corrected = await execute('doc.citations.bibliography.configure', { target: { kind: 'block', nodeType: 'bibliography', nodeId: field.address.blockId }, style: 'Chicago' });
  assert.equal(corrected.failed, false, JSON.stringify(corrected.result));
  assert.equal((await execute('doc.citations.bibliography.get', { target: inserted.result.bibliography })).result.style, 'Chicago');
});
