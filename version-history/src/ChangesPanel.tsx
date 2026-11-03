import { useEffect, useMemo, useRef, useState } from 'react';
import { useSuperDocDocumentApi, useSuperDocTrackChanges, useSuperDocUI } from 'superdoc/ui/react';
import { changeAuthor, changeDate, changeKey, changeLabel, changeText, orderChanges, type Change, type ChangeOrder } from './changes';

export function ChangesPanel() {
  const api = useSuperDocDocumentApi();
  const ui = useSuperDocUI();
  const tracked = useSuperDocTrackChanges();
  const [changes, setChanges] = useState<Change[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [order, setOrder] = useState<ChangeOrder>('newest');
  const [attempt, setAttempt] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState('');
  const [navigating, setNavigating] = useState(false);
  const navigation = useRef(0);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    setState('loading');
    setChanges([]);
    void (async () => {
      const result: Change[] = [];
      let offset = 0;
      let total = 0;
      do {
        // Read the reopened snapshot, not a catalog belonging to the live editor.
        const page = await api.trackChanges.list({ in: 'all', limit: 200, offset });
        if (!alive) return;
        if (page.items.length === 0 && offset < page.total) throw new Error('Incomplete change catalog');
        result.push(...page.items);
        offset += page.items.length;
        total = page.total;
      } while (offset < total);
      setChanges(result);
      setState('ready');
    })().catch(() => { if (alive) setState('error'); });
    return () => { alive = false; navigation.current += 1; };
  }, [api, attempt]);

  const sorted = useMemo(() => orderChanges(changes, order), [changes, order]);
  const ready = state === 'ready' && tracked.listStatus === 'ready';

  const showChange = async (change: Change) => {
    if (!ui || !ready) return;
    const request = ++navigation.current;
    setNavigating(true);
    setNavigationError('');
    const target = { id: change.id, story: change.address.story };
    try {
      if (!ui.trackChanges.setActive(target)) throw new Error('Change unavailable');
      setActiveKey(changeKey(change));
      const result = await ui.trackChanges.scrollTo(target);
      if (!result.success) throw new Error('Location unavailable');
    } catch {
      if (navigation.current === request) setNavigationError('This edit could not be located in the document.');
    } finally {
      if (navigation.current === request) setNavigating(false);
    }
  };

  return <section className="changes-panel" aria-label="Version edits" aria-busy={state === 'loading'}>
    <div className="changes-heading"><h2>Edits in this version</h2>{state === 'ready' && <span className="change-count">{changes.length}</span>}</div>
    <label className="change-sort">Sort edits
      <select value={order} onChange={(event) => setOrder(event.target.value as ChangeOrder)}>
        <option value="newest">Most recent first</option>
        <option value="oldest">Oldest first</option>
        <option value="author">Author (A–Z)</option>
      </select>
    </label>
    {state === 'loading' && <p className="changes-message" role="status">Loading edits…</p>}
    {state === 'error' && <div className="changes-message" role="alert">Edits could not be loaded. <button onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>}
    {navigationError && <p className="changes-message error" role="alert">{navigationError}</p>}
    {state === 'ready' && changes.length === 0 && <p className="changes-message">No tracked edits in this version.</p>}
    <ol className="change-list" aria-label="Tracked edits">
      {sorted.map((change) => {
        const key = changeKey(change);
        const active = activeKey === key && tracked.activeId === change.id;
        return <li key={key}>
          <button className={`change-card ${active ? 'selected' : ''}`} aria-current={active ? 'true' : undefined}
            disabled={!ready || navigating} onClick={() => void showChange(change)}>
            <span className="change-card-heading"><strong>{changeAuthor(change)}</strong><span className={`change-kind ${change.type}`}>{changeLabel(change)}</span></span>
            <span className="change-excerpt">{changeText(change)}</span>
            <time dateTime={change.date || undefined}>{changeDate(change)}</time>
          </button>
        </li>;
      })}
    </ol>
  </section>;
}
