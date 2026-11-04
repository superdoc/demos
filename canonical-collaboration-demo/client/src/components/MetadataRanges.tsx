import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SuperDoc } from 'superdoc';
import type { SelectionCapture, SelectionTarget, TextTarget, ViewportRect } from 'superdoc/ui';

type Props = {
  superdoc?: SuperDoc;
  documentKey: string;
  highlighted: boolean;
  disabled: boolean;
  onActivity: () => void;
};
type Entry = {
  id: string;
  payload: unknown;
  target: SelectionTarget | TextTarget;
};
type PaintedEntry = Entry & { rects: ViewportRect[] };
type Draft = {
  point: { x: number; y: number };
  capture?: SelectionCapture;
  version: ReturnType<SuperDoc['ui']['document']['getVersion']>;
  edit?: { id: string; payload: unknown };
};
type Field = { id: string; label: string; value: string; originalValue?: unknown; originalText?: string };
const newField = (): Field => ({ id: crypto.randomUUID(), label: '', value: '' });
const namespace = 'urn:superdoc:demos:metadata:1';

export function metadataFields(payload: unknown): [string, string][] {
  const fields: [string, unknown][] = payload !== null && typeof payload === 'object' ? Object.entries(payload) : [['Value', payload]];
  return fields.map(([label, value]) => [label, typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)]);
}

