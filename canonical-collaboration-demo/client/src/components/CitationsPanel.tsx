import { useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { api } from '../api';
import { citationTarget, referenceDetails, type CitationSource } from '../references';
import type { Room } from '../types';
import type { DocumentMode } from './Topbar';
import { CitationMenu } from './CitationMenu';

export function CitationsPanel({ room, superdoc, mode, disabled, refresh, onClose, onBusyChange, onInsertionBusyChange, onInserted }: {
  room?: Room;
  superdoc?: SuperDoc;
  mode: DocumentMode;
  disabled: boolean;
  refresh: number;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onInsertionBusyChange: (busy: boolean) => void;
  onInserted: () => void;
}) {
  const [sources, setSources] = useState<CitationSource[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [insertingSourceId, setInsertingSourceId] = useState<string>();
  const insertionPending = useRef(false);

  useEffect(() => { setSources([]); }, [room?.room_id, room?.generation]);

  useEffect(() => {
    let active = true;
    setError('');
    if (!room) return;
    setLoading(true);
    api.getCitationSources(room.room_id).then(({ items }) => {
      if (active) setSources(items);
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [room?.room_id, room?.generation, refresh]);

  async function insert(source: CitationSource) {
    if (!room || !superdoc || disabled || mode === 'viewing' || insertionPending.current) return;
    insertionPending.current = true;
    setInsertingSourceId(source.sourceId);
    setError(''); setNotice('');
    let busy = false;
    try {
      const at = await citationTarget(superdoc);
      if (!at) throw new Error('Place the cursor in the document, then double-click a citation.');
      // The loading state switches the editor to Viewing and can clear its live selection.
      busy = true;
      onInsertionBusyChange(true);
      const { evaluatedRevision } = await api.getCitationSources(room.room_id);
      const result = await api.insertCitation(room, { at, sourceIds: [source.sourceId] }, mode === 'suggesting' ? 'tracked' : 'direct', evaluatedRevision);
      if (!result.success) throw new Error(result.failure.message);
      setNotice(result.formattingWarning || `Inserted ${source.fields.title || source.tag}.`);
      onInserted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      insertionPending.current = false;
      setInsertingSourceId(undefined);
      if (busy) onInsertionBusyChange(false);
    }
  }

  const filtered = sources.filter((source) => `${source.fields.title || source.tag} ${referenceDetails(source)}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <aside id="citations-panel" className="citations-panel" aria-label="Citations">
      <header>
        <div><h2>Citations <span>{sources.length}</span></h2><p>Double-click a reference to insert it.</p></div>
        <button className="citation-close" type="button" aria-label="Close citations panel" onClick={onClose}>×</button>
      </header>
      <div className="citations-search">
        <CitationMenu referenceOnly superdoc={superdoc} room={room} mode={mode} disabled={disabled || !room || mode === 'viewing'}
          onBusyChange={onBusyChange} onInserted={() => { setQuery(''); setError(''); setNotice('Reference added.'); onInserted(); }} />
        <input aria-label="Search citations" placeholder="Search references…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="citations-list" aria-busy={loading}>
        {loading && !sources.length ? <p className="empty">Loading references…</p> : !sources.length ? <p className="empty">No references yet. Choose Add reference to save a source.</p>
          : !filtered.length ? <p className="empty">No matching references.</p> : filtered.map((source) => (
            <button type="button" className={`citation-library-item${insertingSourceId === source.sourceId ? ' is-inserting' : ''}`} key={source.sourceId} disabled={disabled || mode === 'viewing' || !!insertingSourceId}
              aria-busy={insertingSourceId === source.sourceId}
              title={insertingSourceId === source.sourceId ? 'Inserting citation…' : 'Double-click to insert; press Enter to insert from the keyboard'}
              onPointerDown={(event) => event.preventDefault()}
              onDoubleClick={() => void insert(source)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void insert(source); } }}>
              <span className="citation-library-heading">
                <span className="citation-kind">{source.type === 'journalArticle' ? 'Journal article' : source.type}</span>
                {insertingSourceId === source.sourceId && <span className="spinner citation-insert-spinner" aria-hidden="true" />}
              </span>
              {insertingSourceId === source.sourceId && <span className="visually-hidden" role="status">Inserting citation…</span>}
              <strong>{source.fields.title || source.tag}</strong><small>{referenceDetails(source)}</small>
            </button>
          ))}
      </div>
      {(error || notice) && <p className={`citations-panel-status${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    </aside>
  );
}
