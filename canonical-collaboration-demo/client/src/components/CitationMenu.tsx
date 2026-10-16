import { useRef, useState, type FormEvent } from 'react';
import type { SuperDoc } from 'superdoc';
import type { BrowserDocumentApi, TextTarget } from 'superdoc/ui';
import type { DocumentMode } from './Topbar';
import { api } from '../api';
import type { Room } from '../types';
import { citationTarget } from '../references';

type Source = Awaited<ReturnType<BrowserDocumentApi['citations']['sources']['get']>>;
type SourceType = Source['type'];

const sourceTypes: { value: SourceType; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'report', label: 'Report' },
  { value: 'journalArticle', label: 'Journal article' },
  { value: 'book', label: 'Book' },
  { value: 'case', label: 'Legal case' },
  { value: 'statute', label: 'Statute' },
  { value: 'misc', label: 'Other' },
];

function referenceText(fields: Source['fields']) {
  return [
    fields.authors?.map((author) => [author.first, author.middle, author.last].filter(Boolean).join(' ')).join(', '),
    fields.title,
    fields.year,
    fields.publisher || fields.journalName,
    fields.pages && `pp. ${fields.pages}`,
    fields.doi && `doi:${fields.doi}`,
    fields.url,
  ].filter(Boolean).join(' · ');
}

