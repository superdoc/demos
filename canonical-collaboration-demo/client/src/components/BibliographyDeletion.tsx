import { useEffect, useRef } from 'react';
import type { SuperDoc } from 'superdoc';
import type { Room } from '../types';
import type { DocumentMode } from './Topbar';
import { api } from '../api';

type Props = {
  superdoc?: SuperDoc;
  room: Room;
  mode: DocumentMode;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onUpdated: () => void;
  onError: (message: string) => void;
};

export function BibliographyDeletion({ superdoc, room, mode, disabled, onBusyChange, onUpdated, onError }: Props) {
  const enabled = useRef(false);
  enabled.current = mode === 'editing' && !disabled;

  useEffect(() => {
    const pane = superdoc?.ui.viewport.getHost()?.closest('.document-pane');
    if (!pane || !superdoc) return;
    let active = true;
    let running = false;
    let sequence = 0;
    let timer: number | undefined;

    async function removeEmptyField(request: number) {
      const doc = superdoc!.activeEditor?.doc;
      if (!active || !enabled.current || running || !doc) return;
      running = true;
      let busy = false;
      let caret: { blockId: string; offset: number } | undefined;
      try {
        const selection = await doc.selection.current();
        const target = selection?.selectionTarget;
        if (!selection?.empty || target?.start.kind !== 'text' || target.end.kind !== 'text'
          || target.start.blockId !== target.end.blockId || target.start.offset !== target.end.offset
          || (target.story && target.story.storyType !== 'body')) return;
        const blockId = target.start.blockId;
        let offset = 0;
        let empty = false;
        do {
          const page = await doc.fields.list({ offset, limit: 100 });
          empty = page.items.some((field) => field.address.blockId === blockId
            && /^\s*BIBLIOGRAPHY\b/i.test(field.instruction) && !field.resolvedText.trim());
          offset += page.items.length;
          if (empty || offset >= page.total || !page.items.length) break;
        } while (active && request === sequence);
        if (!empty || !active || request !== sequence || !enabled.current) return;
        const currentSelection = await doc.selection.current();
        const point = currentSelection?.selectionTarget?.start;
        if (!currentSelection?.empty || point?.kind !== 'text' || point.blockId !== blockId) return;
        const { evaluatedRevision } = await api.getCitationSources(room.room_id);
        if (!active || request !== sequence || !enabled.current) return;
        busy = true;
        onBusyChange(true);
        const result = await api.removeEmptyBibliography(room, blockId, evaluatedRevision);
        if (!result.success) throw new Error('The empty bibliography could not be removed.');
        if (active && result.removed) { caret = result.caret; onUpdated(); }
      } catch (caught) {
        if (active && busy) onError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        running = false;
        if (busy) onBusyChange(false);
        if (active && enabled.current && request !== sequence) {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => { void removeEmptyField(sequence); }, 0);
        }
      }
      if (!active || !caret) return;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (!active) return;
      const point = { kind: 'text', ...caret } as const;
      superdoc!.activeEditor?.focus?.();
      const applied = superdoc!.ui.selection.apply({ kind: 'selection', story: { kind: 'story', storyType: 'body' }, start: point, end: point });
      if (applied.ok) {
        try {
          await superdoc!.ui.viewport.scrollIntoView({ target: { kind: 'text',
            segments: [{ blockId: caret.blockId, range: { start: caret.offset, end: caret.offset } }] }, block: 'nearest', behavior: 'instant' });
        } catch (caught) {
          if (active) onError(`Bibliography removed. ${caught instanceof Error ? caught.message : String(caught)}`);
        }
      }
    }

    const onKeyDown = (event: Event) => {
      const key = event as KeyboardEvent;
      if (!enabled.current || key.isComposing || key.altKey || key.ctrlKey || key.metaKey
        || !['Backspace', 'Delete'].includes(key.key)) return;
      const request = ++sequence;
      window.clearTimeout(timer);
      // Let the editor delete text first; only clean up a field that remains empty afterward.
      timer = window.setTimeout(() => { void removeEmptyField(request); }, 0);
    };
    pane.addEventListener('keydown', onKeyDown, true);
    return () => {
      active = false;
      window.clearTimeout(timer);
      pane.removeEventListener('keydown', onKeyDown, true);
    };
  }, [superdoc, room.room_id, room.generation, onBusyChange, onUpdated, onError]);

  return null;
}
