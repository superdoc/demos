import { useCallback, useEffect, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { api } from './api';
import { ChatPanel } from './components/ChatPanel';
import { DocumentEditor } from './components/DocumentEditor';
import { Topbar, type DocumentMode } from './components/Topbar';
import type { Room } from './types';
import type { BibliographyStyle } from './references';
import { CitationsPanel } from './components/CitationsPanel';
import { FieldCodesView } from './components/FieldCodesView';

function hasSameDocumentMetadata(currentRoom: Room | undefined, nextRoom: Room | undefined) {
  if (!currentRoom || !nextRoom) return currentRoom === nextRoom;
  return currentRoom.room_id === nextRoom.room_id
    && currentRoom.document_id === nextRoom.document_id
    && currentRoom.generation === nextRoom.generation
    && currentRoom.filename === nextRoom.filename
    && currentRoom.collaboration_url === nextRoom.collaboration_url;
}

const params = new URLSearchParams(window.location.search);
const initialRoomId = params.get('room') ?? `room-${crypto.randomUUID()}`;
if (!params.has('room')) {
  const initialUrl = new URL(window.location.href);
  initialUrl.searchParams.set('room', initialRoomId);
  window.history.replaceState(null, '', initialUrl);
}

export default function App() {
  const roomId = initialRoomId;
  const [room, setRoom] = useState<Room>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<DocumentMode>('editing');
  const [chatWidth, setChatWidth] = useState(360);
  const [connectedUsers, setConnectedUsers] = useState<number | null>(null);
  const [superdoc, setSuperdoc] = useState<SuperDoc>();
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [bibliographyStyle, setBibliographyStyle] = useState<BibliographyStyle>('APA');
  const [pendingBibliographyStyle, setPendingBibliographyStyle] = useState<BibliographyStyle>();
  const [footnoteBusy, setFootnoteBusy] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceRefresh, setReferenceRefresh] = useState(0);
  const [fieldCodes, setFieldCodes] = useState(false);
  const refreshReferences = useCallback(() => setReferenceRefresh((current) => current + 1), []);

  useEffect(() => {
    const toggle = (event: globalThis.KeyboardEvent) => {
      if (event.altKey && (event.code === 'F9' || event.key === 'F9')) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && room && !referenceBusy && !document.querySelector('.citation-dialog[open]')) setFieldCodes((current) => !current);
      }
    };
    window.addEventListener('keydown', toggle, true);
    return () => window.removeEventListener('keydown', toggle, true);
  }, [room, referenceBusy]);

  useEffect(() => { setFieldCodes(false); }, [room?.room_id, room?.generation]);

  useEffect(() => {
    let active = true;
    if (room) api.getCitationSources(room.room_id).then((state) => {
      if (active) setBibliographyStyle(state.bibliographyStyle || 'APA');
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [room?.room_id, room?.generation, referenceRefresh]);

  useEffect(() => {
    superdoc?.on('document-replaced', refreshReferences);
    return () => { superdoc?.off('document-replaced', refreshReferences); };
  }, [superdoc, refreshReferences]);

  async function changeBibliographyStyle(style: BibliographyStyle) {
    if (!room || referenceBusy) return;
    setPendingBibliographyStyle(style);
    setReferenceBusy(true); setError(undefined);
    try {
      const { evaluatedRevision } = await api.getCitationSources(room.room_id);
      const result = await api.setBibliographyStyle(room, style, evaluatedRevision);
      if (!result.success) throw new Error('Could not update bibliography style.');
      setBibliographyStyle(result.bibliographyStyle);
      refreshReferences();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPendingBibliographyStyle(undefined);
      setReferenceBusy(false);
    }
  }
  const updateRoomActivity = useCallback(() => {
    if (room) void api.getRoomStatus(room.room_id, room.generation);
  }, [room]);

  useEffect(() => {
    let active = true;
    const updateStatus = async () => {
      try {
        const status = await api.getRoomStatus(roomId, room?.generation);
        if (!active) return;
        const nextRoom = status.document ?? undefined;
        setRoom((currentRoom) => hasSameDocumentMetadata(currentRoom, nextRoom) ? currentRoom : nextRoom);
        if (status.stale) {
          setError(status.document
            ? 'The document changed on the server. Reload the browser if the editor does not update.'
            : 'The document no longer exists. Reload the browser or create a new document.');
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void updateStatus();
    const timer = window.setInterval(() => void updateStatus(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [roomId, room?.generation]);

  async function upload(file: File) {
    setBusy(true);
    setError(undefined);
    try {
      setRoom(await api.uploadDocument(roomId, file));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createBlank() {
    setBusy(true);
    setError(undefined);
    try {
      setRoom(await api.createBlankDocument(roomId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!room) return;
    await api.deleteDocument(room.room_id);
    setRoom(undefined);
  }

  return (
    <main>
      <Topbar
        roomId={roomId}
        room={room}
        busy={busy || referenceBusy}
        mode={mode}
        connectedUsers={room && !busy ? connectedUsers : 0}
        onNewDocument={() => void createBlank()}
        onUpload={(file) => void upload(file)}
        onDownload={() => {
          if (room) window.location.assign(api.documentDownloadUrl(room.room_id));
        }}
        onDelete={() => void remove()}
        onModeChange={setMode}
        superdoc={superdoc}
        references={{ fieldCodes, citationsOpen, bibliographyStyle, pendingBibliographyStyle, footnoteBusy,
          onCitationsToggle: () => setCitationsOpen((current) => !current),
          onStyleChange: (style) => void changeBibliographyStyle(style),
          onFootnoteBusyChange: (pending) => { setFootnoteBusy(pending); setReferenceBusy(pending); },
          onBusyChange: setReferenceBusy, onInserted: refreshReferences }}
      />

      {error && <p className="banner error">{error}</p>}
      <section className="workspace">
        <div className="document-pane">
          {referenceBusy && !pendingBibliographyStyle && !footnoteBusy && <div className="reference-busy-overlay" role="status"><span className="spinner" />Updating references…</div>}
          {busy ? (
            <div className="upload-loading" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>Preparing document…</span>
            </div>
          ) : room ? (
            <>
            <div className="live-document" hidden={fieldCodes} inert={referenceBusy && !pendingBibliographyStyle && !footnoteBusy}>
            <DocumentEditor
              room={room}
              mode={pendingBibliographyStyle || footnoteBusy ? 'viewing' : mode}
              onActivity={updateRoomActivity}
              onConnectedUsersChange={setConnectedUsers}
              onReady={setSuperdoc}
            />
            </div>
            {fieldCodes && <FieldCodesView room={room} superdoc={superdoc} refresh={referenceRefresh} />}
            </>
          ) : (
            <div className="welcome">
              <h2>Upload a DOCX to start this room</h2>
              <p>Each room holds one ephemeral document. Uploading another file replaces it.</p>
            </div>
          )}
        </div>
        <ChatPanel
          roomId={roomId}
          disabled={!room || busy || referenceBusy}
          width={chatWidth}
          onWidthChange={setChatWidth}
          reservedWidth={citationsOpen ? 310 : 0}
        />
        {citationsOpen && <CitationsPanel room={room} superdoc={superdoc} mode={mode}
          disabled={busy || referenceBusy || fieldCodes} refresh={referenceRefresh}
          onClose={() => setCitationsOpen(false)} onBusyChange={setReferenceBusy} onInserted={refreshReferences} />}
      </section>
    </main>
  );
}