export function MetadataRanges({ superdoc, documentKey, highlighted, disabled, onActivity }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const enabled = useRef(false);
  const menuDraft = useRef<Draft | undefined>(undefined);
  const menuEntry = useRef<Entry | undefined>(undefined);
  const paintedEntries = useRef<PaintedEntry[]>([]);
  const mutating = useRef(false);
  const hoverTimer = useRef(0);
  enabled.current = !disabled;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [painted, setPainted] = useState<PaintedEntry[]>([]);
  paintedEntries.current = painted;
  const [hover, setHover] = useState<{ ids: string[]; x: number; y: number }>();
  const [draft, setDraft] = useState<Draft>();
  const [fields, setFields] = useState<Field[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!superdoc) return;
    let active = true;
    const unregister = superdoc.ui.commands.register({
      id: 'demo.addMetadata',
      getState: ({ selection }) => ({ disabled: !enabled.current || mutating.current || (!menuDraft.current?.capture && selection.empty) }),
      execute: ({ context, selection }) => {
        if (!enabled.current) return;
        const snapshot = menuDraft.current?.capture ?? context?.selection ?? selection;
        if (snapshot.empty || !(snapshot.target ?? snapshot.selectionTarget)) return;
        const point = context?.point ?? superdoc.ui.selection.getAnchorRect() ?? { x: 24, y: 150 };
        setDraft({ ...(menuDraft.current ?? { point: { x: 'x' in point ? point.x : point.left, y: 'y' in point ? point.y : point.top },
          version: superdoc.ui.document.getVersion() }), capture: { ...snapshot, capturedAt: Date.now() } });
        menuDraft.current = undefined;
        setFields([newField()]);
        setError('');
        setHover(undefined);
        superdoc.ui.contextMenu.close();
      },
    });
    const unregisterEdit = superdoc.ui.commands.register({
      id: 'demo.editMetadata',
      getState: () => ({ disabled: !enabled.current || mutating.current || !menuEntry.current }),
      execute: async () => {
        const entry = menuEntry.current;
        const context = menuDraft.current;
        const doc = superdoc.activeEditor?.doc;
        if (!enabled.current || !entry || !context || !doc || mutating.current) return;
        superdoc.ui.contextMenu.close();
        setHover(undefined);
        try {
          const info = await doc.metadata.get({ id: entry.id });
          if (!active) return;
          if (!info) throw new Error('This metadata no longer exists.');
          setDraft({ ...context, edit: { id: entry.id, payload: info.payload } });
          setFields(metadataFields(info.payload).map(([label, value]) => ({
            id: crypto.randomUUID(), label, value, originalText: value,
            originalValue: info.payload !== null && typeof info.payload === 'object'
              ? (info.payload as Record<string, unknown>)[label] : info.payload,
          })));
          setError('');
        } catch (caught) {
          if (active) setReadError(caught instanceof Error ? caught.message : String(caught));
        }
      },
    });
    const unregisterRemove = superdoc.ui.commands.register({
      id: 'demo.removeMetadata',
      getState: () => ({ disabled: !enabled.current || mutating.current || !menuEntry.current }),
      execute: async () => {
        const entry = menuEntry.current;
        const doc = superdoc.activeEditor?.doc;
        if (!enabled.current || !entry || !doc || mutating.current) return;
        mutating.current = true;
        superdoc.ui.contextMenu.close();
        setHover(undefined);
        try {
          const result = await doc.metadata.remove({ id: entry.id }, { changeMode: 'direct' });
          if (!result.success) throw new Error(result.failure.message);
          if (active) { setReadError(''); setRefresh((value) => value + 1); onActivity(); }
        } catch (caught) {
          if (active) setReadError(caught instanceof Error ? caught.message : String(caught));
        } finally { mutating.current = false; }
      },
    });
    const host = superdoc.ui.viewport.getHost();
    function captureMenu(event: MouseEvent) {
      const capture = superdoc!.ui.selection.capture();
      menuDraft.current = { point: { x: event.clientX, y: event.clientY }, capture: capture ?? undefined,
        version: superdoc!.ui.document.getVersion() };
      const bounds = layer.current?.getBoundingClientRect();
      const hits = bounds ? paintedEntries.current.flatMap((entry) =>
        superdoc!.ui.viewport.getRect({ target: entry.target, relativeTo: layer.current! }).rects
          .filter((rect) => event.clientX - bounds.left >= rect.left && event.clientX - bounds.left <= rect.right
            && event.clientY - bounds.top >= rect.top && event.clientY - bounds.top <= rect.bottom)
          .map((rect) => ({ entry, area: rect.width * rect.height }))) : [];
      // At overlapping ranges, edit/remove the smallest range under the pointer.
      menuEntry.current = hits.sort((a, b) => a.area - b.area)[0]?.entry;
    }
    host?.addEventListener('contextmenu', captureMenu, true);
    return () => { active = false; unregister(); unregisterEdit(); unregisterRemove(); host?.removeEventListener('contextmenu', captureMenu, true); };
  }, [superdoc, documentKey, onActivity]);

  useEffect(() => {
    if (!superdoc) return;
    let active = true;
    let sequence = 0;
    let timer = 0;
    async function read() {
      const request = ++sequence;
      const doc = superdoc!.activeEditor?.doc;
      if (!doc) return;
      try {
        const next: Entry[] = [];
        let offset = 0;
        let revision: string | undefined;
        while (active && request === sequence) {
          const page = await doc.metadata.list({ resolvedOnly: true, offset, limit: 100 });
          if (!active || request !== sequence) return;
          if (revision && page.evaluatedRevision !== revision) { schedule(); return; }
          revision = page.evaluatedRevision;
          const batch = await Promise.all(page.items.map(async ({ id }) => {
            const [info, resolved] = await Promise.all([doc.metadata.get({ id }), doc.metadata.resolve({ id })]);
            return info && resolved ? { id, payload: info.payload, target: resolved.target } : null;
          }));
          next.push(...batch.filter((entry): entry is Entry => entry !== null));
          offset += page.items.length;
          if (offset >= page.total || !page.items.length) break;
        }
        if (active && request === sequence) { setEntries(next); setReadError(''); }
      } catch (caught) {
        if (active && request === sequence) {
          setEntries([]);
          setReadError(`Could not load metadata: ${caught instanceof Error ? caught.message : String(caught)}`);
        }
      }
    }
    function schedule() {
      ++sequence;
      setEntries([]);
      setHover(undefined);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void read(), 80);
    }
    const unsubscribe = superdoc.ui.document.onChange(schedule);
    superdoc.on('document-replaced', schedule);
    void read();
    return () => { active = false; ++sequence; window.clearTimeout(timer); unsubscribe(); superdoc.off('document-replaced', schedule); };
  }, [superdoc, documentKey, refresh]);

  useEffect(() => {
    if (!superdoc) return;
    let frame = 0;
    function update() {
      frame = 0;
      if (!layer.current) return;
      setPainted(entries.map((entry) => ({ ...entry,
        rects: superdoc!.ui.viewport.getRect({ target: entry.target, relativeTo: layer.current! }).rects
          .filter((rect) => rect.width > 0 && rect.height > 0),
      })));
      setHover(undefined);
    }
    function schedule() { if (!frame) frame = window.requestAnimationFrame(update); }
    const unsubscribe = superdoc.ui.viewport.observe(schedule);
    schedule();
    return () => { window.cancelAnimationFrame(frame); unsubscribe(); };
  }, [superdoc, entries]);

  useEffect(() => {
    const pane = layer.current?.parentElement;
    if (!pane || draft || !highlighted) { setHover(undefined); return; }
    function move(event: PointerEvent) {
      if (!layer.current) return;
      const bounds = layer.current.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const ids = painted.filter((entry) => entry.rects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)).map((entry) => entry.id);
      if (ids.length) {
        window.clearTimeout(hoverTimer.current);
        setHover({ ids, x: event.clientX, y: event.clientY });
      } else {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setHover(undefined), 150);
      }
    }
    const leave = () => {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHover(undefined), 150);
    };
    pane.addEventListener('pointermove', move);
    pane.addEventListener('pointerleave', leave);
    return () => { window.clearTimeout(hoverTimer.current); pane.removeEventListener('pointermove', move); pane.removeEventListener('pointerleave', leave); };
  }, [painted, draft, highlighted]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element || !draft) return;
    if (!element.open) element.showModal();
    function position() {
      if (!element || !draft) return;
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(12, Math.min(draft.point.x, window.innerWidth - bounds.width - 12))}px`;
      element.style.top = `${Math.max(12, Math.min(draft.point.y, window.innerHeight - bounds.height - 12))}px`;
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    window.addEventListener('resize', position);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); };
  }, [draft]);

  function close() {
    if (saving) return;
    dialog.current?.close();
    if (draft?.capture && superdoc) superdoc.ui.selection.restore(draft.capture);
    setDraft(undefined);
  }

  async function save() {
    const doc = superdoc?.activeEditor?.doc;
    if (!doc || !draft || saving || disabled) return;
    const labels = fields.map((field) => field.label.trim());
    if (!fields.length || labels.some((label) => !label)) { setError('Give each field a label.'); return; }
    if (new Set(labels).size !== labels.length) { setError('Use a different label for each field.'); return; }
    if (draft.version !== superdoc.ui.document.getVersion()) {
      setError('The document changed. Cancel and select the text again.'); return;
    }
    const target = draft.capture?.target ?? draft.capture?.selectionTarget;
    if (!draft.edit && !target) return;
    setSaving(true);
    mutating.current = true;
    setError('');
    try {
      let payload: unknown = Object.fromEntries(fields.map((field, index) => [labels[index],
        'originalValue' in field && field.value === field.originalText ? field.originalValue : field.value]));
      if (draft.edit) {
        const original = metadataFields(draft.edit.payload);
        if (original.length === fields.length && fields.every((field, index) => labels[index] === original[index][0] && field.value === original[index][1])) {
          payload = draft.edit.payload;
        }
      }
      const result = draft.edit
        ? await doc.metadata.update({ id: draft.edit.id, payload }, { changeMode: 'direct' })
        : await doc.metadata.attach({ target: target!, namespace, payload }, { changeMode: 'direct' });
      if (!result.success) throw new Error(result.failure.message);
      dialog.current?.close();
      setDraft(undefined);
      setRefresh((value) => value + 1);
      onActivity();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { mutating.current = false; setSaving(false); }
  }

  const hovered = hover ? painted.filter((entry) => hover.ids.includes(entry.id)) : [];
  return <>
    <div className="metadata-highlights" ref={layer}>
      {highlighted && <div aria-hidden="true">{painted.flatMap((entry) => entry.rects.map((rect, index) =>
        <span className="metadata-highlight" key={`${entry.id}:${index}`} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />))}</div>}
      {readError && <p className="metadata-read-error" role="status">{readError}</p>}
    </div>
    {highlighted && hover && hovered.length > 0 && createPortal(<div role="tooltip" className="metadata-tooltip"
      onPointerEnter={() => window.clearTimeout(hoverTimer.current)}
      onPointerLeave={() => { hoverTimer.current = window.setTimeout(() => setHover(undefined), 150); }}
      style={{ left: Math.max(12, Math.min(hover.x + 14, window.innerWidth - 332)), top: Math.max(12, Math.min(hover.y + 18, window.innerHeight - 260)) }}>
      <div className="metadata-tooltip-title">Metadata</div>
      {hovered.map((entry) => <dl key={entry.id}>{metadataFields(entry.payload).map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>)}
    </div>, document.body)}
    {draft && createPortal(<dialog className="metadata-dialog" ref={dialog} aria-labelledby="metadata-title"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="metadata-dialog-heading"><h2 id="metadata-title">{draft.edit ? 'Edit metadata' : 'Add metadata'}</h2>
          <button type="button" className="metadata-add-field" aria-label="Add field" disabled={saving} onClick={() => setFields((current) => [...current, newField()])}>+</button>
        </div>
        <div className="metadata-fields">{fields.map((field, index) => <div className="metadata-field" key={field.id}>
          <div className="metadata-field-inputs">
            <label>Label<input autoFocus={index === 0} aria-label={`Label ${index + 1}`} value={field.label} disabled={saving}
              onChange={(event) => setFields((current) => current.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item))} /></label>
            <label>Value<textarea aria-label={`Value ${index + 1}`} rows={2} value={field.value} disabled={saving}
              onChange={(event) => setFields((current) => current.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item))} /></label>
          </div>
          <button type="button" className="metadata-remove-field" aria-label={`Remove field ${index + 1}`} disabled={saving}
            onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))}>×</button>
        </div>)}</div>
        {error && <p className="metadata-form-error" role="alert">{error}</p>}
        <div className="metadata-dialog-actions">
          <button type="button" disabled={saving} onClick={close}>Cancel</button>
          <button type="submit" className="metadata-done" disabled={saving || disabled}>{saving ? 'Saving…' : 'Done'}</button>
        </div>
      </form>
    </dialog>, document.body)}
  </>;
}
