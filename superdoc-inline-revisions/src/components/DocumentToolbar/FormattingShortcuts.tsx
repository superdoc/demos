import { useEffect, useRef, useState } from 'react';
import type { ContentControlTarget } from 'superdoc/ui';
import { useSuperDocHost, useSuperDocUI } from 'superdoc/ui/react';
import { useSelectionFormatting } from './useSelectionFormatting';
import { runDocumentAction } from './documentActions';
import { isContentLocked } from './contentControlSelection';

function shortcut(event: KeyboardEvent): { command: string; payload?: unknown } | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  if (event.altKey) return !event.shiftKey && key === 'c' ? { command: 'clear-formatting' } : null;
  if (!event.shiftKey && ['b', 'i', 'u'].includes(key)) return { command: ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, string>)[key] };
  if (event.shiftKey && key === 'x') return { command: 'strikethrough' };
  if (event.shiftKey && key === 'h') return { command: 'highlight-color', payload: '#fff200' };
  if (event.code === 'Equal') return { command: event.shiftKey ? 'superscript' : 'subscript' };
  return null;
}

/** Formatting shortcuts use exactly the same mutation planner as the buttons. */
export function FormattingShortcuts() {
  const ui = useSuperDocUI();
  const host = useSuperDocHost();
  const formatting = useSelectionFormatting();
  const latest = useRef(formatting);
  latest.current = formatting;
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ui) return;
    const selectLockedControl = (event: PointerEvent) => {
      if (event.button !== 0 || latest.current.readOnly || !(event.target instanceof Element) || !ui.viewport.getHost()?.contains(event.target)) return;
      const doc = host?.activeEditor?.doc;
      const hit = ui.viewport.entityAt({ x: event.clientX, y: event.clientY }).find((entity) => entity.type === 'contentControl');
      if (!hit || !doc?.selection?.current || !doc.contentControls?.get) return;
      const readSelection = doc.selection.current.bind(doc.selection);
      const getControl = doc.contentControls.get.bind(doc.contentControls);
      const target: ContentControlTarget = { kind: hit.scope ?? 'inline', nodeType: 'sdt', nodeId: hit.id, ...(hit.story ? { story: hit.story as ContentControlTarget['story'] } : {}) };
      void runDocumentAction(doc, async () => {
        const selection = await readSelection();
        const range = selection.selectionTarget;
        // Keep deliberate text highlights, including partial selections in SDTs.
        if (!selection.empty && range?.start.kind === 'text' && range.end.kind === 'text' && (range.start.blockId !== range.end.blockId || range.start.offset !== range.end.offset)) return;
        const control = await getControl({ target });
        if (!isContentLocked(control) || !control.selectionTarget) return;
        ui.selection.apply(control.selectionTarget);
        await readSelection();
      }).catch(() => setError('The content control could not be selected.'));
    };
    const handle = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.target instanceof Element)) return;
      const editor = ui.viewport.getHost();
      if (!editor?.contains(event.target)) return;
      // Menu fields and other form controls keep their own keyboard behavior.
      if (event.target.closest('input, select, textarea, [contenteditable="true"]') && !event.target.closest('[data-v2-ime-host="true"]')) return;
      const match = shortcut(event);
      if (!match || latest.current.readOnly) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      setError('');
      void latest.current.execute(match.command, match.payload).catch(() => setError('The formatting could not be applied to this selection.'));
    };
    document.addEventListener('keydown', handle, true);
    document.addEventListener('pointerup', selectLockedControl);
    return () => {
      document.removeEventListener('keydown', handle, true);
      document.removeEventListener('pointerup', selectLockedControl);
    };
  }, [host, ui]);

  return error ? <div className="document-toolbar-status" role="status"><span>{error}</span><button type="button" aria-label="Dismiss shortcut message" onClick={() => setError('')}>×</button></div> : null;
}
