import { ChangeEvent, useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { ReferencesToolbar, type ReferencesToolbarProps } from './ReferencesToolbar';
import { TrackedChangeActions } from './TrackedChangeActions';
import type { Room } from '../types';

export type DocumentMode = 'suggesting' | 'editing' | 'viewing';

type TopbarProps = {
  roomId: string;
  room?: Room;
  busy: boolean;
  mode: DocumentMode;
  superdoc?: SuperDoc;
  connectedUsers: number | null;
  onNewDocument: () => void;
  onUpload: (file: File) => void;
  onDownload: () => void;
  onDelete: () => void;
  onModeChange: (mode: DocumentMode) => void;
  references: Omit<ReferencesToolbarProps, 'superdoc' | 'room' | 'mode' | 'disabled'>;
};

export function Topbar({
  roomId,
  room,
  busy,
  mode,
  superdoc,
  connectedUsers,
  onNewDocument,
  onUpload,
  onDownload,
  onDelete,
  onModeChange,
  references,
}: TopbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const [referencesActive, setReferencesActive] = useState(false);

  useEffect(() => {
    if (!room) setReferencesActive(false);
  }, [room]);

  function uploadDocument(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setImportError('Choose a .docx file.');
      return;
    }
    setImportError('');
    onUpload(file);
    if (fileInput.current) fileInput.current.value = '';
  }

  function chooseFileAction(event: ChangeEvent<HTMLSelectElement>) {
    const action = event.target.value;
    event.target.value = '';
    if (action === 'new') onNewDocument();
    if (action === 'upload') fileInput.current?.click();
    if (action === 'save-as') onDownload();
    if (action === 'delete') onDelete();
  }

  return (
    <header className="topbar">
      <div className="ribbon-tabs-row">
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => uploadDocument(event.target.files?.[0])}
        />

        <select
          className="file-menu"
          aria-label="File"
          defaultValue=""
          disabled={busy || !roomId}
          title={importError || undefined}
          onChange={chooseFileAction}
        >
          <option value="" disabled>File</option>
          <option value="new">New Document</option>
          <option value="upload">{room ? 'Replace document…' : 'Upload document…'}</option>
          <option value="save-as" disabled={!room}>Save As…</option>
          <option value="delete" disabled={!room}>Delete document</option>
        </select>

        <div className="file-title">
          <div className="file-name">{room?.filename ?? 'No document'}</div>
        </div>

        <label className="mode-select">
          <span className="visually-hidden">Document mode</span>
          <select
            aria-label="Document mode"
            value={mode}
            disabled={busy || !room}
            onChange={(event) => onModeChange(event.target.value as DocumentMode)}
          >
            <option value="suggesting">Reviewing</option>
            <option value="editing">Editing</option>
            <option value="viewing">Viewing</option>
          </select>
        </label>
        <span className="connected-users" role="status" title="Browser participants in this document, including you">
          <span className={`presence-dot${connectedUsers ? ' active' : ''}`} aria-hidden="true" />
          {connectedUsers === null ? 'Connecting…' : `${connectedUsers} ${connectedUsers === 1 ? 'user' : 'users'} connected`}
        </span>
      </div>

      <div className="ribbon-controls-row">
        <div id="superdoc-toolbar" className="default-toolbar" aria-label="Document toolbar" hidden={!!room && referencesActive}
          inert={busy} />
        {room && referencesActive && <ReferencesToolbar key={`${room.document_id}:${room.generation}`}
          {...references} superdoc={superdoc} room={room} mode={mode} disabled={busy || !room || !superdoc} />}
        {room && !referencesActive && <TrackedChangeActions key={`${room.document_id}:${room.generation}`} superdoc={superdoc}
          disabled={busy || mode === 'viewing'} onUpdated={references.onInserted} />}
        {room && <button type="button" className="toolbar-switch" aria-label={referencesActive ? 'Home' : 'References'}
          aria-controls={referencesActive ? 'superdoc-toolbar' : undefined}
          onPointerDown={(event) => event.preventDefault()} onClick={() => setReferencesActive((current) => !current)}>
          <svg aria-hidden="true" viewBox="0 0 24 24">{referencesActive
            ? <path d="m3 11 9-8 9 8M5 10v11h5v-6h4v6h5V10" />
            : <path d="M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM14 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2" />}</svg>
          {referencesActive ? 'Home' : 'References'}
        </button>}
      </div>
    </header>
  );
}
