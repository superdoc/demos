import { useEffect, useRef, useState } from 'react';
import { DocumentEditor } from './DocumentEditor';
import { BuildThis } from './BuildThis';
import { HistoricalVersion } from './HistoricalVersion';
import { useVersionHistory, type Version, type OpenedVersion } from './useVersionHistory';
import { useRoomSession, type RoomSession } from './session';

const timestamp = (date: string) => new Date(date).toLocaleString(undefined, {
  month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
});

const saveLabels = {
  loading: 'Opening document…', ready: 'No version saved', pending: 'Unsaved changes',
  saving: 'Saving version…', saved: 'Version saved', error: 'Version not saved',
};

const galleryUrl = import.meta.env.DEV ? 'http://localhost:4173/' : '/';

export default function App() {
  const { session, error, waiting, retry } = useRoomSession();
  if (!session) return <main className="session-state">
    <h1>Version history</h1>
    {error ? <><p role="alert">{error}</p><button className="primary-button" onClick={retry}>Retry connection</button></>
      : <p role="status">{waiting ? 'Waiting for the first editor to initialize this room…' : 'Connecting to the shared document…'}</p>}
  </main>;
  return <Workspace session={session} />;
}

function Workspace({ session }: { session: RoomSession }) {
  const history = useVersionHistory(session);
  const [selected, setSelected] = useState<OpenedVersion | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const [connected, setConnected] = useState(false);
  const saving = history.status === 'saving';
  const stage = useRef<HTMLElement>(null);
  const [changesPanel, setChangesPanel] = useState<HTMLDivElement | null>(null);

  useEffect(() => { stage.current?.scrollTo(0, 0); }, [selected]);

  const selectVersion = async (version: Version | null) => {
    if (saving || opening) return;
    setOpenError('');
    if (!version) { setSelected(null); return; }
    setOpening(true);
    try { setSelected(await history.open(version)); }
    catch { setOpenError('This saved version could not be downloaded. Please try again.'); }
    finally { setOpening(false); }
  };

  return <div className="app-shell">
    <div className="document-column">
      <header className="topbar">
        <h1>{selected ? timestamp(selected.createdAt) : <>Current version <span className="room-name">· {session.roomId}</span></>}</h1>
        <a className="primary-button more-demos-button" href={galleryUrl}>More demos</a>
        {selected && <button className="primary-button" disabled={saving} onClick={() => void selectVersion(null)}>Back to current version</button>}
        <BuildThis />
        <span className="toolbar-status" role="status">{selected ? 'You’re viewing an earlier version' : saveLabels[history.status]}</span>
        <span className="connection-status" role="status">{connected ? 'Connected' : 'Reconnecting…'}</span>
        <span className={`mode-badge ${selected ? 'viewing' : ''}`}>{selected ? 'View only' : `Live · ${session.user.name}`}</span>
      </header>

      <div className="native-toolbar-shell">
        <div id="current-document-toolbar" hidden={selected !== null} inert={selected !== null || saving} />
        {selected && <div id="version-document-toolbar" key={selected.id} />}
      </div>

      {history.error && <div className="save-error" role="alert">
        <span>{history.error}</span>
        <button onClick={() => void history.save().catch(() => {})}>Retry</button>
      </div>}
      {history.recordError && <div className="save-error" role="alert">{history.recordError}</div>}

      <main ref={stage} className="document-stage" aria-label={selected ? 'Version preview' : 'Current document'}>
        <div className="editor-session" hidden={selected !== null} inert={selected !== null || saving}>
          <DocumentEditor document={`${import.meta.env.BASE_URL}document.docx`} session={session} onConnection={setConnected} toolbarContainer="#current-document-toolbar" onReady={history.onReady} onChange={history.onChange} />
        </div>
        {selected && <div className="editor-session" key={selected.id}>
          <HistoricalVersion version={selected} session={session} panel={changesPanel} stage={stage} />
        </div>}
      </main>
    </div>

    <aside className={`history-panel ${selected ? 'with-changes' : ''}`} aria-label="Version history">
      <h2>Version history</h2>
      <nav className="version-list" aria-label="Document versions">
        <div className={`current-version-card ${!selected ? 'selected' : ''}`}>
          <button className="version-card current-card" aria-current={!selected ? 'true' : undefined} disabled={saving || opening} onClick={() => void selectVersion(null)}>
            <span className="version-title">Current version <span className="live-label">Live</span></span>
            <span className="version-subtitle">Continue editing</span>
            <span className="version-author"><i />{session.user.name}</span>
          </button>
          <button className="save-version-button" disabled={!history.canSave || history.status === 'loading' || saving || !connected || selected !== null}
            onClick={() => void history.save().catch(() => {})}>{saving ? 'Saving version…' : 'Save version'}</button>
        </div>
        {history.versions.length > 0 && <h3>Today</h3>}
        {history.versions.map((version) => <button
          key={version.id}
          className={`version-card ${selected?.id === version.id ? 'selected' : ''}`}
          aria-current={selected?.id === version.id ? 'true' : undefined}
          aria-label={`Version ${version.number} · ${timestamp(version.createdAt)}`}
          disabled={saving || opening}
          onClick={() => void selectVersion(version)}
        >
          <span className="version-title">{timestamp(version.createdAt)}</span>
          <span className="version-subtitle">{`Version ${version.number}`}</span>
          <span className="version-author"><i />{version.createdBy.name}</span>
        </button>)}
        {history.versions.length === 0 && <p className="empty-history">No saved versions yet. Choose Save version to keep a snapshot.</p>}
      </nav>
      {opening && <p className="changes-message" role="status">Downloading version…</p>}
      {openError && <p className="changes-message error" role="alert">{openError}</p>}
      {history.listError && <div className="changes-message error" role="alert">{history.listError} <button onClick={() => void history.refresh()}>Refresh versions</button></div>}
      <div ref={setChangesPanel} className="changes-slot" hidden={!selected} />
      <p className="history-note">Shared room: {session.roomId}. Versions refresh every 5 seconds.</p>
    </aside>
  </div>;
}
