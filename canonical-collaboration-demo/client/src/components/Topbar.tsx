import { ChangeEvent, useRef, useState } from 'react';
import type { Room } from '../types';

export type DocumentMode = 'suggesting' | 'editing' | 'viewing';

type TopbarProps = {
  roomId: string;
  room?: Room;
  busy: boolean;
  mode: DocumentMode;
  onNewDocument: () => void;
  onUpload: (file: File) => void;
  onDownload: () => void;
  onDelete: () => void;
  onModeChange: (mode: DocumentMode) => void;
};

export function Topbar({
  roomId,
  room,
  busy,
  mode,
  onNewDocument,
  onUpload,
  onDownload,
  onDelete,
  onModeChange,
}: TopbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');

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
            disabled={!room}
            onChange={(event) => onModeChange(event.target.value as DocumentMode)}
          >
            <option value="suggesting">Reviewing</option>
            <option value="editing">Editing</option>
            <option value="viewing">Viewing</option>
          </select>
        </label>
      </div>

      <div className="ribbon-controls-row">
        <div id="superdoc-toolbar" className="default-toolbar" aria-label="Document toolbar" />
      </div>
    </header>
  );
}
