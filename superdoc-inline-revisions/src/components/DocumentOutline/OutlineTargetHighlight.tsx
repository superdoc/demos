import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { TextTarget, ViewportRect } from 'superdoc/ui';
import { useSuperDocUI } from 'superdoc/ui/react';
import './OutlineTargetHighlight.css';

/** Paint the exact navigated text using public geometry, without changing the document. */
export function OutlineTargetHighlight({ target, relativeTo, onClear }: {
  target: TextTarget | null;
  relativeTo: RefObject<HTMLElement | null>;
  onClear: () => void;
}) {
  const ui = useSuperDocUI();
  const [geometry, setGeometry] = useState<{ target: TextTarget | null; rects: readonly ViewportRect[] }>({ target: null, rects: [] });

  const refresh = useCallback(() => {
    const stage = relativeTo.current;
    if (!target || !ui || !stage) {
      setGeometry({ target, rects: [] });
      return;
    }
    const result = ui.viewport.getRect({ target, relativeTo: stage });
    setGeometry({
      target,
      rects: result.found ? result.rects.filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
        ...rect,
        // getRect returns stage-relative viewport coordinates; overlays live in its scroll content.
        left: rect.left + stage.scrollLeft,
        top: rect.top + stage.scrollTop,
      })) : [],
    });
  }, [relativeTo, target, ui]);

  useEffect(() => {
    refresh();
    if (!target || !ui) return;
    const stage = relativeTo.current;
    const stopViewport = ui.viewport.observe(refresh);
    const stopDocument = ui.document.onChange(onClear);
    const resize = new ResizeObserver(refresh);
    if (stage) resize.observe(stage);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      stopViewport();
      stopDocument();
      resize.disconnect();
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [onClear, refresh, relativeTo, target, ui]);

  if (!target || geometry.target !== target) return null;
  return <div className="outline-target-highlights" aria-hidden="true">
    {geometry.rects.map((rect, index) => <div key={index} className="outline-target-highlight" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />)}
  </div>;
}
