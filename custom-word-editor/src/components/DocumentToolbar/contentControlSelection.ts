import type {
  BorrowedSuperDocUI,
  ContentControlInfo,
  PartialBrowserDocumentApi,
  SelectionInfo,
  SelectionPoint,
  SelectionTarget,
} from 'superdoc/ui';

type TextPoint = Extract<SelectionPoint, { kind: 'text' }>;
type TextRange = SelectionTarget & { start: TextPoint; end: TextPoint };

export function isContentLocked(control: ContentControlInfo): boolean {
  return control.lockMode === 'contentLocked' || control.lockMode === 'sdtContentLocked';
}

/** Resolve a text highlight or a selection of the content control itself. */
export async function getFormattingSelection(doc: PartialBrowserDocumentApi, ui: BorrowedSuperDocUI): Promise<SelectionInfo> {
  if (!doc.selection?.current) throw new Error('Document selection is unavailable.');
  const current = await doc.selection.current({ includeText: true });
  const range = current.selectionTarget;

  if (range && !current.empty) {
    const start = await resolveControlEdge(doc, range.start);
    const end = await resolveControlEdge(doc, range.end);
    return withTextRange(current, { ...range, start, end });
  }

  // An active locked control may be represented as a caret rather than a range.
  // Expand it only when it contains that caret, leaving neighboring fields alone.
  if (!doc.contentControls?.get) return current;
  const activeIds = [...ui.contentControls.getSnapshot().activeIds].reverse();
  for (const id of activeIds) {
    const knownControl = ui.contentControls.get({ id });
    if (!knownControl) continue;

    const control = await doc.contentControls.get({ target: knownControl.target });
    const bounds = control.selectionTarget;
    if (!isContentLocked(control) || !bounds || !containsCaret(bounds, range)) continue;
    return withTextRange(current, bounds, control.text);
  }

  return current;
}

/** Find all intersecting controls, including enclosing controls, without unlocking neighbors. */
export async function getSelectedContentControls(doc: PartialBrowserDocumentApi, selection: SelectionInfo): Promise<ContentControlInfo[]> {
  const range = selection.selectionTarget;
  if (selection.empty || !isTextRange(range) || !doc.contentControls?.listInRange) return [];

  const controls: ContentControlInfo[] = [];
  let total = Infinity;
  while (controls.length < total) {
    const page = await doc.contentControls.listInRange({
      startBlockId: range.start.blockId,
      endBlockId: range.end.blockId,
      offset: controls.length,
      limit: 100,
    });
    controls.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
  }

  return controls.filter((control) => overlapsSelection(control, range));
}

async function resolveControlEdge(doc: PartialBrowserDocumentApi, point: SelectionPoint): Promise<SelectionPoint> {
  if (point.kind === 'text' || point.node.nodeType !== 'sdt' || !doc.contentControls?.get) return point;

  const control = await doc.contentControls.get({ target: { ...point.node, nodeType: 'sdt' } });
  const range = control.selectionTarget;
  return (point.edge === 'before' ? range?.start : range?.end) ?? point;
}

function withTextRange(current: SelectionInfo, range: SelectionTarget, text = current.text): SelectionInfo {
  let target = current.target;
  if (isTextRange(range) && range.start.blockId === range.end.blockId) {
    target = {
      kind: 'text',
      segments: [{ blockId: range.start.blockId, range: { start: range.start.offset, end: range.end.offset } }],
      ...(range.story ? { story: range.story } : {}),
    };
  }
  return { ...current, empty: false, selectionTarget: range, target, text };
}

function containsCaret(bounds: SelectionTarget, selection: SelectionTarget | null | undefined): boolean {
  if (selection?.start.kind !== 'text') return true;
  if (!isTextRange(bounds) || bounds.start.blockId !== bounds.end.blockId) return false;

  const caret = selection.start;
  return caret.blockId === bounds.start.blockId
    && caret.offset >= bounds.start.offset
    && caret.offset <= bounds.end.offset;
}

function overlapsSelection(control: ContentControlInfo, selection: TextRange): boolean {
  const bounds = control.selectionTarget;
  if (!isTextRange(bounds)) return false;
  if (storyKey(bounds.story ?? control.target.story) !== storyKey(selection.story ?? selection.start.story)) return false;

  // The API query handles paragraph order. These checks refine the character
  // boundaries so a control beside selected text in the same paragraph is excluded.
  if (bounds.start.blockId === selection.end.blockId && bounds.start.offset >= selection.end.offset) return false;
  if (bounds.end.blockId === selection.start.blockId && bounds.end.offset <= selection.start.offset) return false;
  return true;
}

function isTextRange(range: SelectionTarget | null | undefined): range is TextRange {
  return range?.start.kind === 'text' && range.end.kind === 'text';
}

function storyKey(story: unknown): string {
  const locator = story ?? { kind: 'story', storyType: 'body' };
  const fields = Object.entries(locator as object).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(fields);
}
