import { expect, test } from '@playwright/test';
import type { BorrowedSuperDocUI, ContentControlInfo, PartialBrowserDocumentApi, SelectionInfo, SelectionTarget } from 'superdoc/ui';
import { getFormattingSelection } from '../src/components/DocumentToolbar/contentControlSelection';

const bounds: SelectionTarget = {
  kind: 'selection', start: { kind: 'text', blockId: 'paragraph', offset: 1 }, end: { kind: 'text', blockId: 'paragraph', offset: 4 },
};
const control = {
  id: 'locked', target: { kind: 'inline', nodeType: 'sdt', nodeId: 'locked' },
  lockMode: 'sdtContentLocked', selectionTarget: bounds, text: 'and',
} as ContentControlInfo;
const ui = { contentControls: { getSnapshot: () => ({ activeIds: [] }) } } as unknown as BorrowedSuperDocUI;
function selectionAt(offset: number): SelectionInfo {
  const point = { kind: 'text', blockId: 'paragraph', offset } as const;
  return { empty: true, selectionTarget: { kind: 'selection', start: point, end: point } } as SelectionInfo;
}
function documentWith(current: SelectionInfo, items: ContentControlInfo[] = [control]): PartialBrowserDocumentApi {
  return {
    selection: { current: async () => current },
    contentControls: { get: async () => control, listInRange: async () => ({ items, total: items.length }) },
  } as PartialBrowserDocumentApi;
}

test('formatting resolves the locked range before the passive control catalog catches up', async () => {
  const selected = await getFormattingSelection(documentWith(selectionAt(2)), ui);
  expect(selected.empty).toBe(false);
  expect(selected.selectionTarget).toEqual(bounds);
  expect(selected.text).toBe('and');
});

test('a deliberate partial selection stays partial while the control catalog is stale', async () => {
  const range: SelectionTarget = { ...bounds, start: { kind: 'text', blockId: 'paragraph', offset: 2 } };
  const current = { empty: false, selectionTarget: range, text: 'nd' } as SelectionInfo;
  expect((await getFormattingSelection(documentWith(current), ui)).selectionTarget).toEqual(range);
});

test('a caret at a control boundary does not expand into either neighboring control', async () => {
  const neighbor = { ...control, id: 'neighbor', selectionTarget: {
    ...bounds, start: { kind: 'text', blockId: 'paragraph', offset: 4 }, end: { kind: 'text', blockId: 'paragraph', offset: 8 },
  } } as ContentControlInfo;
  const current = selectionAt(4);
  expect(await getFormattingSelection(documentWith(current, [control, neighbor]), ui)).toEqual(current);
});

test('a control from another story cannot capture the current caret', async () => {
  const otherStory = { ...control, selectionTarget: { ...bounds, story: { kind: 'story', storyType: 'headerFooterPart', refId: 'rId7' } } } as ContentControlInfo;
  const current = selectionAt(2);
  expect(await getFormattingSelection(documentWith(current, [otherStory]), ui)).toEqual(current);
});

test('formatting finds a locked control beyond the first result page', async () => {
  const current = selectionAt(2);
  const offsets: number[] = [];
  const doc = documentWith(current);
  if (!doc.contentControls) throw new Error('Missing content-control API');
  doc.contentControls.listInRange = async ({ offset = 0 }) => {
    offsets.push(offset);
    return { items: offset === 0 ? [{ ...control, lockMode: 'unlocked' }] : [control], total: 2 };
  };
  expect((await getFormattingSelection(doc, ui)).selectionTarget).toEqual(bounds);
  expect(offsets).toEqual([0, 1]);
});
