import type { PartialBrowserDocumentApi } from 'superdoc/ui';

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
