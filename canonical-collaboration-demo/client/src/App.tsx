import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { api } from './api';
import { ChatPanel } from './components/ChatPanel';
import { DocumentEditor } from './components/DocumentEditor';
import { Topbar, type DocumentMode } from './components/Topbar';
import type { Room } from './types';
import type { BibliographyStyle } from './references';
import { CitationsPanel } from './components/CitationsPanel';
import { CitationHighlights } from './components/CitationHighlights';
import { FootnoteHighlights } from './components/FootnoteHighlights';
import { FootnoteReviewLabels } from './components/FootnoteReviewLabels';
import { TrackedReplacementCaret } from './components/TrackedReplacementCaret';
import { BibliographyDeletion } from './components/BibliographyDeletion';
import { CitationDeletion } from './components/CitationDeletion';

function hasSameDocumentMetadata(currentRoom: Room | undefined, nextRoom: Room | undefined) {
  if (!currentRoom || !nextRoom) return currentRoom === nextRoom;
  return currentRoom.room_id === nextRoom.room_id
    && currentRoom.document_id === nextRoom.document_id
    && currentRoom.generation === nextRoom.generation
    && currentRoom.filename === nextRoom.filename
    && currentRoom.collaboration_url === nextRoom.collaboration_url
    && currentRoom.field_codes === nextRoom.field_codes;
}

