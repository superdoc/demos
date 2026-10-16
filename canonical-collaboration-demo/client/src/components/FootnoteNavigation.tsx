import { useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import type { TextTarget } from 'superdoc/ui';
import type { Room } from '../types';
import { api } from '../api';
import { readFootnoteLocations } from '../footnotes';

const body = { kind: 'story', storyType: 'body' } as const;

type Props = {
  superdoc?: SuperDoc;
  room?: Room;
  disabled: boolean;
  onError: (message: string) => void;
};

export function FootnoteNavigation({ superdoc, room, disabled, onError }: Props) {
  const [navigating, setNavigating] = useState(false);
  const [status, setStatus] = useState('');
  const lastReference = useRef<string | undefined>(undefined);

  useEffect(() => {
    lastReference.current = undefined;
    const pane = superdoc?.ui.viewport.getHost()?.closest('.document-pane');
    const reset = () => { lastReference.current = undefined; };
    pane?.addEventListener('pointerdown', reset);
    pane?.addEventListener('keydown', reset);
    return () => {
      pane?.removeEventListener('pointerdown', reset);
      pane?.removeEventListener('keydown', reset);
    };
  }, [superdoc]);

  async function navigate(direction: 1 | -1) {
    const doc = superdoc?.activeEditor?.doc;
    if (disabled || navigating || !doc || !superdoc || !room) return;
    setNavigating(true);
    onError('');
    try {
      const [{ references, blocks }, selection] = await Promise.all([
        api.getDocumentBlob(room.room_id).then(readFootnoteLocations),
        doc.selection.current(),
      ]);
      if (!references.length) throw new Error('This document has no footnotes.');

      const current = selection?.selectionTarget;
      const story = current?.story;
      let index = direction === 1 ? 0 : references.length - 1;
      if (story?.storyType === 'footnote') {
        const activeIndex = references.findIndex((reference) => reference.noteId === story.noteId);
        if (activeIndex >= 0) index = (activeIndex + direction + references.length) % references.length;
      } else if (lastReference.current && references.some((reference) => reference.noteId === lastReference.current)) {
        const activeIndex = references.findIndex((reference) => reference.noteId === lastReference.current);
        index = (activeIndex + direction + references.length) % references.length;
      } else if ((!story || story.storyType === 'body') && current?.end.kind === 'text') {
        const start = current.start;
        const end = current.end;
        const activeIndex = start.kind === 'text' ? references.findIndex((reference) =>
          reference.blockId === start.blockId && reference.blockId === end.blockId
          && reference.offset === start.offset && reference.offset + 1 === end.offset) : -1;
        const currentBlock = blocks.get(current.end.blockId);
        if (activeIndex >= 0) {
          index = (activeIndex + direction + references.length) % references.length;
        } else if (currentBlock !== undefined) {
          const offset = current.end.offset;
          const candidates = references.map((reference, position) => {
            const block = blocks.get(reference.blockId);
            const difference = block === undefined ? undefined : block - currentBlock || reference.offset - offset;
            return { position, difference };
          }).filter(({ difference }) => difference !== undefined && (direction === 1 ? difference > 0 : difference < 0));
          index = (direction === 1 ? candidates[0] : candidates.at(-1))?.position ?? index;
        }
      }

      const reference = references[index];
      const start = { kind: 'text', blockId: reference.blockId, offset: reference.offset } as const;
      const end = { ...start, offset: reference.offset + 1 };
      const target: TextTarget = { kind: 'text', story: body,
        segments: [{ blockId: reference.blockId, range: { start: start.offset, end: end.offset } }] };
      superdoc.activeEditor?.focus?.();
      const applied = superdoc.ui.selection.apply({ kind: 'selection', story: body, start, end });
      if (!applied.ok) throw new Error('The footnote reference could not be selected.');
      const scrolled = await superdoc.ui.viewport.scrollIntoView({ target, block: 'center', behavior: 'instant' });
      if (!scrolled.success) throw new Error('The footnote reference could not be scrolled into view.');
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const rect = superdoc.ui.viewport.getRect({ target }).rect;
      const pane = superdoc.ui.viewport.getHost()?.closest('.document-pane');
      if (rect && pane) {
        const viewport = pane.getBoundingClientRect();
        pane.scrollBy({ top: rect.top + rect.height / 2 - viewport.top - viewport.height / 2, behavior: 'instant' });
      }
      lastReference.current = reference.noteId;
      setStatus(`Footnote ${index + 1} of ${references.length}`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setNavigating(false);
    }
  }

  return (
    <div className="footnote-navigation" role="group" aria-label="Footnote navigation" aria-busy={navigating}>
      <span className="visually-hidden" role="status">{status}</span>
      <button type="button" className="reference-command" disabled={disabled || navigating}
        onPointerDown={(event) => event.preventDefault()} onClick={() => void navigate(1)}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
        Next footnote
      </button>
      <button type="button" className="reference-command" disabled={disabled || navigating}
        onPointerDown={(event) => event.preventDefault()} onClick={() => void navigate(-1)}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6" /></svg>
        Previous footnote
      </button>
    </div>
  );
}
