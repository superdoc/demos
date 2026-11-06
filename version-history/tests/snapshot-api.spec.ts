import { expect, test } from '@playwright/test';
import { captureSnapshot, groupChanges, type SnapshotEditor } from '../src/versioning';
import { ChangeRecorder } from '../src/change-recorder';
import { changeText, mapLocation, orderChanges, recordChanges } from '../src/changes';
import type { ChangeRecord, ChangesApi } from '../src/change-records';

const checkpoint = (revision = '1', stateVector = 'vector') => ({ revision, stateVector, state: 'state', cursor: 'cursor', lastChangeId: 'id', at: '2026-11-05T10:00:00Z' });
const source = (changes: Partial<ChangesApi>, exportDocument = async () => new Blob(['DOCX'])) => ({
  getDocumentApi: () => ({ changes: { list: async () => page([], null), snapshot: async () => checkpoint(), ...changes } }), export: exportDocument,
}) as unknown as SnapshotEditor;
const story = { kind: 'story', storyType: 'body' } as const;
const record = (id: string, actor = 'Alice'): ChangeRecord => ({ id, seq: 1, revision: '1', actor: { id: actor, name: actor },
  at: { declared: '2026-11-05T10:00:00Z', observed: '2026-11-05T10:00:01Z' }, origin: 'local', provenance: 'authored', cause: 'user', actorType: 'human',
  session: { id: 'session', clientId: 1 }, update: 'AA==', changes: [{ kind: 'text', story, blockId: 'p', range: { start: 0, end: 3 }, inserted: 'new', deleted: '' }] });
const page = (items: ChangeRecord[], cursor: string | null, truncated = false) => ({ items, cursor, truncated, identity: 'configured' as const, collaboration: true });

test('capture flushes durable records around a stable DOCX and Changes API checkpoint without mutating the document', async () => {
  const calls: string[] = [];
  const editor = source({ snapshot: async ({ includeState } = {}) => { calls.push(includeState ? 'state' : 'check'); return checkpoint(); } });
  editor.export = async (options) => {
    calls.push('export');
    expect(options).toEqual({ exportType: ['docx'], triggerDownload: false, policies: { trackedChanges: 'review-preserving' } });
    return new Blob(['DOCX']);
  };
  const result = await captureSnapshot(editor, async () => { calls.push('flush'); });
  expect(result.checkpoint).toEqual(checkpoint());
  expect(calls).toEqual(['flush', 'state', 'export', 'flush', 'check']);
});

test('a concurrent edit retries the capture against the new revision instead of clearing history', async () => {
  let reads = 0; let exports = 0;
  const editor = source({ snapshot: async () => checkpoint(++reads === 1 ? '1' : '2') }, async () => { exports++; return new Blob(['DOCX']); });
  expect((await captureSnapshot(editor, async () => {})).checkpoint.revision).toBe('2');
  expect(exports).toBe(2);
});

test('a changing state vector with an unchanged revision also invalidates a capture', async () => {
  let reads = 0;
  const editor = source({ snapshot: async () => checkpoint('1', ++reads === 1 ? 'old' : 'new') });
  expect((await captureSnapshot(editor, async () => {})).checkpoint.stateVector).toBe('new');
});

test('continual concurrent edits fail without uploading mismatched document and checkpoint bytes', async () => {
  let reads = 0;
  await expect(captureSnapshot(source({ snapshot: async () => checkpoint(String(++reads)) }), async () => {})).rejects.toThrow('kept changing');
  expect(reads).toBe(6);
});

test('missing API support and missing checkpoint state fail clearly', async () => {
  await expect(captureSnapshot({ getDocumentApi: () => null } as unknown as SnapshotEditor, async () => {})).rejects.toThrow('Changes API');
  await expect(captureSnapshot(source({ snapshot: async () => ({ ...checkpoint(), state: undefined }) }), async () => {})).rejects.toThrow('snapshot state');
});

test('recording paginates and advances its cursor only after successful storage', async () => {
  const seen: Array<string | undefined> = []; const writes: string[] = [];
  let fail = true;
  const editor = source({ list: async ({ after } = {}) => {
    seen.push(after);
    return after === 'first' ? page([record('second')], 'second') : after === 'second' ? page([], 'second') : page([record('first')], 'first');
  } });
  const recorder = new ChangeRecorder(editor, async (records) => {
    if (fail) throw new Error('Storage offline');
    writes.push(...records.map((item) => item.id));
  }, () => {});
  await expect(recorder.flush()).rejects.toThrow('Storage offline');
  fail = false; await recorder.flush(); recorder.stop();
  expect(seen).toEqual([undefined, undefined, 'first', 'second']);
  expect(writes).toEqual(['first', 'second']);
});

test('retention gaps prevent a complete checkpoint even after the remaining records are stored', async () => {
  let reads = 0;
  const recorder = new ChangeRecorder(source({ list: async () => ++reads === 1 ? page([record('last')], 'last', true) : page([], 'last') }), async () => {}, () => {});
  await expect(recorder.flush()).rejects.toThrow('gap');
  await expect(recorder.flush()).rejects.toThrow('gap'); recorder.stop();
});

