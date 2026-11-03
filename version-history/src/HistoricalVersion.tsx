import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { SuperDoc } from 'superdoc';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocUI } from 'superdoc/ui/react';
import { ChangesPanel } from './ChangesPanel';
import { DocumentEditor } from './DocumentEditor';
import { changeAuthor, changeDate, changeLabel, type Change } from './changes';

type Props = { file: File; panel: HTMLElement | null; stage: RefObject<HTMLElement | null> };

export function HistoricalVersion(props: Props) {
  // Each historical editor and its custom UI share one controller. The live
  // editor stays mounted independently and cannot overwrite this binding.
  return <SuperDocUIProvider><Preview {...props} /></SuperDocUIProvider>;
}

function Preview({ file, panel, stage }: Props) {
  const setSuperDoc = useSetSuperDoc();
  const onReady = useCallback((superdoc: SuperDoc) => {
    setSuperDoc(superdoc);
    stage.current?.scrollTo(0, 0);
  }, [setSuperDoc, stage]);

  return <>
    <DocumentEditor document={file} readOnly toolbarContainer="#version-document-toolbar" onReady={onReady} />
    {panel && createPortal(<ChangesPanel />, panel)}
    <ChangeHover stage={stage} />
  </>;
}

function ChangeHover({ stage }: { stage: RefObject<HTMLElement | null> }) {
  const ui = useSuperDocUI();
  const [hover, setHover] = useState<{ change: Change; x: number; y: number } | null>(null);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const element = stage.current;
    if (!element || !ui) return;
    const clear = () => { cancelAnimationFrame(frame.current ?? 0); setHover(null); };
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame.current ?? 0);
      const { clientX: x, clientY: y } = event;
      frame.current = requestAnimationFrame(() => {
        // Resolve through SuperDoc, including the change's story. No DOM ID parsing.
        const hit = ui.trackChanges.getAt({ x, y });
        setHover(hit ? { change: hit.item, x, y } : null);
      });
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', clear);
    element.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      cancelAnimationFrame(frame.current ?? 0);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', clear);
      element.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, [ui, stage]);

  if (!hover) return null;
  return createPortal(<div className="change-tooltip" role="tooltip" style={{
    left: Math.max(8, Math.min(hover.x + 16, window.innerWidth - 288)),
    top: Math.max(8, Math.min(hover.y + 18, window.innerHeight - 142)),
  }}>
    <strong>{changeAuthor(hover.change)}</strong>
    {hover.change.authorEmail && <span>{hover.change.authorEmail}</span>}
    <span>{changeLabel(hover.change)} · {changeDate(hover.change)}</span>
  </div>, document.body);
}