export function CitationMenu({ superdoc, room, mode, disabled, onBusyChange, onInserted }: {
  superdoc?: SuperDoc;
  room?: Room;
  mode: DocumentMode;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onInserted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const target = useRef<TextTarget | undefined>(undefined);
  const revision = useRef<string | undefined>(undefined);
  const browserRevision = useRef<string | undefined>(undefined);
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [newReference, setNewReference] = useState(true);
  const [sourceType, setSourceType] = useState<SourceType>('website');
  const [fields, setFields] = useState<Source['fields']>({});
  const [authors, setAuthors] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sourceFields: Source['fields'] = {
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])),
    authors: authors.split('\n').map((name) => name.trim()).filter(Boolean).map((last) => ({ last })),
  };

  async function open() {
    const doc = superdoc?.activeEditor?.doc;
    if (!doc || !room || pending) return;
    setPending(true);
    setError('');
    setNotice('');
    target.current = undefined;
    try {
      target.current = await citationTarget(superdoc!);
      browserRevision.current = (await doc.citations.sources.list({ limit: 1 })).evaluatedRevision;
      const { items: references, evaluatedRevision } = await api.getCitationSources(room.room_id);
      revision.current = evaluatedRevision;
      setSources(references);
      setSelected([]);
      setNewReference(references.length === 0);
      setFields({});
      setAuthors('');
      setSourceType('website');
      dialog.current?.showModal();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  }

  function close() {
    dialog.current?.close();
    button.current?.focus();
  }

  async function insert(event: FormEvent) {
    event.preventDefault();
    const doc = superdoc?.activeEditor?.doc;
    if (!doc || !room || !target.current || pending || mode === 'viewing') return;
    setPending(true);
    onBusyChange(true);
    setError('');
    try {
      if ((await doc.citations.sources.list({ limit: 1 })).evaluatedRevision !== browserRevision.current) {
        throw new Error('Document revision changed.');
      }
      let sourceIds = selected;
      if (newReference) {
        const result = await api.createCitationSource(room,
          { type: sourceType, fields: sourceFields },
          revision.current,
        );
        if (!result.success) throw new Error(result.failure.message);
        sourceIds = [result.source.sourceId];
        setSelected(sourceIds);
        setSources((current) => [...current, {
          address: result.source, sourceId: result.source.sourceId, tag: '', type: sourceType, fields: sourceFields,
        }]);
        setNewReference(false);
        const updatedSources = await api.getCitationSources(room.room_id);
        revision.current = updatedSources.evaluatedRevision;
      }
      const result = await api.insertCitation(room,
        { at: target.current, sourceIds },
        mode === 'suggesting' ? 'tracked' : 'direct', revision.current,
      );
      if (!result.success) throw new Error(result.failure.message);
      close();
      setNotice(result.formattingWarning || 'Citation inserted.');
      onInserted();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(/revision/i.test(message)
        ? 'The document changed while this menu was open. Close it, place your cursor again, and reopen Insert citation. Your saved references will be available.'
        : /text-range-in-field/i.test(message)
          ? 'Place your cursor outside the existing citation or field, then reopen Insert citation.'
        : message);
    } finally {
      setPending(false);
      onBusyChange(false);
    }
  }

  function field(label: string, key: keyof Source['fields'], type = 'text', required = false) {
    return <label className="citation-field">
      {label}
      <input type={type} required={required} value={String(fields[key] ?? '')}
        onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} />
    </label>;
  }

  return (
    <div className="citation-control">
      <button ref={button} className="reference-command" type="button" disabled={disabled || pending}
        aria-haspopup="dialog" onPointerDown={(event) => event.preventDefault()} onClick={() => void open()}>
        <span aria-hidden="true">❞</span> Insert citation
      </button>
      <span className="visually-hidden" role="status">{notice}</span>
      {notice && notice !== 'Citation inserted.' && <div className="citation-notice" role="alert">{notice}</div>}
      <dialog ref={dialog} className="citation-dialog" aria-labelledby="citation-title"
        onCancel={(event) => { event.preventDefault(); if (!pending) close(); }}>
        <form onSubmit={(event) => void insert(event)}>
          <header className="citation-header">
            <div><h2 id="citation-title">Insert citation</h2><p>Add a reference at your cursor, or after selected text.</p></div>
            <button type="button" className="citation-close" aria-label="Close citation menu" disabled={pending} onClick={close}>×</button>
          </header>
          <fieldset disabled={pending} className="citation-body">
            <div className="citation-tabs" role="group" aria-label="Reference selection">
              <button type="button" aria-pressed={!newReference} onClick={() => setNewReference(false)} disabled={!sources.length}>Existing references ({sources.length})</button>
              <button type="button" aria-pressed={newReference} onClick={() => setNewReference(true)}>New reference</button>
            </div>
            {newReference ? <>
              <div className="citation-fields">
                <label className="citation-field">Source type
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}>
                    {sourceTypes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                {field('Year', 'year')}
                <div className="citation-full-width">{field('Title *', 'title', 'text', true)}</div>
                <label className="citation-field citation-full-width">Authors or organizations (one per line)
                  <textarea rows={2} value={authors} onChange={(event) => setAuthors(event.target.value)} />
                </label>
                {field('Publisher / institution', 'publisher')}
                {field('Pages', 'pages')}
                {sourceType === 'journalArticle' && field('Journal', 'journalName')}
                {field('DOI', 'doi')}
                <div className="citation-full-width">{field('Source URL', 'url', 'url')}</div>
              </div>
              {sourceFields.title && <div className="citation-preview"><strong>Reference details</strong><p>{referenceText(sourceFields)}</p></div>}
            </> : <div className="citation-sources">
              <p>Choose a reference for this citation.</p>
              {sources.map((source) => <label key={source.sourceId} className="citation-source">
                <input type="radio" name="citation-source" checked={selected.includes(source.sourceId)}
                  onChange={() => setSelected([source.sourceId])} />
                <span><strong>{source.fields.title || source.tag}</strong><small>{referenceText(source.fields)}</small></span>
              </label>)}
            </div>}
          </fieldset>
          {error && <p className="citation-error error" role="alert">{error}</p>}
          <footer className="citation-footer">
            <span>{!target.current ? 'Place the cursor in the document before inserting a citation.'
              : mode === 'suggesting' ? 'Insert as a tracked suggestion' : 'Insert directly into the document'}</span>
            <button type="button" className="citation-cancel" disabled={pending} onClick={close}>Cancel</button>
            <button type="submit" disabled={pending || !target.current || (newReference ? !fields.title?.trim() : !selected.length)}>{pending ? 'Inserting…' : 'Insert citation'}</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
