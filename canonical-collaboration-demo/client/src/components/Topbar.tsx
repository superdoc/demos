import { useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { ReferencesToolbar, type ReferencesToolbarProps } from './ReferencesToolbar';
import { TrackedChangeActions } from './TrackedChangeActions';
import type { Room } from '../types';

export type DocumentMode = 'suggesting' | 'editing' | 'viewing';

const buildCommand = `set -e

git clone https://github.com/superdoc/demos.git
cd demos/canonical-collaboration-demo

# Build configuration
export COLLABORATION_API=on
export COLLABORATION_CLIENT=on
export COLLABORATION_AGENT=on

make build

# Runtime configuration for this demo
export COLLABORATION_AUTH=none
export COLLABORATION_STORAGE=memory
export COLLABORATION_DOCX=off

if [[ -z "\${OPENAI_API_KEY:-}" ]]; then
  read -rsp "OpenAI API key: " OPENAI_API_KEY
  echo
  export OPENAI_API_KEY
fi

touch .env
make dev`;

type TopbarProps = {
  roomId: string;
  room?: Room;
  busy: boolean;
  mode: DocumentMode;
  superdoc?: SuperDoc;
  connectedUsers: number | null;
  agentOpen: boolean;
  agentEnabled: boolean;
  onAgentToggle: () => void;
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
  agentOpen,
  agentEnabled,
  onAgentToggle,
  onNewDocument,
  onUpload,
  onDownload,
  onDelete,
  onModeChange,
  references,
}: TopbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const buildDialog = useRef<HTMLDialogElement>(null);
  const [importError, setImportError] = useState('');
  const [referencesActive, setReferencesActive] = useState(false);
  const [buildCommandCopied, setBuildCommandCopied] = useState(false);

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

        <div className="file-actions" role="group" aria-label="File actions" title={importError || undefined}>
          <button type="button" className="file-action" disabled={busy || !roomId} onClick={onNewDocument}>New Document</button>
          <button type="button" className="file-action" disabled={busy || !roomId} onClick={() => fileInput.current?.click()}>
            {room ? 'Replace document…' : 'Upload document…'}
          </button>
          <button type="button" className="file-action" disabled={busy || !roomId || !room} onClick={onDownload}>Save As…</button>
          <button type="button" className="file-action file-action-delete" disabled={busy || !roomId || !room} onClick={onDelete}>Delete document</button>
        </div>

        <div className="file-title">
          <div className="file-name">{room?.filename ?? 'No document'}</div>
        </div>

        <button type="button" className="build-app-button" onClick={() => buildDialog.current?.showModal()}>
          Build this app
        </button>
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

      <dialog ref={buildDialog} className="build-dialog" aria-labelledby="build-dialog-title"
        onClose={() => setBuildCommandCopied(false)} onClick={(event) => {
          if (event.target === event.currentTarget) buildDialog.current?.close();
        }}>
        <div className="build-dialog-header">
          <div>
            <h2 id="build-dialog-title">Build this app</h2>
            <p>Copy this Bash snippet to clone, build, and run the same configuration as this demo.</p>
          </div>
          <button type="button" className="build-dialog-close" aria-label="Close" onClick={() => buildDialog.current?.close()}>×</button>
        </div>
        <div className="build-dialog-body">
          <pre><code>{buildCommand}</code></pre>
          <button type="button" className="build-command-copy" onClick={async () => {
            await navigator.clipboard.writeText(buildCommand);
            setBuildCommandCopied(true);
          }}>{buildCommandCopied ? 'Copied' : 'Copy all commands'}</button>
          <a className="build-readme-link" href="https://github.com/superdoc/demos/blob/main/canonical-collaboration-demo/README.md"
            target="_blank" rel="noreferrer">View the README on GitHub</a>
          <p className="build-dialog-note">The command prompts for an OpenAI API key only when one is not already exported. This demo runs with ephemeral memory storage, DOCX autosave off, and no WebSocket authentication.</p>
        </div>
      </dialog>

      <div className="ribbon-controls-row">
        <div id="superdoc-toolbar" className="default-toolbar" aria-label="Document toolbar" hidden={!!room && referencesActive}
          inert={busy} />
        {room && referencesActive && <ReferencesToolbar key={`${room.document_id}:${room.generation}`}
          {...references} superdoc={superdoc} room={room} mode={mode} disabled={busy || !room || !superdoc} />}
        {room && !referencesActive && <TrackedChangeActions key={`${room.document_id}:${room.generation}`} superdoc={superdoc}
          disabled={busy || mode === 'viewing'} onUpdated={references.onInserted} />}
        {room && agentEnabled && !referencesActive && <button type="button" className={`reference-command agent-toggle${agentOpen ? ' is-active' : ''}`}
          aria-expanded={agentOpen} aria-controls="agent-panel"
          onPointerDown={(event) => event.preventDefault()} onClick={onAgentToggle}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v13H9l-5 4zM8 9h8M8 13h5" /></svg>
          Agent
        </button>}
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
