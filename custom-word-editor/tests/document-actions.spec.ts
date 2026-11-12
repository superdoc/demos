import { expect, test } from '@playwright/test';
import type { BorrowedSuperDocUI, PartialBrowserDocumentApi, SelectionCapture, SelectionInfo, SelectionTarget } from 'superdoc/ui';
import { applyDocumentSelection, restoreDocumentSelection, runDocumentAction, waitForDocumentAction, waitForDocumentSelection } from '../src/components/DocumentToolbar/documentActions';

const target: SelectionTarget = {
  kind: 'selection', start: { kind: 'text', blockId: 'paragraph', offset: 3 }, end: { kind: 'text', blockId: 'paragraph', offset: 6 },
};
const info = (range: SelectionTarget, empty = false) => ({ selectionTarget: range, empty }) as SelectionInfo;
const caret = () => info({ ...target, end: target.start }, true);
const documentWithSelection = (current: () => Promise<SelectionInfo>) => ({ selection: { current } }) as PartialBrowserDocumentApi;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('document actions keep formatting blocked until queued selection input is acknowledged', async () => {
  const acknowledged = deferred<SelectionInfo>();
  const waitingForAcknowledgement = deferred<void>();
  let reads = 0;
  let finished = false;
  const doc = documentWithSelection(async () => {
    if (++reads === 1) return caret();
    waitingForAcknowledgement.resolve();
    return acknowledged.promise;
  });
  const ui = { selection: { apply: () => ({ ok: true }) } } as unknown as BorrowedSuperDocUI;
  const action = runDocumentAction(doc, async () => {
    await applyDocumentSelection(doc, ui, target);
    finished = true;
  });
  const toolbarReady = waitForDocumentAction(doc);
  await waitingForAcknowledgement.promise;
  expect(finished).toBe(false);
  acknowledged.resolve(info(target));
  await Promise.all([action, toolbarReady]);
  expect(finished).toBe(true);
});

test('restoring a toolbar capture also waits for the worker selection', async () => {
  let reads = 0;
  const doc = documentWithSelection(async () => ++reads === 1 ? caret() : info(target));
  const ui = { selection: { restore: () => ({ success: true, ok: true }) } } as unknown as BorrowedSuperDocUI;
  await restoreDocumentSelection(doc, ui, { selectionTarget: target } as SelectionCapture);
  expect(reads).toBe(2);
});

test('a different range or coordinate space is not accepted as acknowledgement', async () => {
  let reads = 0;
  const doc = documentWithSelection(async () => {
    reads++;
    if (reads === 1) return info({ ...target, start: { kind: 'text', blockId: 'neighbor', offset: 3 } });
    if (reads === 2) return info({ ...target, coordinateSpace: 'tracked' });
    return info({ ...target, story: { kind: 'story', storyType: 'body' } });
  });
  await waitForDocumentSelection(doc, target);
  expect(reads).toBe(3);
});

test('selection restoration fails rather than allowing formatting at an unrelated caret', async () => {
  const doc = documentWithSelection(async () => caret());
  await expect(waitForDocumentSelection(doc, target, 30)).rejects.toThrow('Select the text again');
});

test('a refused selection apply never proceeds to a document read', async () => {
  let reads = 0;
  const doc = documentWithSelection(async () => { reads++; return info(target); });
  const ui = { selection: { apply: () => ({ ok: false }) } } as unknown as BorrowedSuperDocUI;
  await expect(applyDocumentSelection(doc, ui, target)).rejects.toThrow('could not be restored');
  expect(reads).toBe(0);
});

test('worker selection failures are surfaced to the action caller', async () => {
  const doc = documentWithSelection(async () => { throw new Error('Document closed'); });
  await expect(waitForDocumentSelection(doc, target)).rejects.toThrow('Document closed');
});
