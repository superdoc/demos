import { useEffect, useState } from 'react';
import { api } from './api';
import { ChatPanel } from './components/ChatPanel';
import { DocumentEditor } from './components/DocumentEditor';
import { Topbar, type DocumentMode } from './components/Topbar';
import type { Room } from './types';

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

  useEffect(() => {
    return api.watchRoom(
      roomId,
      (nextRoom) => {
        setRoom(nextRoom);
        setError(undefined);
      },
      (eventError) => setError(eventError.message),
    );
  }, [roomId]);

  useEffect(() => {
    if (!room) return;
    const timer = window.setInterval(() => void api.sendRoomHeartbeat(room), 30_000);
    return () => window.clearInterval(timer);
  }, [room]);

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
        busy={busy}
        mode={mode}
        onNewDocument={() => void createBlank()}
        onUpload={(file) => void upload(file)}
        onDownload={() => {
          if (room) window.location.assign(api.documentDownloadUrl(room.room_id));
        }}
        onDelete={() => void remove()}
        onModeChange={setMode}
      />

      {error && <p className="banner error">{error}</p>}
      <section className="workspace" style={{ gridTemplateColumns: `minmax(680px, 1fr) ${chatWidth}px` }}>
        <div className="document-pane">
          {busy ? (
            <div className="upload-loading" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>Preparing document…</span>
            </div>
          ) : room ? (
            <DocumentEditor
              room={room}
              mode={mode}
              onActivity={() => void api.sendRoomHeartbeat(room)}
            />
          ) : (
            <div className="welcome">
              <h2>Upload a DOCX to start this room</h2>
              <p>Each room holds one ephemeral document. Uploading another file replaces it.</p>
            </div>
          )}
        </div>
        <ChatPanel
          roomId={roomId}
          disabled={!room || busy}
          width={chatWidth}
          onWidthChange={setChatWidth}
        />
      </section>
    </main>
  );
}
