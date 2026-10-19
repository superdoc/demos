import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReferenceProgress } from './reference-integration/agent/reference-tool-progress.js';
import { createRunProgress } from './reference-integration/agent/agent-run-progress.js';

test('source receipts supply titles for later citation reports; failures cannot become completed entries', () => {
  const describe = createReferenceProgress({ items: [] });
  const progress = createRunProgress(describe);
  progress.record({ tool: 'superdoc_references', args: { action: 'create', fields: { title: 'Requested title' } },
    result: { success: true, source: { sourceId: 'saved-id', fields: { title: 'Saved title' } } } });
  progress.record({ tool: 'superdoc_insert_citation', args: { sourceId: 'saved-id', anchor: { kind: 'sectionEnd', sectionHeading: 'Overview' } },
    result: { ok: false, error: 'A placement failure.' } });
  const report = progress.interruptionReport('turn_limit');
  assert.match(report, /Saved reference "Saved title"/);
  assert.match(report, /Last failed operation: Insert citation for "Saved title" at the end of "Overview"/);
  assert.doesNotMatch(report, /Inserted citation/);
});

test('reports do not claim verified placement without a verification receipt', () => {
  const describe = createReferenceProgress({ items: [] });
  const description = describe({ tool: 'superdoc_insert_footnote', args: { anchor: { kind: 'afterText', text: 'requested quote' } }, result: { success: true } });
  assert.equal(description.completed, 'Inserted footnote.');
  assert.doesNotMatch(description.completed, /verified|requested quote/);
});

test('a no-op bibliography deletion is not reported as a deletion', () => {
  const describe = createReferenceProgress({ items: [] });
  const description = describe({ tool: 'superdoc_bibliographies', args: { action: 'delete' }, result: { success: true, removed: false } });
  assert.equal(description.completed, 'No bibliography was removed.');
});

test('a fatal tool failure still reports earlier saved references', () => {
  const progress = createRunProgress(createReferenceProgress({ items: [] }));
  progress.record({ tool: 'superdoc_references', args: { action: 'create', fields: { title: 'Saved report' } }, result: { success: true } });
  progress.record({ tool: 'superdoc_bibliographies', args: { action: 'create' }, result: { ok: false, error: 'Requires Editing mode.' } });
  const report = progress.interruptionReport('tool_failure', 'Bibliography requires Editing mode.');
  assert.match(report, /Saved reference "Saved report"/);
  assert.match(report, /Last failed operation: create bibliography/);
  assert.doesNotMatch(report, /No changes were made|Created bibliography/);
});
