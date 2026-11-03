import { expect, test } from '@playwright/test';
import { acceptSnapshotChanges, captureSnapshot, type SnapshotEditor } from '../src/snapshot';

function editor(api: object, exportDoc = async () => new Blob(['DOCX'])) {
  return { getDocumentApi: () => api, export: exportDoc } as unknown as SnapshotEditor;
}

const catalog = (ids: string[], revision = '7', total = ids.length) => ({
  evaluatedRevision: revision, items: ids.map((id) => ({ id })), total,
});

test('capture exports revisions without accepting them', async () => {
  const calls: string[] = [];
  const file = new Blob(['DOCX']);
  const source = {
    getDocumentApi: () => ({
      info: async () => { calls.push('revision'); return { revision: '7' }; },
      trackChanges: { decide: () => { throw new Error('Acceptance before upload'); } },
    }),
    export: async (options: unknown) => {
      calls.push('export');
      expect(options).toEqual({ exportType: ['docx'], triggerDownload: false, policies: { trackedChanges: 'review-preserving' } });
      return file;
    },
  } as unknown as SnapshotEditor;
  expect(await captureSnapshot(source)).toEqual({ blob: file, revision: '7' });
  expect(calls).toEqual(['revision', 'export']);
});

test('acceptance reads every page and commits all revision IDs with a revision guard', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => `change-${index}`);
  let accepted = 0;
  const source = editor({ trackChanges: {
    list: async ({ in: scope, limit, offset }: { in: string; limit: number; offset: number }) => {
      expect(scope).toBe('all');
      return catalog(ids.slice(offset, offset + limit), '7', ids.length);
    },
    decide: async (input: unknown, options: unknown) => {
      accepted++;
      expect(input).toEqual({ decision: 'accept', target: { kind: 'ids', ids } });
      expect(options).toEqual({ expectedRevision: '7' });
      return { success: true, changed: true };
    },
  } });
  expect(await acceptSnapshotChanges(source, '7')).toBe('accepted');
  expect(accepted).toBe(1);
});

test('a change while reading the catalog prevents accepting unsaved revisions', async () => {
  let accepted = false;
  const source = editor({ trackChanges: {
    list: async ({ offset }: { offset: number }) => offset === 0 ? catalog(['first'], '7', 2) : catalog(['new'], '8', 2),
    decide: async () => { accepted = true; return { success: true }; },
  } });
  expect(await acceptSnapshotChanges(source, '7')).toBe('changed');
  expect(accepted).toBe(false);
});

test('a revision change between listing and acceptance is reported without a retry on newer content', async () => {
  let attempts = 0;
  const source = editor({ trackChanges: {
    list: async () => catalog(['first']),
    decide: async () => { attempts++; return { success: false, failure: { code: 'REVISION_MISMATCH' } }; },
  } });
  expect(await acceptSnapshotChanges(source, '7')).toBe('changed');
  expect(attempts).toBe(1);
});

test('cleanup errors remain retryable without exporting another snapshot', async () => {
  let attempts = 0;
  const source = editor({ trackChanges: {
    list: async () => catalog(['first']),
    decide: async () => { if (++attempts === 1) throw new Error('Temporarily unavailable'); return { success: true, changed: true }; },
  } }, async () => { throw new Error('Do not export again for cleanup'); });
  await expect(acceptSnapshotChanges(source, '7')).rejects.toThrow('Temporarily unavailable');
  expect(await acceptSnapshotChanges(source, '7')).toBe('accepted');
});

test('a successful receipt that changed nothing is not treated as a completed reset', async () => {
  const source = editor({ trackChanges: {
    list: async () => catalog(['first']),
    decide: async () => ({ success: true, changed: false }),
  } });
  await expect(acceptSnapshotChanges(source, '7')).rejects.toThrow('were not accepted');
});
