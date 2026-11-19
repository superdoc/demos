import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReferenceProgress } from './reference-integration/agent/reference-tool-progress.js';
import { createRunProgress, toolFailed } from './reference-integration/agent/agent-run-progress.js';
const source = { operationId: 'doc.citations.sources.insert', args: { type: 'book', fields: { title: 'Saved report' } } };

test('native source receipts report saved metadata without treating a failed citation as applied', () => {
  const progress = createRunProgress(createReferenceProgress({ items: [] }));
  progress.record({ tool: 'superdoc_api_call', args: source, result: { success: true, source: { sourceId: 'saved-id' } } });
  progress.record({ tool: 'superdoc_api_call', args: { operationId: 'doc.citations.insert', args: { sourceIds: ['saved-id'] } }, result: { success: false, error: 'Target missing.' } });
  const report = progress.interruptionReport('turn_limit');
  assert.match(report, /Saved reference "Saved report"/);
  assert.match(report, /Last failed operation: doc.citations.insert/);
  assert.doesNotMatch(report, /Inserted citation/);
});

test('native lists with total counts are successful reads, not incomplete batches', () => {
  assert.equal(toolFailed({ evaluatedRevision: '1', total: 1, items: [{ sourceId: 'saved' }] }), false);
  assert.equal(toolFailed({ evaluatedRevision: '1', total: 0, items: [] }), false);
});

test('partial API batches report successful source writes before the failed operation', () => {
  const progress = createRunProgress(createReferenceProgress({ items: [] }));
  progress.record({ tool: 'superdoc_api_call', args: { calls: [source, { operationId: 'doc.citations.bibliography.insert', args: {} }] },
    result: { completed: 1, total: 2, receipts: [{ index: 0, ok: true, result: { success: true, source: { sourceId: 'saved' } } },
      { index: 1, ok: false, result: { success: false, failure: { message: 'Invalid position.' } } }] } });
  const report = progress.interruptionReport('tool_failure');
  assert.match(report, /Saved reference "Saved report"/);
  assert.match(report, /Last failed operation: doc.citations.bibliography.insert/);
  assert.doesNotMatch(report, /Created bibliography/);
});

test('dry runs do not claim source creation or bibliography deletion', () => {
  const progress = createRunProgress(createReferenceProgress({ items: [] }));
  progress.record({ tool: 'superdoc_api_call', args: { ...source, dryRun: true }, result: { success: true } });
  progress.record({ tool: 'superdoc_api_call', args: { operationId: 'doc.citations.bibliography.remove', args: { dryRun: true } }, result: { success: true } });
  assert.doesNotMatch(progress.interruptionReport('turn_limit'), /Saved reference|Deleted bibliography/);
});
