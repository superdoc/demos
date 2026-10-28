import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { StyleCatalogItem } from 'superdoc/ui';
import { useSuperDocDocument, useSuperDocUI } from 'superdoc/ui/react';
import './StyleGallery.css';
import { useSelectionFormatting } from './useSelectionFormatting';

export function StyleGallery() {
  const ui = useSuperDocUI();
  const document = useSuperDocDocument();
  const formatting = useSelectionFormatting();
  const [error, setError] = useState('');
  const [styles, setStyles] = useState<readonly StyleCatalogItem[]>([]);
  const [activeStyleId, setActiveStyleId] = useState<string | null>(null);

  useEffect(() => {
    if (!ui) return;
    const update = () => {
      const snapshot = ui.styles.getSnapshot();
      setStyles(snapshot.quickGallery);
      setActiveStyleId(snapshot.activeParagraphStyleId);
    };
    update();
    return ui.styles.observe(update);
  }, [ui]);

  return (
    <div className="document-toolbar-style-gallery" role="group" aria-label="Format styles">
      {styles.map((style) => (
        <button
          key={style.id}
          type="button"
          disabled={!document.ready || document.mode === 'viewing' || formatting.pending}
          className={activeStyleId === style.id ? 'is-active' : ''}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setError('');
            void formatting.execute('linked-style', style.id).catch(() => setError('The style could not be applied to this selection.'));
          }}
          aria-label={`Apply ${style.name}`}
        >
          <span style={(style.preview?.css ?? {}) as CSSProperties}>AaBbCcDd</span>
          <small>{style.name}</small>
        </button>
      ))}
      {error ? <span role="status">{error}</span> : null}
    </div>
  );
}

