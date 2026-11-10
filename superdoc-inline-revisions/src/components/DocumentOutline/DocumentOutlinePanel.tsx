import { useEffect, useRef, useState } from 'react';
import { useSuperDocDocumentApi, useSuperDocHost, useSuperDocUI } from 'superdoc/ui/react';
import OutlineNavigation from './OutlineNavigation';
import { useOutline } from './use-outline';
import { revealOutlineEntry, type OutlineEntry } from '../../superdoc/outline';
import './DocumentOutlinePanel.css';

export function DocumentOutlinePanel({ documentVersion, width, onResize, onResizing, onClose }: {
  documentVersion: number;
  width: number;
  onResize: (width: number) => void;
  onResizing: (resizing: boolean) => void;
  onClose: () => void;
}) {
  const doc = useSuperDocDocumentApi();
  const ui = useSuperDocUI();
  const host = useSuperDocHost();
  const outline = useOutline(doc, ui, host, documentVersion);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [maximum, setMaximum] = useState(640);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const request = useRef(0);

  useEffect(() => {
    setActive(null);
    setError('');
    return () => { request.current++; };
  }, [doc, outline.documentVersion, documentVersion]);

  useEffect(() => {
    const workspace = panel.current?.parentElement;
    if (!workspace) return;
    const observer = new ResizeObserver(() => {
      const max = Math.max(300, Math.min(640, workspace.clientWidth - 600));
      setMaximum(max);
      if (width > max) onResize(max);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [onResize, width]);

  useEffect(() => () => onResizing(false), [onResizing]);

  async function navigate(item: OutlineEntry) {
    if (!doc || !ui) return;
    const generation = ++request.current;
    setError('');
    try {
      const reached = await revealOutlineEntry(doc, ui, item, () => generation === request.current);
      if (generation !== request.current) return;
      if (!reached) throw new Error('Unreachable heading');
      setActive(item.id);
    } catch {
      if (generation === request.current) setError('This section could not be reached. Try again.');
    }
  }

  function resize(next: number) {
    onResize(Math.max(300, Math.min(maximum, next)));
  }
  function finishDrag() {
    drag.current = null;
    onResizing(false);
  }

  return <>
    <aside ref={panel} className="document-outline-panel" id="document-outline-panel" aria-label="Document outline">
      <div className="document-outline-heading">
        <h2>Document outline</h2>
        <button type="button" aria-label="Close document outline" onClick={onClose}>×</button>
      </div>
      {error && <p className="document-outline-error" role="alert">{error}</p>}
      {outline.loading ? <p role="status">Reading headings…</p>
        : outline.error ? <p role="alert">{outline.error}</p>
        : !outline.entries.length ? <div className="document-outline-empty"><strong>No headings found.</strong><p>Inserting a heading to see it here</p></div>
        : <OutlineNavigation items={outline.entries} activeId={active} disabled={!doc || !ui} onNavigate={(id) => {
          const item = outline.entries.find((entry) => entry.id === id);
          if (item) void navigate(item);
        }} />}
    </aside>
    <div className="document-outline-resize" role="separator" tabIndex={0} aria-label="Resize document outline" aria-orientation="vertical" aria-controls="document-outline-panel" aria-valuemin={300} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width} pixels wide`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        onResizing(true);
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.width + event.clientX - drag.current.x);
      }}
      onPointerUp={(event) => {
        finishDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={finishDrag}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 24;
        if (event.key === 'ArrowRight') resize(width + step);
        else if (event.key === 'ArrowLeft') resize(width - step);
        else if (event.key === 'Home') resize(300);
        else if (event.key === 'End') resize(maximum);
        else return;
        event.preventDefault();
      }} />
  </>;
}
