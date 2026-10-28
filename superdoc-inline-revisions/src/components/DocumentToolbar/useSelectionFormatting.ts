import { useEffect, useRef, useState } from 'react';
import type { SelectionInfo } from 'superdoc/ui';
import { useSuperDocDocument, useSuperDocHost, useSuperDocSelection, useSuperDocToolbar, useSuperDocUI } from 'superdoc/ui/react';
import { getFormattingSelection, getSelectedContentControls, isContentLocked } from './contentControlSelection';
import { applySelectionChanges } from './mutationPlanner';
import type { SelectionChange } from './mutationPlanner';
import { checkReceipt } from './operationResults';
import { waitForDocumentAction } from './documentActions';

const INLINE_COMMANDS = {
  bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strike',
  'font-family': 'fontFamily', 'font-size': 'fontSize', 'text-color': 'color', 'highlight-color': 'highlight',
} as const;
const TOGGLES = new Set(['bold', 'italic', 'underline', 'strikethrough']);
const CLEAR_KEYS = ['bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'fontFamily', 'fontSize', 'vertAlign', 'smallCaps', 'caps', 'letterSpacing', 'dstrike'] as const;
const TRACKED_CLEAR_KEYS = ['bold', 'italic', 'underline', 'strike', 'color', 'highlight', 'fontFamily', 'fontSize', 'vertAlign'] as const;
const SELECTION_REASONS = new Set(['content-control-locked', 'range-selection-required', 'selection-required']);
const VERTICAL_COMMANDS = new Set(['subscript', 'superscript']);

/** Shared toolbar routing: ordinary selections use SuperDoc UI; locked ranges use an atomic plan. */
export function useSelectionFormatting() {
  const ui = useSuperDocUI();
  const host = useSuperDocHost();
  const selection = useSuperDocSelection();
  const document = useSuperDocDocument();
  const toolbar = useSuperDocToolbar();
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const doc = host?.activeEditor?.doc;
  const readOnly = !ui || !document.ready || document.mode === 'viewing';

  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      if (!ui || !doc?.selection?.current || !doc.plan?.execute) {
        if (!cancelled) setLocked(false);
        return;
      }
      try {
        await waitForDocumentAction(doc);
        const current = await getFormattingSelection(doc, ui);
        const controls = await getSelectedContentControls(doc, current);
        if (!cancelled) setLocked(controls.some(isContentLocked));
      } catch { if (!cancelled) setLocked(false); }
    };
    void update();
    const stop = ui?.contentControls.observe(() => void update());
    return () => { cancelled = true; stop?.(); };
  }, [doc, selection, ui]);

  const canExecute = (command: string) => {
    if (readOnly || pending) return false;
    const state = toolbar.commands[command];
    if (state?.enabled) return true;
    return locked && state?.supported === true && !!state.reason && SELECTION_REASONS.has(state.reason);
  };

  const withPending = async (work: () => Promise<void>) => {
    if (readOnly || busy.current) return;
    busy.current = true;
    setPending(true);
    try { await work(); }
    finally { busy.current = false; setPending(false); }
  };

  const changeMode = document.mode === 'suggesting' ? 'tracked' : 'direct';

  const applyChanges = (current: SelectionInfo, changes: SelectionChange[]) => withPending(async () => {
    if (doc) {
      await waitForDocumentAction(doc);
      await applySelectionChanges({ doc, selection: current, changes, changeMode });
    }
  });

  const execute = (command: string, payload?: unknown) => withPending(async () => {
    if (!ui || !doc?.selection?.current) return;
    await waitForDocumentAction(doc);
    if (!(command in INLINE_COMMANDS) && command !== 'clear-formatting' && !VERTICAL_COMMANDS.has(command)) {
      checkReceipt(await ui.commands.executeAsync(command, payload));
      return;
    }
    const current = await getFormattingSelection(doc, ui);
    if (current.empty || !current.selectionTarget) {
      checkReceipt(await ui.commands.executeAsync(command, payload));
      return;
    }
    const commandState = VERTICAL_COMMANDS.has(command) ? null : ui.commands.get(command).getState();
    if (commandState && !commandState.enabled && (!commandState.reason || !SELECTION_REASONS.has(commandState.reason))) {
      checkReceipt(await ui.commands.executeAsync(command, payload));
      return;
    }
    const target = current.selectionTarget;
    const options = { changeMode } as const;
    let changes: SelectionChange[];
    if (VERTICAL_COMMANDS.has(command)) {
      const formatting = await doc.format?.readSelection?.({ target, keys: ['vertAlign'] });
      const property = formatting?.properties.vertAlign;
      const active = property?.state === 'uniform' && property.value === command;
      const vertAlign = active ? 'baseline' : command as 'subscript' | 'superscript';
      changes = [{ kind: 'format', target, inline: { vertAlign } }];
    } else if (command in INLINE_COMMANDS) {
      const key = INLINE_COMMANDS[command as keyof typeof INLINE_COMMANDS];
      let value = payload;
      if (TOGGLES.has(command)) {
        const formatting = await doc.format?.readSelection?.({ target, keys: [key] });
        const property = formatting?.properties[key];
        const active = property?.state === 'uniform' && !!property.value;
        value = typeof payload === 'boolean' ? payload : !active;
      }
      if (command === 'highlight-color' && value === 'none') value = null;
      if (!TOGGLES.has(command)) {
        const formatting = await doc.format?.readSelection?.({ target, keys: [key], view: 'direct' });
        const property = formatting?.properties[key];
        if (property?.state === 'uniform' && property.value === value || property?.state === 'unset' && value === null) return;
      }
      changes = [{ kind: 'format', target, inline: { [key]: value } }];
    } else {
      const keys = changeMode === 'tracked' ? TRACKED_CLEAR_KEYS : CLEAR_KEYS;
      const direct = await doc.format?.readSelection?.({ target, keys, view: 'direct' });
      const hasDirectFormatting = Object.values(direct?.properties ?? {}).some((property) => property?.state === 'mixed' || property?.state === 'uniform' && property.value != null);
      const inline = Object.fromEntries(keys.map((key) => [key, null]));
      changes = hasDirectFormatting ? [{ kind: 'format', target, inline }] : [];
    }
    await applySelectionChanges({ doc, selection: current, changes, changeMode });
    if (command === 'clear-formatting') {
      if (!doc.invoke) throw new Error('Document operations are unavailable.');
      // Paragraph properties can be reset while the content lock stays in place.
      const defaultStyleId = ui.styles.getCatalog()?.defaults.paragraphStyleId ?? 'Normal';
      for (const { blockId } of current.target?.segments ?? []) {
        const paragraph = { kind: 'block', nodeType: 'paragraph', nodeId: blockId, ...(target.story ? { story: target.story } : {}) } as const;
        checkReceipt(await doc.invoke({ operationId: 'format.paragraph.resetDirectFormatting', input: { target: paragraph }, options }));
        const list = await doc.lists?.getState?.({ target: paragraph });
        if (list?.success && list.isListItem) checkReceipt(await doc.invoke({ operationId: 'lists.remove', input: { target: paragraph }, options }));
        checkReceipt(await doc.invoke({ operationId: 'styles.paragraph.setStyleRef', input: { target: paragraph, styleId: defaultStyleId }, options }));
      }
    }
  });

  return {
    execute, applyChanges, canExecute, pending, readOnly,
    getSelection: async () => {
      if (!doc || !ui) throw new Error('The document is unavailable.');
      await waitForDocumentAction(doc);
      return getFormattingSelection(doc, ui);
    },
  };
}
