import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
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
  const toolkit = service.getToolkit();
  const adapter = await createReferenceAgentAdapter({ document, toolkit, prompt, changeMode });
  const execute = (operationId, args = {}) => adapter.execute('superdoc_api_call', { operationId, args });
  return { document, toolkit, adapter, execute };
}
const source = { type: 'book', fields: { title: 'Synthetic API book', year: '2026', authors: [{ first: 'Ada', last: 'Example' }] } };
const target = sourceId => ({ kind: 'entity', entityType: 'citationSource', sourceId });

test('recent passage formatting is scoped to one duplicate and stale references fail closed', { timeout: 60_000 }, async t => {
  const { document } = await harness(t);
  const native = (operationId, args) => document.dispatch('superdoc_api_call', { operationId, args });
  const text = 'The gate stays closed.';
  const contents = `${text} / ${text}`;
  const { paragraph } = await native('doc.create.paragraph', { text: contents });
  const focus = await document.findAgentPassage(text, {
    blockId: paragraph.nodeId, start: text.length + 3, end: contents.length,
  });
  const result = await document.editAgentPassage(focus, 'format', { inline: { bold: true }, changeMode: 'tracked' });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.appliedChangeMode, 'tracked');
  const reviewed = await document.readAgentPassage(focus);
  assert.equal(reviewed.inline.bold, true);
  const first = await document.findAgentPassage(text, { blockId: paragraph.nodeId, start: 0, end: text.length });
  assert.notEqual((await document.readAgentPassage(first)).inline.bold, true);
  assert.equal((await document.editAgentPassage(focus, 'delete', { changeMode: 'direct' })).success, true);
  await assert.rejects(document.editAgentPassage(focus, 'format', { inline: { bold: true }, changeMode: 'direct' }), /changed or is ambiguous/);
  assert.match(await native('doc.getText', {}), /The gate stays closed\./);
});

test('saving a clause retains separate inline formatting ranges for mixed text', { timeout: 60_000 }, async t => {
  const { document } = await harness(t);
  const native = (operationId, args) => document.dispatch('superdoc_api_call', { operationId, args });
  const text = 'Bold 🔑 word then plain.';
  const { paragraph } = await native('doc.create.paragraph', { text });
  const focus = await document.findAgentPassage(text, { blockId: paragraph.nodeId, start: 0, end: text.length });
  const boldLength = 'Bold 🔑 word'.length;
  const bold = await document.editAgentPassage(focus, 'format', {
    inline: { bold: true, color: '#008000' }, range: { start: 0, end: boldLength }, changeMode: 'direct',
  });
  assert.equal(bold.success, true, JSON.stringify(bold));
  const saved = await document.readAgentPassage(focus, { snapshotFormatting: true });
  assert.equal(saved.text, text);
  assert.deepEqual(saved.mixed, []);
  assert.equal(saved.runs[0].end, boldLength);
  assert.equal(saved.runs[0].inline.bold, true);
  assert.match(String(saved.runs[0].inline.color), /008000/i);
  assert.notEqual(saved.runs[1].inline.bold, true);
  const inserted = await document.insertAgentText(saved.text, undefined, 'direct', 'documentEnd');
  const copy = await document.captureAgentPassage(inserted.passage);
  for (const { inline, start, end } of saved.runs) {
    const restored = await document.editAgentPassage(copy, 'format', { inline, range: { start, end }, changeMode: 'direct' });
    assert.equal(restored.success, true, JSON.stringify(restored));
  }
  assert.deepEqual(await document.readAgentPassage(copy, { snapshotFormatting: true }), saved);
});

test('recent table updates and deletion preserve the control table and reject a stale address', { timeout: 60_000 }, async t => {
  const { document } = await harness(t);
  const native = (operationId, args) => document.dispatch('superdoc_api_call', { operationId, args });
  const { table: first } = await native('doc.create.table', { rows: 2, columns: 2, at: { kind: 'documentEnd' } });
  const { table: last } = await native('doc.create.table', { rows: 2, columns: 2, at: { kind: 'documentEnd' } });
  assert.equal((await document.workWithAgentTable(last, 'read', 1, 'direct')).table.rows, 2);
  const added = await document.workWithAgentTable(last, 'addRows', 1, 'direct');
  assert.equal(added.success, true, JSON.stringify(added));
  assert.equal((await document.workWithAgentTable(last, 'read', 1, 'direct')).table.rows, 3);
  assert.equal((await document.workWithAgentTable(first, 'read', 1, 'direct')).table.rows, 2);
  assert.equal((await document.workWithAgentTable(last, 'delete', 1, 'direct')).success, true);
  await assert.rejects(document.workWithAgentTable(last, 'addRows', 1, 'direct'), /could not be located/);
  assert.equal((await document.workWithAgentTable(first, 'read', 1, 'direct')).table.rows, 2);
});

