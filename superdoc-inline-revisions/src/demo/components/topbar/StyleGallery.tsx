import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { StyleCatalogItem } from 'superdoc/ui';
import { useSuperDocUI } from 'superdoc/ui/react';

export function StyleGallery() {
  const ui = useSuperDocUI();
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
    <div className="style-gallery" aria-label="Format styles">
      {styles.map((style) => (
        <button
          key={style.id}
          className={activeStyleId === style.id ? 'is-active' : ''}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => ui?.commands.execute('linked-style', style.id)}
          aria-label={`Apply ${style.name}`}
        >
          <span style={(style.preview?.css ?? {}) as CSSProperties}>AaBbCcDd</span>
          <small>{style.name}</small>
        </button>
      ))}
    </div>
  );
}

