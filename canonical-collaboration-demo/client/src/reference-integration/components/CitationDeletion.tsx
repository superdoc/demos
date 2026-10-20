import type { ContainerResolver, ReferenceTransport } from '../types';
import { useEffect, useRef } from 'react';
import type { SuperDoc } from 'superdoc';
import type { BrowserDocumentApi, SelectionTarget } from 'superdoc/ui';
import type { DocumentMode } from '../types';

type Citation = Awaited<ReturnType<BrowserDocumentApi['citations']['list']>>['items'][number];
type Props = {
  superdoc?: SuperDoc;
  transport: ReferenceTransport;
  documentKey: string;
  getContainer?: ContainerResolver;
  mode: DocumentMode;
  disabled: boolean;
  onUpdated: () => void;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
};
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function citationToRemove(items: Citation[], selection: SelectionTarget | null | undefined, key: string) {
  if (selection?.start.kind !== 'text' || selection.end.kind !== 'text'
    || selection.start.blockId !== selection.end.blockId || selection.coordinateSpace === 'tracked') return;
  const blockId = selection.start.blockId;
  const start = Math.min(selection.start.offset, selection.end.offset);
  const end = Math.max(selection.start.offset, selection.end.offset);
  const storyKey = (story: SelectionTarget['story']) => !story || story.storyType === 'body' ? 'body' : JSON.stringify(story);
  return items.find((item) => {
    const { anchor, story } = item.address;
    if (anchor.start.blockId !== blockId || anchor.end.blockId !== blockId || storyKey(story) !== storyKey(selection.story)) return false;
    if (start !== end) return start === anchor.start.offset && end === anchor.end.offset;
    if (Array.from(graphemes.segment(item.displayText)).length > 1) return false;
    return key === 'Backspace' ? end === anchor.end.offset : start === anchor.start.offset;
  });
}

export function CitationDeletion({ superdoc, transport, documentKey, getContainer, mode, disabled, onUpdated, onError, onBusyChange }: Props) {
  const state = useRef({ mode, disabled });
  state.current = { mode, disabled };

  useEffect(() => {
    const pane = (superdoc && (getContainer?.(superdoc) ?? superdoc.ui.viewport.getHost()));
    if (!pane || !superdoc) return;
    let active = true;
    let deleting = false;
    let frame = 0;
    let readSequence = 0;
    let citations: Citation[] = [];

    async function readCitations() {
      const doc = superdoc!.activeEditor?.doc;
      if (!doc) return;
      const items: Citation[] = [];
      let revision: string | undefined;
      do {
        const page = await doc.citations.list({ offset: items.length, limit: 100 });
        if (revision && revision !== page.evaluatedRevision) return;
        revision = page.evaluatedRevision;
        items.push(...page.items);
        if (!page.items.length || items.length >= page.total) break;
      } while (active);
      return { items, evaluatedRevision: revision! };
    }

    async function refresh() {
      const request = ++readSequence;
      try {
        const result = await readCitations();
        if (active && result && request === readSequence) citations = result.items;
      } catch {
        if (active && request === readSequence) citations = [];
      }
    }

    async function removeCitation(key: string, requestedMode: DocumentMode) {
      if (deleting) return;
      deleting = true;
      let serverBusy = false;
      try {
        const doc = superdoc!.activeEditor?.doc;
        if (!doc) return;
        const selection = await doc.selection.current();
        const result = await readCitations();
        if (!active || !result || state.current.disabled || state.current.mode !== requestedMode) return;
        const citation = citationToRemove(result.items, selection?.selectionTarget, key);
        if (!citation) return;
        const changeMode = requestedMode === 'suggesting' ? 'tracked' : 'direct';
        try {
          const removed = await doc.citations.remove({ target: citation.address }, {
            changeMode, expectedRevision: result.evaluatedRevision,
          });
          if (!removed.success) throw new Error(removed.failure.message);
        } catch (caught) {
          if (!/unsupported-context/.test(caught instanceof Error ? caught.message : String(caught))) throw caught;
          serverBusy = true;
          onBusyChange(true);
          const evaluatedRevision = await transport.getRevision();
          const removed = await transport.removeCitation({ target: citation.address, instruction: citation.instruction,
            displayText: citation.displayText, changeMode, expectedRevision: evaluatedRevision });
          if (!removed.success) throw new Error('The server could not remove the citation.');
          onBusyChange(false);
          serverBusy = false;
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        }
        if (!active) return;
        const point = { kind: 'text', ...citation.address.anchor.start } as const;
        superdoc!.activeEditor?.focus?.();
        superdoc!.ui.selection.apply({ kind: 'selection', story: citation.address.story, start: point, end: point });
        onUpdated();
        onError('');
        await refresh();
      } catch (caught) {
        if (active) onError(`Could not remove the citation: ${caught instanceof Error ? caught.message : String(caught)}`);
      } finally {
        if (serverBusy) onBusyChange(false);
        deleting = false;
      }
    }

    const schedule = () => {
      if (frame || !active) return;
      frame = window.requestAnimationFrame(() => { frame = 0; void refresh(); });
    };
    const onKeyDown = (event: Event) => {
      const key = event as KeyboardEvent;
      const current = state.current;
      if (current.disabled || current.mode === 'viewing' || key.isComposing || key.altKey || key.ctrlKey || key.metaKey
        || !['Backspace', 'Delete'].includes(key.key)) return;
      const selection = superdoc!.ui.selection.getSnapshot().selectionTarget;
      if (!citationToRemove(citations, selection, key.key)) return;
      // The text keyboard path rejects the final character because the native field still exists.
      key.preventDefault();
      key.stopImmediatePropagation();
      void removeCitation(key.key, current.mode);
    };
    pane.addEventListener('keydown', onKeyDown, true);
    const stopObserving = superdoc.ui.viewport.observe(schedule);
    superdoc.on('document-replaced', schedule);
    schedule();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      stopObserving();
      superdoc.off('document-replaced', schedule);
      pane.removeEventListener('keydown', onKeyDown, true);
    };
  }, [superdoc, transport, documentKey, getContainer, onUpdated, onError, onBusyChange]);

  return null;
}