test('header and footer writes are scoped to their stories while body text still streams', { timeout: 60_000 }, async t => {
  const { document, execute, toolkit } = await harness(t);
  const native = (operationId, args) => document.dispatch('superdoc_api_call', { operationId, args });
  const tracked = await createReferenceAgentAdapter({ document, toolkit, prompt: 'Edit the footer.', changeMode: 'tracked' });
  const firstSection = (await native('doc.sections.list', {})).items[0].address;
  const slots = {};
  await native('doc.create.paragraph', { at: { kind: 'documentEnd' }, text: 'UNCHANGED' });
  const missing = await tracked.execute('superdoc_api_call', { operationId: 'doc.headerFooters.parts.create', args: { kind: 'footer' } });
  assert.equal(missing.failed, true);
  assert.match(missing.result.error, /refused under enforceChangeMode/);

  for (const kind of ['header', 'footer']) {
    const created = await execute('doc.headerFooters.parts.create', { kind });
    assert.equal(created.failed, false, JSON.stringify(created.result));
    const { refId, partPath } = created.result;
    const story = { kind: 'story', storyType: 'headerFooterPart', refId };
    const target = { kind: 'headerFooterSlot', section: firstSection, headerFooterKind: kind, variant: 'default' };
    const linked = await execute('doc.headerFooters.refs.set', { target, refId });
    assert.equal(linked.failed, false, JSON.stringify(linked.result));
    const paragraph = await execute('doc.create.paragraph', { in: story, at: { kind: 'documentEnd' }, text: 'UNCHANGED' });
    assert.equal(paragraph.failed, false, JSON.stringify(paragraph.result));
    const match = await native('doc.query.match', { in: story, select: { type: 'text', pattern: 'UNCHANGED' }, require: 'exactlyOne' });
    slots[kind] = { story, partPath, target: match.items[0].target };
  }

  const unscoped = await execute('doc.create.paragraph', { at: { kind: 'documentEnd' }, text: 'Rejected body write' });
  assert.equal(unscoped.failed, true);
  assert.match(unscoped.result.error, /Body text must stream/);
  const conflicting = await execute('doc.replace', { target: slots.footer.target, in: { kind: 'story', storyType: 'body' }, text: 'Rejected mixed scope' });
  assert.equal(conflicting.failed, true);

  const header = slots.header.target;
  const inserted = await execute('doc.insert', { target: { ...header, start: header.end }, value: ' Header-only text', type: 'text' });
  assert.equal(inserted.failed, false, JSON.stringify(inserted.result));
  const replaced = await tracked.execute('superdoc_api_call', {
    operationId: 'doc.replace', args: { target: slots.footer.target, text: 'footer-review-123' },
  });
  assert.equal(replaced.failed, false, JSON.stringify(replaced.result));
  assert.equal(replaced.result.receipt.appliedChangeMode, 'tracked');

  const headerStream = document.createTextStream({ changeMode: 'direct' });
  const headerArgs = { story: slots.header.story, mode: 'paragraphBefore', anchor: 'UNCHANGED' };
  await headerStream.update({ ...headerArgs, text: 'Streamed header' });
  await assert.rejects(headerStream.update({ ...headerArgs, story: slots.footer.story, text: 'Streamed header elsewhere' }), /target changed/);
  const headerReceipt = await headerStream.commit({ ...headerArgs, text: 'Streamed header in a new paragraph' });
  assert.equal(headerReceipt.receipt.appliedChangeMode, 'direct');

  const footerStream = document.createTextStream({ changeMode: 'tracked' });
  const footerArgs = { story: slots.footer.story, mode: 'append', anchor: null };
  await footerStream.update({ ...footerArgs, text: 'Streamed footer' });
  const footerReceipt = await footerStream.commit({ ...footerArgs, text: 'Streamed footer in Reviewing mode' });
  assert.equal(footerReceipt.receipt.appliedChangeMode, 'tracked');

  const footerRewrite = document.createTextStream({ changeMode: 'tracked' });
  const rewriteArgs = { story: slots.footer.story, mode: 'replace', anchor: 'Streamed footer in Reviewing mode' };
  await footerRewrite.update({ ...rewriteArgs, text: 'Suggested' });
  await footerRewrite.commit({ ...rewriteArgs, text: 'Suggested footer wording' });
  const headerSuggestion = await tracked.execute('superdoc_stream_text', {
    story: slots.header.story, mode: 'after', anchor: 'Header-only text', text: ' with a suggestion',
  });
  assert.equal(headerSuggestion.failed, false, JSON.stringify(headerSuggestion.result));

  const output = path.join(path.dirname(document.path), 'verified.docx');
  await document.save(output);
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  const bodyXml = await zip.file('word/document.xml').async('string');
  assert.match(bodyXml, /UNCHANGED/);
  assert.doesNotMatch(bodyXml, /Header-only text|footer-review-123|Rejected|Streamed header|Streamed footer|Suggested/);
  const headerXml = await zip.file(slots.header.partPath).async('string');
  assert.match(headerXml, /Streamed header in a new paragraph[\s\S]*Header-only text/);
  assert.match(headerXml, /<w:ins\b[^>]*>[\s\S]*?with a suggestion/);
  assert.doesNotMatch(headerXml, /Streamed footer|Suggested/);
  const footerXml = await zip.file(slots.footer.partPath).async('string');
  assert.match(footerXml, /<w:ins\b[^>]*>[\s\S]*?footer-review-123/);
  assert.match(footerXml, /<w:del\b[^>]*>[\s\S]*?UNCHANGED/);
  assert.match(footerXml, /<w:ins\b[^>]*>\s*<w:r>\s*<w:t[^>]*>Suggested footer wording/);

});

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
