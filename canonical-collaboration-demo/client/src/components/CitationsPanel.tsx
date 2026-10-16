import { useEffect, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { api } from '../api';
import { citationTarget, referenceDetails, type CitationSource } from '../references';
import type { Room } from '../types';
import type { DocumentMode } from './Topbar';

export function CitationsPanel({ room, superdoc, mode, disabled, refresh, onClose, onBusyChange, onInserted }: {
  room?: Room;
  superdoc?: SuperDoc;
  mode: DocumentMode;
  disabled: boolean;
  refresh: number;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onInserted: () => void;
}) {
  const [sources, setSources] = useState<CitationSource[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setSources([]);
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
    if (!room || !superdoc || disabled || mode === 'viewing') return;
    setError(''); setNotice('');
    onBusyChange(true);
    try {
      const at = await citationTarget(superdoc);
      if (!at) throw new Error('Place the cursor in the document, then double-click a citation.');
      const { evaluatedRevision } = await api.getCitationSources(room.room_id);
      const result = await api.insertCitation(room, { at, sourceIds: [source.sourceId] }, mode === 'suggesting' ? 'tracked' : 'direct', evaluatedRevision);
      if (!result.success) throw new Error(result.failure.message);
      setNotice(result.formattingWarning || `Inserted ${source.fields.title || source.tag}.`);
      onInserted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      onBusyChange(false);
    }
  }

  const filtered = sources.filter((source) => `${source.fields.title || source.tag} ${referenceDetails(source)}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <aside id="citations-panel" className="citations-panel" aria-label="Citations">
      <header>
        <div><h2>Citations <span>{sources.length}</span></h2><p>Double-click a reference to insert it.</p></div>
        <button className="citation-close" type="button" aria-label="Close citations panel" onClick={onClose}>×</button>
      </header>
      <div className="citations-search"><input aria-label="Search citations" placeholder="Search references…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="citations-list" aria-busy={loading}>
        {loading ? <p className="empty">Loading references…</p> : !sources.length ? <p className="empty">No references yet. Import a document with citations or use Insert citation to add one.</p>
          : !filtered.length ? <p className="empty">No matching references.</p> : filtered.map((source) => (
            <button type="button" className="citation-library-item" key={source.sourceId} disabled={disabled || mode === 'viewing'}
              title="Double-click to insert; press Enter to insert from the keyboard"
              onPointerDown={(event) => event.preventDefault()}
              onDoubleClick={() => void insert(source)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void insert(source); } }}>
              <span className="citation-kind">{source.type === 'journalArticle' ? 'Journal article' : source.type}</span>
              <strong>{source.fields.title || source.tag}</strong><small>{referenceDetails(source)}</small>
            </button>
          ))}
      </div>
      {(error || notice) && <p className={`citations-panel-status${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    </aside>
  );
}
