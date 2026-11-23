import type { BorrowedSuperDocUI, PartialBrowserDocumentApi, SelectionCapture, SelectionInfo, SelectionPoint, SelectionTarget } from 'superdoc/ui';

const pendingActions = new WeakMap<PartialBrowserDocumentApi, Promise<void>>();

/** Let toolbar gestures wait for a menu mutation and its selection restoration. */
export async function waitForDocumentAction(doc: PartialBrowserDocumentApi) {
  await pendingActions.get(doc);
}

export function runDocumentAction(doc: PartialBrowserDocumentApi, action: () => Promise<void>) {
  const task = (pendingActions.get(doc) ?? Promise.resolve()).then(action);
  const settled = task.catch(() => {});
  pendingActions.set(doc, settled);
  void settled.then(() => {
    if (pendingActions.get(doc) === settled) pendingActions.delete(doc);
  });
  return task;
}

/** Applying a UI selection only queues worker input; confirm the actual range before continuing. */
export async function applyDocumentSelection(doc: PartialBrowserDocumentApi, ui: BorrowedSuperDocUI, target: SelectionTarget, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!ui.selection.apply(target).ok) throw new Error('The document selection could not be restored.');
  await waitForDocumentSelection(doc, target, 5000, signal);
}

export async function restoreDocumentSelection(doc: PartialBrowserDocumentApi, ui: BorrowedSuperDocUI, capture: SelectionCapture) {
  if (!ui.selection.restore(capture).success) throw new Error('Select the text again before continuing.');
  if (!capture.selectionTarget) throw new Error('The selected text range is unavailable.');
  await waitForDocumentSelection(doc, capture.selectionTarget);
}

export function waitForDocumentSelection(doc: PartialBrowserDocumentApi, target: SelectionTarget, timeoutMs = 5000, signal?: AbortSignal): Promise<void> {
  const current = doc.selection?.current?.bind(doc.selection);
  if (!current) return Promise.reject(new Error('Document selection is unavailable.'));
  return new Promise((resolve, reject) => {
    let done = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearTimeout(poll);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal?.reason);
    const timeout = setTimeout(() => finish(new Error('The document selection could not be restored. Select the text again.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    const check = async () => {
      try {
        const selection = await current();
        if (done) return;
        if (selectionMatches(selection, target)) finish();
        else poll = setTimeout(() => void check(), 16);
      } catch (error) { finish(error); }
    };
    void check();
  });
}

function selectionMatches(selection: SelectionInfo, target: SelectionTarget): boolean {
  const actual = selection.selectionTarget;
  if (!actual || (actual.coordinateSpace ?? 'visible') !== (target.coordinateSpace ?? 'visible')) return false;
  const start = pointKey(target.start, target);
  const end = pointKey(target.end, target);
  return selection.empty === (start === end)
    && pointKey(actual.start, actual) === start && pointKey(actual.end, actual) === end;
}

function pointKey(point: SelectionPoint, range: SelectionTarget): string {
  const story = range.story ?? (point.kind === 'text' ? point.story : point.node.story) ?? { kind: 'story', storyType: 'body' };
  const storyKey = Object.entries(story).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(point.kind === 'text'
    ? [point.kind, point.blockId, point.offset, storyKey]
    : [point.kind, point.node.nodeType, point.node.nodeId, point.edge, storyKey]);
}
