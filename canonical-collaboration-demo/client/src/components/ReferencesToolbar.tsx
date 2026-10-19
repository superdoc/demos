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
  renderingBusy: boolean;
  citationsHighlighted: boolean;
  footnotesHighlighted: boolean;
  citationsOpen: boolean;
  bibliographyStyle: BibliographyStyle;
  pendingBibliographyStyle?: BibliographyStyle;
  footnoteBusy: boolean;
  bibliographyBusy: boolean;
  onCitationsToggle: () => void;
  onRenderingToggle: () => void;
  onHighlightToggle: () => void;
  onFootnoteHighlightToggle: () => void;
  onStyleChange: (style: BibliographyStyle) => void;
  onBusyChange: (busy: boolean) => void;
  onFootnoteBusyChange: (busy: boolean) => void;
  onBibliographyBusyChange: (busy: boolean) => void;
  onInserted: () => void;
};

export function ReferencesToolbar({ superdoc, room, mode, disabled, fieldCodes, renderingBusy, citationsHighlighted, footnotesHighlighted, citationsOpen,
  bibliographyStyle, pendingBibliographyStyle, footnoteBusy, bibliographyBusy, onCitationsToggle, onRenderingToggle, onHighlightToggle, onFootnoteHighlightToggle, onStyleChange, onBusyChange, onFootnoteBusyChange, onBibliographyBusyChange, onInserted }: ReferencesToolbarProps) {
  const [error, setError] = useState('');
  const cannotEdit = disabled || mode === 'viewing' || !superdoc || !room;

  async function insertBibliography() {
    if (cannotEdit || mode !== 'editing' || bibliographyBusy) return;
    setError('');
    onBibliographyBusyChange(true);
    try {
      const { evaluatedRevision } = await api.getCitationSources(room!.room_id);
      const result = await api.insertBibliography(room!, evaluatedRevision);
      if (!result.success) throw new Error(result.failure.message);
      onInserted();
      if (result.formattingWarning) setError(result.formattingWarning);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onBibliographyBusyChange(false);
    }
  }

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
      <div className="reference-group reference-insert-group">
        <div className="reference-insert-actions" role="group" aria-label="Insert">
          <span className="reference-insert-label">Insert</span>
          <button type="button" className="reference-command" disabled={cannotEdit} aria-busy={footnoteBusy}
            onPointerDown={(event) => event.preventDefault()} onClick={() => void insertFootnote()}>
            <span className="footnote-command-icon" aria-hidden="true">
              {footnoteBusy ? <span className="spinner" /> : <>a<sup>1</sup></>}
            </span>
            <span className="insert-action-label"><span className="insert-action-full">Insert footnote</span><span className="insert-action-short">Footnote</span></span>
          </button>
          {footnoteBusy && <span className="visually-hidden" role="status">Inserting footnote…</span>}
          <CitationMenu superdoc={superdoc} room={room} mode={mode} disabled={cannotEdit}
            onBusyChange={onBusyChange} onInserted={onInserted} />
        </div>
        <FootnoteNavigation superdoc={superdoc} room={room} fieldCodes={fieldCodes} disabled={disabled || !superdoc || !room} onError={setError} />
      </div>
      <div className="reference-group">
        <button type="button" className="reference-command"
          disabled={cannotEdit || mode !== 'editing' || bibliographyBusy} aria-busy={bibliographyBusy}
          title={mode !== 'editing' ? 'Switch the document to Editing to insert a bibliography' : 'Insert a bibliography at the end of the document using the current style'}
          onPointerDown={(event) => event.preventDefault()} onClick={() => void insertBibliography()}>
          {bibliographyBusy ? <span className="spinner reference-render-spinner" aria-hidden="true" />
            : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 3h12v18H4zM8 7h4M8 11h4M8 15h3M20 6v8M16 10h8" /></svg>}
          Insert bibliography
        </button>
        {bibliographyBusy && <span className="visually-hidden" role="status">Inserting bibliography…</span>}
      </div>
      <div className="reference-display-controls">
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
        <div className="reference-highlight-group" role="group" aria-label="Highlight">
          <span className="reference-highlight-label">Highlight</span>
          <button type="button" className={`reference-command${citationsHighlighted ? ' is-active' : ''}`}
            disabled={!room || !superdoc} aria-pressed={citationsHighlighted}
            title="Highlight all citations in blue"
            onPointerDown={(event) => event.preventDefault()} onClick={onHighlightToggle}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 3 7 7-9 9-7-7zM5 12l-2 7 7-2M3 22h18" /></svg>
            Citations
          </button>
          <button type="button" className={`reference-command${footnotesHighlighted ? ' is-active' : ''}`}
            disabled={!room || !superdoc} aria-pressed={footnotesHighlighted}
            title="Highlight all footnote references in blue"
            onPointerDown={(event) => event.preventDefault()} onClick={onFootnoteHighlightToggle}>
            <span className="footnote-command-icon" aria-hidden="true">a<sup>1</sup></span>
            Footnotes
          </button>
        </div>
        <button type="button" className={`reference-command${!fieldCodes ? ' is-active' : ''}`}
          disabled={disabled || !room} aria-pressed={!fieldCodes} aria-keyshortcuts="Alt+F9"
          aria-busy={renderingBusy}
          aria-label="Render citations and bibliography"
          title={fieldCodes ? 'Render citations and bibliography' : 'Show citation and bibliography field codes'}
          onPointerDown={(event) => event.preventDefault()} onClick={onRenderingToggle}>
          {renderingBusy ? <span className="spinner reference-render-spinner" aria-hidden="true" />
            : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6" /></svg>}
          <span className="reference-command-label">Render citations &amp; bibliography<small>Opt-F9</small></span>
        </button>
        <button type="button" className={`reference-command${citationsOpen ? ' is-active' : ''}`}
          disabled={disabled || !room} aria-expanded={citationsOpen} aria-controls="citations-panel"
          onPointerDown={(event) => event.preventDefault()} onClick={onCitationsToggle}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" /></svg>
          Citations
        </button>

      </div>
      {error && <p className="reference-status error" role="alert">{error}</p>}
    </div>
  );
}