test('records without a configured actor identity are not silently stored as attributed edits', async () => {
  const writes: string[] = [];
  const recorder = new ChangeRecorder(source({ list: async () => ({ ...page([record('first')], 'first'), identity: 'missing' }) }), async () => { writes.push('write'); }, () => {});
  await expect(recorder.flush()).rejects.toThrow('actor ID');
  expect(writes).toEqual([]); recorder.stop();
});

test('text locations follow later insertions and paragraph splits without fabricating removed ranges', () => {
  const location = { blockId: 'p', story, range: { start: 2, end: 5 } };
  const shifted = mapLocation(location, { kind: 'text', story, blockId: 'p', range: { start: 0, end: 2 }, inserted: 'XX', deleted: '' });
  expect(shifted[0].range).toEqual({ start: 4, end: 7 });
  const split = mapLocation(shifted[0], { kind: 'split', story, blockId: 'p', tailBlockId: 'tail', offset: 5 });
  expect(split.map((item) => [item.blockId, item.range])).toEqual([['p', { start: 4, end: 5 }], ['tail', { start: 0, end: 2 }]]);
  expect(mapLocation(split[1], { kind: 'remove', story, blockId: 'tail', text: 'removed' })).toEqual([]);
});

test('attribution and sorting use the original record author and declared timestamp', () => {
  const alice = record('a', 'Alice'); const bob = record('b', 'Bob');
  bob.at.declared = '2026-11-05T11:00:00Z';
  const edits = recordChanges([bob, alice]);
  expect(orderChanges(edits, 'newest').map((item) => item.record.actor?.name)).toEqual(['Bob', 'Alice']);
  expect(orderChanges(edits, 'oldest').map((item) => item.record.actor?.name)).toEqual(['Alice', 'Bob']);
  expect(orderChanges(edits, 'author').map((item) => item.record.actor?.name)).toEqual(['Alice', 'Bob']);
});

test('paragraph grouping combines keystrokes and adjacent highlights while preserving raw records and latest time', () => {
  const records = [...'abc'].map((inserted, index) => ({ ...record(String(index)),
    at: { declared: `2026-11-05T10:00:0${index}Z`, observed: '2026-11-05T10:00:09Z' },
    changes: [{ kind: 'text' as const, story, blockId: 'p', range: { start: index, end: index + 1 }, inserted, deleted: '' }] }));
  const before = JSON.stringify(records);
  const entries = recordChanges(records);
  for (const entry of entries) entry.targets = entry.locations.map((location) => ({ ...location, kind: 'text', range: location.range! }));
  const grouped = groupChanges(entries, (target) => 'abc'.slice(target.range.start, target.range.end));
  expect(grouped).toHaveLength(1);
  expect(grouped[0].members).toHaveLength(3);
  expect(grouped[0].targets.map((target) => target.range)).toEqual([{ start: 0, end: 3 }]);
  expect(changeText(grouped[0])).toBe('abc');
  expect(grouped[0].record.at.declared).toBe('2026-11-05T10:00:02Z');
  expect(JSON.stringify(records)).toBe(before);
});

test('paragraph grouping separates actor IDs, contributor sets, paragraphs and stories, and keeps disjoint highlights separate', () => {
  const records = Array.from({ length: 7 }, (_, index) => record(String(index)));
  records[1].actor = { id: 'other-alice', name: 'Alice' };
  records[2].contributors = [{ id: 'Bob', name: 'Bob' }];
  if ('blockId' in records[3].changes[0]) records[3].changes[0].blockId = 'other';
  if ('story' in records[4].changes[0]) records[4].changes[0].story = { ...story, storyType: 'header' } as typeof story;
  const entries = recordChanges(records);
  entries[0].targets = [{ kind: 'text', story, blockId: 'p', range: { start: 0, end: 1 } }];
  entries[5].targets = [{ kind: 'text', story, blockId: 'p', range: { start: 5, end: 6 } }];
  entries[6].targets = [{ kind: 'text', story, blockId: 'p', range: { start: 6, end: 7 } }];
  const grouped = groupChanges(entries, (target) => 'a----bc'.slice(target.range.start, target.range.end));
  expect(grouped).toHaveLength(5);
  expect(grouped[0].targets.map((target) => target.range)).toEqual([{ start: 0, end: 1 }, { start: 5, end: 7 }]);
  expect(changeText(grouped[0])).toBe('a … bc');
});

test('paragraph grouping reads repeated backspace deletions in text order', () => {
  const records = ['c', 'b', 'a'].map((deleted, index) => ({ ...record(String(index)),
    changes: [{ kind: 'text' as const, story, blockId: 'p', range: { start: 2 - index, end: 2 - index }, inserted: '', deleted }] }));
  const grouped = groupChanges(recordChanges(records), () => null);
  expect(grouped).toHaveLength(1);
  expect(changeText(grouped[0])).toBe('abc');
});
