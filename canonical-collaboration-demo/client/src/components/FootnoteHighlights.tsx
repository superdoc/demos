import { useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import type { TextTarget, ViewportRect } from 'superdoc/ui';
import type { Room } from '../types';
import { api } from '../api';
import { readFootnoteLocations } from '../footnotes';

type Props = {
  superdoc?: SuperDoc;
  room: Room;
  refresh: number;
  fieldCodes: boolean;
};

export function FootnoteHighlights({ superdoc, room, refresh, fieldCodes }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<ViewportRect[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!superdoc) return;
    let active = true;
    let running = false;
    let pending = false;
    let frame = 0;
    let revision: string | undefined;
    let targets: TextTarget[] = [];
    setRects([]);
    setError('');

    async function update() {
      if (!active) return;
      if (running) { pending = true; return; }
      const doc = superdoc!.activeEditor?.doc;
      if (!doc || !layer.current) return;
      running = true;
      try {
        const current = await doc.footnotes.list({ type: 'footnote', limit: 1 });
        if (!active) return;
        if (revision !== current.evaluatedRevision) {
          // Cache document positions so scrolling only recalculates geometry.
          const { references } = await readFootnoteLocations(await api.getDocumentBlob(room.room_id, undefined, fieldCodes));
          const latest = await doc.footnotes.list({ type: 'footnote', limit: 1 });
          if (!active) return;
          if (latest.evaluatedRevision !== current.evaluatedRevision) { pending = true; return; }
          targets = references.map((reference) => ({
            kind: 'text', story: { kind: 'story', storyType: 'body' }, coordinateSpace: 'visible',
            segments: [{ blockId: reference.blockId, range: { start: reference.offset, end: reference.offset + 1 } }],
          }));
          revision = current.evaluatedRevision;
        }
        if (!active || !layer.current) return;
        setRects(targets.flatMap((target) => superdoc!.ui.viewport.getRect({ target, relativeTo: layer.current! }).rects
          .filter((rect) => rect.width > 0 && rect.height > 0)));
        setError('');
      } catch (caught) {
        if (active) {
          setRects([]);
          setError(`Could not highlight footnotes: ${caught instanceof Error ? caught.message : String(caught)}`);
        }
      } finally {
        running = false;
        if (pending && active) { pending = false; schedule(); }
      }
    }

    function schedule() {
      if (!active || frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; void update(); });
    }

    function replaced() { revision = undefined; schedule(); }
    const stopObserving = superdoc.ui.viewport.observe(schedule);
    superdoc.on('document-replaced', replaced);
    schedule();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      stopObserving();
      superdoc.off('document-replaced', replaced);
    };
  }, [superdoc, room.room_id, room.generation, refresh, fieldCodes]);

  return <div ref={layer} className="citation-highlights">
    <div aria-hidden="true">{rects.map((rect, index) => <span key={index} className="citation-highlight"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />)}</div>
    {error && <p className="citation-highlight-error error" role="status">{error}</p>}
  </div>;
}
