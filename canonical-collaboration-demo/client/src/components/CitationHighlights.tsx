import { useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import type { SelectionTarget, ViewportRect } from 'superdoc/ui';

type Props = {
  superdoc?: SuperDoc;
  refresh: number;
  fieldCodes: boolean;
};

export function CitationHighlights({ superdoc, refresh, fieldCodes }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<ViewportRect[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!superdoc) return;
    let active = true;
    let running = false;
    let pending = false;
    let frame = 0;
    setRects([]);
    setError('');

    async function update() {
      if (!active) return;
      if (running) { pending = true; return; }
      const doc = superdoc!.activeEditor?.doc;
      if (!doc || !layer.current) return;
      running = true;
      try {
        const targets: SelectionTarget[] = [];
        let offset = 0;
        let revision: string | undefined;
        while (active) {
          const page = await doc.citations.list({ offset, limit: 100 });
          if (revision && revision !== page.evaluatedRevision) { pending = true; return; }
          revision = page.evaluatedRevision;
          for (const { address } of page.items) {
            targets.push({ kind: 'selection', story: address.story ?? { kind: 'story', storyType: 'body' },
              start: { kind: 'text', ...address.anchor.start }, end: { kind: 'text', ...address.anchor.end } });
          }
          offset += page.items.length;
          if (offset >= page.total || !page.items.length) break;
        }
        if (!active || !layer.current) return;
        const highlights = targets.flatMap((target) =>
          superdoc!.ui.viewport.getRect({ target, relativeTo: layer.current! }).rects
            .filter((rect) => rect.width > 0 && rect.height > 0));
        setRects(highlights);
        setError('');
      } catch (caught) {
        if (active) {
          setRects([]);
          setError(`Could not highlight citations: ${caught instanceof Error ? caught.message : String(caught)}`);
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

    const stopObserving = superdoc.ui.viewport.observe(schedule);
    superdoc.on('document-replaced', schedule);
    schedule();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      stopObserving();
      superdoc.off('document-replaced', schedule);
    };
  }, [superdoc, refresh, fieldCodes]);

  return <div ref={layer} className="citation-highlights">
    <div aria-hidden="true">{rects.map((rect, index) => <span key={index} className="citation-highlight"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />)}</div>
    {error && <p className="citation-highlight-error error" role="status">{error}</p>}
  </div>;
}
