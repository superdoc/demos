import type { ContainerResolver } from '../types';
import { useEffect, useRef } from 'react';
import type { SuperDoc } from 'superdoc';
import type { DocumentMode } from '../types';
import { installTrackedReplacementCaretRepair } from '../workarounds/tracked-replacement-caret';

export function TrackedReplacementCaret({ superdoc, mode, disabled, getContainer }: {
  superdoc?: SuperDoc; mode: DocumentMode; disabled: boolean; getContainer?: ContainerResolver;
}) {
  const state = useRef({ mode, disabled });
  state.current = { mode, disabled };
  useEffect(() => {
    if (!superdoc) return;
    let root: HTMLElement | null | undefined;
    let repair: ReturnType<typeof installTrackedReplacementCaretRepair> | undefined;
    function mount() {
      const nextRoot = (getContainer?.(superdoc!) ?? superdoc!.ui.viewport.getHost());
      if (nextRoot === root) return;
      repair?.destroy();
      root = nextRoot;
      repair = root ? installTrackedReplacementCaretRepair({ root, selection: superdoc!.ui.selection,
        enabled: () => state.current.mode === 'suggesting' && !state.current.disabled }) : undefined;
    }
    function replaced() { repair?.cancel(); mount(); }
    const stop = superdoc.ui.viewport.observe(mount);
    superdoc.on('document-replaced', replaced);
    return () => {
      superdoc.off('document-replaced', replaced);
      stop();
      repair?.destroy();
    };
  }, [superdoc, getContainer]);
  return null;
}
