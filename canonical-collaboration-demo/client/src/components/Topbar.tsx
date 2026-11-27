import buildCommand from '../build-app.sh?raw';
import { useEffect, useRef, useState } from 'react';
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
  connectedAgents: number;
  agentOpen: boolean;
  agentEnabled: boolean;
  onAgentToggle: () => void;
  onNewDocument: () => void;
  onUpload: (file: File) => void;
  onDownload: () => void;
  onModeChange: (mode: DocumentMode) => void;
  metadataHighlighted: boolean;
  onMetadataHighlightToggle: () => void;
  references: Omit<ReferencesToolbarProps, 'superdoc' | 'room' | 'mode' | 'disabled'>;
};

export function Topbar({
  roomId,
  room,
  busy,
  mode,
  superdoc,
  connectedUsers,
  connectedAgents,
  agentOpen,
  agentEnabled,
  onAgentToggle,
  onNewDocument,
  onUpload,
  onDownload,
  onModeChange,
  metadataHighlighted,
  onMetadataHighlightToggle,
  references,
}: TopbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const newDocumentDialog = useRef<HTMLDialogElement>(null);
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
    newDocumentDialog.current?.close();
    onUpload(file);
  }

  return (
    <header className="topbar">
      <div className="ribbon-tabs-row">
        <div className="file-actions" role="group" aria-label="File actions">
          <button type="button" className="file-action" disabled={busy || !roomId} aria-haspopup="dialog"
            onClick={() => newDocumentDialog.current?.showModal()}>
            New document
          </button>
          <button type="button" className="file-action" disabled={busy || !roomId || !room} onClick={onDownload}>Save As…</button>
          <a className="build-app-button more-demos-button" href="/">More demos</a>
        </div>

        <div className="file-title">
          <h1 className="file-name">{room?.filename ?? 'No document'}</h1>
        </div>

        <button type="button" className="build-app-button" onClick={() => buildDialog.current?.showModal()}>
          Build this
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
        <div className="connected-participants" role="status">
          <span title="Browser participants in this document, including you">
            <span className={`presence-dot${connectedUsers ? ' active' : ''}`} aria-hidden="true" />
            {connectedUsers === null ? 'Connecting…' : `${connectedUsers} ${connectedUsers === 1 ? 'user' : 'users'} connected`}
          </span>
          {connectedAgents > 0 && <span title="Document agents in this session">
            <span className="presence-dot agent" aria-hidden="true" />
            {`${connectedAgents} ${connectedAgents === 1 ? 'agent' : 'agents'} connected`}
          </span>}
        </div>
      </div>

      <dialog ref={newDocumentDialog} className="new-document-dialog" aria-labelledby="new-document-title"
        onClose={() => setImportError('')} onClick={(event) => {
          if (event.target === event.currentTarget) newDocumentDialog.current?.close();
        }}>
        <div className="new-document-dialog-content">
          <button type="button" className="build-dialog-close" aria-label="Close" onClick={() => newDocumentDialog.current?.close()}>×</button>
          <h2 id="new-document-title">New document</h2>
          {room && <p>This replaces the current document in the room.</p>}
          <div className="new-document-choices">
            <button type="button" className="file-action" disabled={busy} onClick={() => {
              newDocumentDialog.current?.close();
              onNewDocument();
            }}>Start blank</button>
            <button type="button" className="file-action" disabled={busy}
              onClick={() => fileInput.current?.click()}>Upload DOCX…</button>
          </div>
          <input ref={fileInput} hidden type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              uploadDocument(file);
            }} />
          {importError && <p className="error" role="alert">{importError}</p>}
        </div>
      </dialog>

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
          <p className="build-dialog-note">The command runs in an isolated Bash process and prompts for an OpenAI API key only when one is not already exported. This demo uses ephemeral memory storage, DOCX autosave off, and no WebSocket authentication. The optional example-token mode gates WebSocket access, but its demo token endpoint trusts the submitted user ID and is not application login.</p>
        </div>
      </dialog>

      <div className="ribbon-controls-row">
        <div id="superdoc-toolbar" className="default-toolbar" aria-label="Document toolbar" hidden={!!room && referencesActive}
          inert={busy} />
        {room && referencesActive && <ReferencesToolbar key={`${room.document_id}:${room.generation}`}
          {...references} superdoc={superdoc} room={room} mode={mode} disabled={busy || !room || !superdoc} />}
        {room && !referencesActive && <button type="button" className={`reference-command metadata-toggle${metadataHighlighted ? ' is-active' : ''}`}
          aria-pressed={metadataHighlighted} disabled={busy || !superdoc}
          onPointerDown={(event) => event.preventDefault()} onClick={onMetadataHighlightToggle}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM7 8h10M7 12h6M7 16h8" /></svg>
          Highlight metadata
        </button>}
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
