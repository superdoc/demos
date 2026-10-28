import type { ContextMenuConfig, ContextMenuSelectPayload } from 'superdoc';
import type { BorrowedSuperDocUI, ContentControlInfo, ContentControlTarget, PartialBrowserDocumentApi, SelectionCapture } from 'superdoc/ui';
import { checkReceipt } from '../components/DocumentToolbar/operationResults';
import { runDocumentAction } from '../components/DocumentToolbar/documentActions';

/** Extend the standard menu; capture the clicked control separately from the text range. */
export function createContentControlMenu(getUI: () => BorrowedSuperDocUI | null, getDoc: () => PartialBrowserDocumentApi | null | undefined, onError: (message: string) => void) {
  let capture: SelectionCapture | null = null;
  let control: ContentControlInfo | null = null;
  let request = 0;
  const preparedEvents = new WeakSet<Event>();

  const captureContext = (event: MouseEvent) => {
    if (preparedEvents.has(event)) return;
    const sequence = ++request;
    const ui = getUI();
    capture = ui?.selection.capture() ?? null;
    const hit = ui?.contextMenu.contextAt({ x: event.clientX, y: event.clientY }).entities.find((entity) => entity.type === 'contentControl');
    control = hit ? ui?.contentControls.get({ id: hit.id }) ?? null : null;
    const doc = getDoc();
    if (!hit || !doc?.contentControls?.get || !(event.target instanceof Element)) return;
    // Lock-mode reads in the passive UI catalog may lag a mutation. Settle this
    // control's authoritative state before letting the standard menu open.
    event.preventDefault();
    event.stopPropagation();
    const element = event.target;
    const saved = capture;
    const target: ContentControlTarget = { kind: hit.scope ?? control?.kind ?? 'inline', nodeType: 'sdt', nodeId: hit.id, ...(hit.story ? { story: hit.story as ContentControlTarget['story'] } : {}) };
    void Promise.resolve(doc.contentControls.get({ target })).then((current) => {
      if (sequence !== request || !element.isConnected) return;
      control = current;
      capture = saved;
      const prepared = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: event.button });
      preparedEvents.add(prepared);
      element.dispatchEvent(prepared);
    }).catch(() => onError('The content control could not be read.'));
  };

  const act = async (payload: ContextMenuSelectPayload, action: 'wrap' | 'lock' | 'unlock') => {
    const ui = getUI();
    if (!payload.document.available || !ui || !payload.context?.isEditable) return;
    const { doc, readiness } = payload.document;
    const selectedControl = control;
    const savedSelection = capture;
    return runDocumentAction(getDoc() ?? doc, async () => {
      onError('');
      try {
        if (savedSelection) {
          const restored = ui.selection.restore(savedSelection);
          if (!restored.success) throw new Error('Select the text again before opening the menu.');
        }
        const epoch = readiness.getRenderEpoch();
        if (action === 'wrap') {
          const selection = await doc.selection.current();
          const range = savedSelection?.selectionTarget ?? selection.selectionTarget;
          if (!range || range.start.kind !== 'text' || range.end.kind !== 'text') return;
          const result = await doc.create.contentControl({
            kind: range.start.blockId === range.end.blockId ? 'inline' : 'block',
            controlType: 'richText', at: range, alias: 'Content control', lockMode: 'unlocked',
          }, { changeMode: 'direct' });
          checkReceipt(result);
          if (result.success) {
            await readiness.whenPainted({ afterEpoch: epoch });
            const created = await doc.contentControls.get({ target: result.contentControl });
            if (created.selectionTarget) ui.selection.apply(created.selectionTarget);
          }
        } else if (selectedControl) {
          const current = await doc.contentControls.get({ target: selectedControl.target });
          const result = await doc.contentControls.setLockMode({ target: current.target, lockMode: action === 'lock' ? 'sdtContentLocked' : 'unlocked' }, { changeMode: 'direct' });
          checkReceipt(result);
          await readiness.whenPainted({ afterEpoch: epoch });
          const updated = await doc.contentControls.get({ target: current.target });
          if (updated.selectionTarget) ui.selection.apply(updated.selectionTarget);
        }
        await doc.selection.current();
      } catch (error) {
        onError(error instanceof Error ? error.message : 'The content control could not be updated.');
      }
    });
  };

  const config: ContextMenuConfig = {
    defaultItems: true,
    openOnSlash: false,
    sections: [{ id: 'content-controls', items: [
      { id: 'wrap-content-control', label: 'Wrap in content control', showWhen: (context) => context.hasSelection && !control, enabledWhen: (context) => context.isEditable, onSelect: (payload) => act(payload, 'wrap') },
      { id: 'lock-content-control', label: 'Lock content control', showWhen: () => control?.lockMode === 'unlocked', enabledWhen: (context) => context.isEditable, onSelect: (payload) => act(payload, 'lock') },
      { id: 'unlock-content-control', label: 'Unlock content control', showWhen: () => !!control && control.lockMode !== 'unlocked', enabledWhen: (context) => context.isEditable, onSelect: (payload) => act(payload, 'unlock') },
    ] }],
  };
  return { config, captureContext, dispose: () => { request++; } };
}