const params = new URLSearchParams(window.location.search);
const agentEnabled = import.meta.env.VITE_COLLABORATION_AGENT !== 'off';
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
  const [busy, setBusy] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const initialization = useRef<Promise<Room | undefined> | null>(null);
  const [mode, setMode] = useState<DocumentMode>('editing');
  const [chatWidth, setChatWidth] = useState(360);
  const [agentOpen, setAgentOpen] = useState(agentEnabled);
  const [connectedUsers, setConnectedUsers] = useState<number | null>(null);
  const [superdoc, setSuperdoc] = useState<SuperDoc>();
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [bibliographyStyle, setBibliographyStyle] = useState<BibliographyStyle>('APA');
  const [pendingBibliographyStyle, setPendingBibliographyStyle] = useState<BibliographyStyle>();
  const [footnoteBusy, setFootnoteBusy] = useState(false);
  const [bibliographyBusy, setBibliographyBusy] = useState(false);
  const [bibliographyDeletionBusy, setBibliographyDeletionBusy] = useState(false);
  const [citationDeletionBusy, setCitationDeletionBusy] = useState(false);
  const [citationInsertionBusy, setCitationInsertionBusy] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceRefresh, setReferenceRefresh] = useState(0);
  const [fieldCodes, setFieldCodes] = useState(false);
  const [renderingBusy, setRenderingBusy] = useState(false);
  const [citationsHighlighted, setCitationsHighlighted] = useState(false);
  const [footnotesHighlighted, setFootnotesHighlighted] = useState(false);
  const refreshReferences = useCallback(() => setReferenceRefresh((current) => current + 1), []);
  const onBibliographyDeletionBusy = useCallback((pending: boolean) => {
    setBibliographyDeletionBusy(pending);
    setReferenceBusy(pending);
  }, []);
  const onCitationDeletionBusy = useCallback((pending: boolean) => {
    setCitationDeletionBusy(pending);
    setReferenceBusy(pending);
  }, []);
  const onCitationInsertionBusy = useCallback((pending: boolean) => {
    setCitationInsertionBusy(pending);
    setReferenceBusy(pending);
  }, []);
  const toggleReferenceRendering = useCallback(async () => {
    if (!room || !superdoc || busy || referenceBusy || document.querySelector('.citation-dialog[open]')) return;
    setRenderingBusy(true);
    setReferenceBusy(true);
    setError(undefined);
    try {
      const current = await api.getCitationSources(room.room_id);
      const result = await api.setReferenceDisplay(room, !current.fieldCodes, current.evaluatedRevision);
      if (!result.success) throw new Error('Could not switch citation display.');
      setFieldCodes(result.fieldCodes);
      refreshReferences();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRenderingBusy(false);
      setReferenceBusy(false);
    }
  }, [room, superdoc, busy, referenceBusy, refreshReferences]);

  useEffect(() => {
    const toggle = (event: globalThis.KeyboardEvent) => {
      if (event.altKey && (event.code === 'F9' || event.key === 'F9')) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) void toggleReferenceRendering();
      }
    };
    window.addEventListener('keydown', toggle, true);
    return () => window.removeEventListener('keydown', toggle, true);
  }, [toggleReferenceRendering]);

  useEffect(() => { setFieldCodes(false); }, [room?.room_id, room?.generation]);
  useEffect(() => { setCitationsHighlighted(false); }, [room?.room_id, room?.generation]);
  useEffect(() => { setFootnotesHighlighted(false); }, [room?.room_id, room?.generation]);

  useEffect(() => {
    let active = true;
    if (room) api.getCitationSources(room.room_id).then((state) => {
      if (active) {
        setBibliographyStyle(state.bibliographyStyle || 'APA');
        setFieldCodes(state.fieldCodes ?? false);
      }
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
    initialization.current ??= api.initializeRoom(roomId);
    initialization.current.then((document) => {
      if (active) setRoom(document);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => {
      if (active) { setBusy(false); setInitialized(true); }
    });
    return () => { active = false; };
  }, [roomId]);

  useEffect(() => {
    if (!initialized) return;
    let active = true;
    const updateStatus = async () => {
      try {
        const status = await api.getRoomStatus(roomId, room?.generation);
        if (!active) return;
        const nextRoom = status.document ?? undefined;
        setRoom((currentRoom) => hasSameDocumentMetadata(currentRoom, nextRoom) ? currentRoom : nextRoom);
        setFieldCodes(nextRoom?.field_codes ?? false);
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
  }, [roomId, room?.generation, initialized]);

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
    <main className={citationInsertionBusy || renderingBusy ? 'is-loading-references' : undefined}>
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
        agentOpen={agentOpen}
        agentEnabled={agentEnabled}
        onAgentToggle={() => setAgentOpen((current) => !current)}
        references={{ fieldCodes, renderingBusy, citationsHighlighted, footnotesHighlighted, citationsOpen, bibliographyStyle, pendingBibliographyStyle, footnoteBusy, bibliographyBusy,
          onHighlightToggle: () => setCitationsHighlighted((current) => !current),
          onFootnoteHighlightToggle: () => setFootnotesHighlighted((current) => !current),
          onCitationsToggle: () => setCitationsOpen((current) => !current),
          onRenderingToggle: toggleReferenceRendering,
          onStyleChange: (style) => void changeBibliographyStyle(style),
          onFootnoteBusyChange: (pending) => { setFootnoteBusy(pending); setReferenceBusy(pending); },
          onBibliographyBusyChange: (pending) => { setBibliographyBusy(pending); setReferenceBusy(pending); },
          onBusyChange: setReferenceBusy, onInserted: refreshReferences }}
      />

      {error && <p className="banner error">{error}</p>}
      <section className="workspace">
        <div className="document-pane">
          {referenceBusy && !pendingBibliographyStyle && !footnoteBusy && !bibliographyBusy && !bibliographyDeletionBusy && !citationDeletionBusy && !citationInsertionBusy && !renderingBusy && <div className="reference-busy-overlay" role="status"><span className="spinner" />Updating references…</div>}
          {busy ? (
            <div className="upload-loading" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>Preparing document…</span>
            </div>
          ) : room ? (
            <div className="live-document" inert={referenceBusy && !pendingBibliographyStyle && !footnoteBusy && !bibliographyBusy && !bibliographyDeletionBusy && !citationDeletionBusy && !citationInsertionBusy && !renderingBusy}>
            <DocumentEditor
              room={room}
              mode={pendingBibliographyStyle || footnoteBusy || bibliographyBusy || bibliographyDeletionBusy || citationDeletionBusy || citationInsertionBusy || renderingBusy ? 'viewing' : mode}
              onActivity={updateRoomActivity}
              onConnectedUsersChange={setConnectedUsers}
              onReady={setSuperdoc}
            />
            <FootnoteReviewLabels superdoc={superdoc} />
            <TrackedReplacementCaret superdoc={superdoc} mode={mode} disabled={busy || referenceBusy} />
            <CitationDeletion superdoc={superdoc} room={room} mode={mode} disabled={busy || referenceBusy}
              onBusyChange={onCitationDeletionBusy} onUpdated={refreshReferences} onError={setError} />
            <BibliographyDeletion superdoc={superdoc} room={room} mode={mode} disabled={busy || referenceBusy}
              onBusyChange={onBibliographyDeletionBusy} onUpdated={refreshReferences} onError={setError} />
            {citationsHighlighted && <CitationHighlights key={`${room.document_id}:${room.generation}`}
              superdoc={superdoc} refresh={referenceRefresh} fieldCodes={fieldCodes} />}
            {footnotesHighlighted && <FootnoteHighlights key={`${room.document_id}:${room.generation}`}
              superdoc={superdoc} room={room} refresh={referenceRefresh} fieldCodes={fieldCodes} />}
            </div>
          ) : (
            <div className="welcome">
              <h2>No document in this room</h2>
              <p>Create a new document or upload a DOCX using the buttons above.</p>
            </div>
          )}
        </div>
        {agentEnabled && <ChatPanel
          hidden={!agentOpen}
          roomId={roomId}
          superdoc={superdoc}
          documentKey={room ? `${room.document_id}:${room.generation}` : undefined}
          disabled={!room || busy || referenceBusy}
          width={chatWidth}
          onWidthChange={setChatWidth}
          onDocumentUpdated={refreshReferences}
          reservedWidth={citationsOpen ? 310 : 0}
        />}
        {citationsOpen && <CitationsPanel room={room} superdoc={superdoc} mode={mode}
          disabled={busy || referenceBusy} refresh={referenceRefresh}
          onClose={() => setCitationsOpen(false)} onBusyChange={setReferenceBusy}
          onInsertionBusyChange={onCitationInsertionBusy} onInserted={refreshReferences} />}
      </section>
    </main>
  );
}
