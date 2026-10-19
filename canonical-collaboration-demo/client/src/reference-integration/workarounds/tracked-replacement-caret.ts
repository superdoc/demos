import type { SuperDoc } from 'superdoc';

type Selection = SuperDoc['ui']['selection'];
type Options = {
  root: HTMLElement;
  selection: Pick<Selection, 'getSnapshot' | 'apply'>;
  enabled: () => boolean;
};

// SuperDoc 2.18 can retain a tracked-space typing anchor after a replacement
// following earlier deletions. Normalize the selected range BEFORE native
// typing, using the visible range already supplied by the public selection API.
// This changes selection only; native input still owns text, revisions and undo.
export function installTrackedReplacementCaretRepair({ root, selection, enabled }: Options) {
  let lastSource: string | undefined;
  let disposed = false;
  const cancel = () => { lastSource = undefined; };

  function keyDown(event: Event) {
    if (disposed) return;
    const key = event as KeyboardEvent;
    if (!enabled() || key.defaultPrevented || key.isComposing || key.ctrlKey || key.metaKey || key.altKey
      || Array.from(key.key).length !== 1) { cancel(); return; }
    const host = (key.target as Element | null)?.closest('[data-v2-ime-host]');
    if (!host || !root.contains(host)) { cancel(); return; }
    const snapshot = selection.getSnapshot();
    const target = snapshot.selectionTarget;
    const visible = snapshot.target;
    if (snapshot.status !== 'ready') return;
    if (snapshot.empty || target?.coordinateSpace !== 'tracked') { cancel(); return; }
    if (target.start.kind !== 'text' || target.end.kind !== 'text'
      || target.start.blockId !== target.end.blockId || visible?.coordinateSpace === 'tracked'
      || visible?.segments.length !== 1) return;
    const segment = visible.segments[0];
    // Do not reinterpret selections that actually include deletion-side text.
    if (segment.blockId !== target.start.blockId || segment.range.end <= segment.range.start
      || segment.range.end - segment.range.start !== target.end.offset - target.start.offset) return;
    const source = JSON.stringify({ target, visible });
    if (source === lastSource) return;
    lastSource = source;
    const result = selection.apply({ ...target, coordinateSpace: 'visible',
      start: { ...target.start, offset: segment.range.start },
      end: { ...target.end, offset: segment.range.end } });
    if (!result.ok) cancel();
  }

  root.ownerDocument.addEventListener('keydown', keyDown, true);
  root.ownerDocument.addEventListener('pointerdown', cancel, true);
  root.ownerDocument.addEventListener('compositionstart', cancel, true);
  root.ownerDocument.addEventListener('focusout', cancel, true);
  return {
    cancel,
    destroy() {
      disposed = true;
      cancel();
      root.ownerDocument.removeEventListener('keydown', keyDown, true);
      root.ownerDocument.removeEventListener('pointerdown', cancel, true);
      root.ownerDocument.removeEventListener('compositionstart', cancel, true);
      root.ownerDocument.removeEventListener('focusout', cancel, true);
    },
  };
}
