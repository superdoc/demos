import { useEffect, useRef, useState } from 'react';
import { SuperDoc } from 'superdoc';
import { DocumentToolbar } from '..';
import 'superdoc/style.css';

/** Standalone integration, including locked-control formatting and shortcuts. */
export function EditorWithToolbar({ documentUrl }: { documentUrl: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [superdoc, setSuperDoc] = useState<SuperDoc | null>(null);

  useEffect(() => {
    setSuperDoc(null);
    if (!mountRef.current) return;
    let disposed = false;
    const instance = new SuperDoc({
      selector: mountRef.current,
      document: documentUrl,
      documentMode: 'suggesting',
      ui: { toolbar: false },
      onReady: ({ superdoc: readyInstance }) => {
        if (!disposed) setSuperDoc(readyInstance);
      },
    });
    return () => {
      disposed = true;
      instance.destroy();
    };
  }, [documentUrl]);

  return (
    <section>
      <DocumentToolbar superdoc={superdoc} />
      <div ref={mountRef} />
    </section>
  );
}
