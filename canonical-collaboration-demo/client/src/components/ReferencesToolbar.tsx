import { useState } from 'react';
import type { SuperDoc } from 'superdoc';
import type { TextTarget } from 'superdoc/ui';
import type { Room } from '../types';
import type { BibliographyStyle } from '../references';
import { citationTarget } from '../references';
import type { DocumentMode } from './Topbar';
import { CitationMenu } from './CitationMenu';
import { api } from '../api';
import { FootnoteNavigation } from './FootnoteNavigation';

export type ReferencesToolbarProps = {
  superdoc?: SuperDoc;
  room?: Room;
  mode: DocumentMode;
  disabled: boolean;
  fieldCodes: boolean;
  citationsOpen: boolean;
  bibliographyStyle: BibliographyStyle;
  pendingBibliographyStyle?: BibliographyStyle;
  footnoteBusy: boolean;
  onCitationsToggle: () => void;
  onStyleChange: (style: BibliographyStyle) => void;
  onBusyChange: (busy: boolean) => void;
  onFootnoteBusyChange: (busy: boolean) => void;
  onInserted: () => void;
};

export function ReferencesToolbar({ superdoc, room, mode, disabled, fieldCodes, citationsOpen,
  bibliographyStyle, pendingBibliographyStyle, footnoteBusy, onCitationsToggle, onStyleChange, onBusyChange, onFootnoteBusyChange, onInserted }: ReferencesToolbarProps) {
  const [error, setError] = useState('');
  const cannotEdit = disabled || fieldCodes || mode === 'viewing' || !superdoc || !room;

  async function insertFootnote() {
    const doc = superdoc?.activeEditor?.doc;
    if (cannotEdit) return;
    if (!doc) { setError('The editor is not ready. Click in document text and try again.'); return; }
    setError('');
    let noteId: string | undefined;
    try {
      const at = await citationTarget(superdoc!);
      if (!at) throw new Error('Place the cursor in document text before inserting a footnote.');
      onFootnoteBusyChange(true);
      const changeMode = mode === 'suggesting' ? 'tracked' : 'direct';
      let result = await doc.footnotes.insert({ at, type: 'footnote', content: '' }, { changeMode });
      if (!result.success && /footnotes\.insert currently supports/.test(result.failure.message)) {
        const { evaluatedRevision } = await api.getCitationSources(room!.room_id);
        result = await api.insertFootnote(room!, at, changeMode, evaluatedRevision);
      }
      if (!result.success) throw new Error(result.failure.message);
      noteId = result.footnote.noteId;
      onInserted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onFootnoteBusyChange(false);
    }
    if (!noteId || !superdoc) return;
    try {
      const story = { kind: 'story', storyType: 'footnote', noteId } as const;
      let paragraphs;
      const deadline = Date.now() + 10_000;
      do {
        try { paragraphs = await doc.find({ select: { type: 'node', nodeType: 'paragraph' }, in: story, limit: 1 }); }
        catch (caught) { if (Date.now() >= deadline) throw caught; }
        if (paragraphs?.items.length) break;
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      } while (Date.now() < deadline);
      const paragraph = paragraphs?.items[0]?.address;
      if (!paragraph || paragraph.kind !== 'block') throw new Error('The new footnote could not be located.');
      const point = { kind: 'text', blockId: paragraph.nodeId, offset: 0 } as const;
      const target: TextTarget = { kind: 'text', story, segments: [{ blockId: paragraph.nodeId, range: { start: 0, end: 0 } }] };
      const scrolled = await superdoc.ui.viewport.scrollIntoView({ target, block: 'center', behavior: 'instant' });
      if (!scrolled.success) throw new Error('The new footnote could not be scrolled into view.');
      superdoc.activeEditor?.focus?.();
      const applied = superdoc.ui.selection.apply({ kind: 'selection', story, start: point, end: point });
      if (!applied.ok) throw new Error('The new footnote could not be focused.');
    } catch (caught) {
      setError(`Footnote inserted. ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  return (
    <div className="references-toolbar" role="toolbar" aria-label="References toolbar">
      <div className="reference-group">
        <button type="button" className="reference-command" disabled={cannotEdit} aria-busy={footnoteBusy}
          onPointerDown={(event) => event.preventDefault()} onClick={() => void insertFootnote()}>
          <span className="footnote-command-icon" aria-hidden="true">
            {footnoteBusy ? <span className="spinner" /> : <>a<sup>1</sup></>}
          </span>
          Insert footnote
        </button>
        {footnoteBusy && <span className="visually-hidden" role="status">Inserting footnote…</span>}
        <FootnoteNavigation superdoc={superdoc} room={room} disabled={disabled || fieldCodes || !superdoc || !room} onError={setError} />
        <CitationMenu superdoc={superdoc} room={room} mode={mode} disabled={cannotEdit}
          onBusyChange={onBusyChange} onInserted={onInserted} />
      </div>
      <div className="reference-group">
        <button type="button" className={`reference-command${citationsOpen ? ' is-active' : ''}`}
          disabled={disabled || !room} aria-expanded={citationsOpen} aria-controls="citations-panel"
          onPointerDown={(event) => event.preventDefault()} onClick={onCitationsToggle}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" /></svg>
          Citations
        </button>
      </div>
      <label className="bibliography-style-select">
        <span>Bibliography style</span>
        <span className="bibliography-style-control" aria-busy={!!pendingBibliographyStyle}>
        <select aria-label="Bibliography style" value={pendingBibliographyStyle ?? bibliographyStyle} disabled={disabled || mode === 'viewing' || !room}
          title={bibliographyStyle === 'Chicago' ? 'Chicago author–date' : bibliographyStyle}
          onChange={(event) => onStyleChange(event.target.value as BibliographyStyle)}>
          <option value="APA">APA</option><option value="Chicago">Chicago</option><option value="MLA">MLA</option>
        </select>
        {pendingBibliographyStyle && <span className="bibliography-style-progress" role="status">
          <span className="spinner" aria-hidden="true" />
          <span className="visually-hidden">Updating bibliography style…</span>
        </span>}
        </span>
      </label>
      {error && <p className="reference-status error" role="alert">{error}</p>}
    </div>
  );
}
