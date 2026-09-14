import { useEffect, useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import { getDocumentBlob } from '../api';
import type { Room } from '../types';
import type { DocumentMode } from './Topbar';

type DocumentEditorProps = {
  room: Room;
  mode: DocumentMode;
  onActivity: () => void;
};

export function DocumentEditor({ room, mode, onActivity }: DocumentEditorProps) {
  const [documentBlob, setDocumentBlob] = useState<Blob>();
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setDocumentBlob(undefined);
    setLoadError(undefined);
    getDocumentBlob(room.room_id, controller.signal)
      .then(setDocumentBlob)
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [room.document_id, room.room_id]);

  if (loadError) return <div className="editor-state error">{loadError}</div>;
  if (!documentBlob) return <div className="editor-state">Loading document…</div>;

  return (
    <div className="editor-shell" onPointerDown={onActivity} onKeyDown={onActivity}>
      <SuperDocEditor
        key={room.document_id}
        documentMode={mode}
        modules={{
          trackChanges: {
            enabled: true,
            mode: 'review',
            visible: true,
          },
        }}
        rulers
        ui={{ toolbar: { container: '#superdoc-toolbar' }, loading: false }}
        documents={[
          {
            id: room.document_id,
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data: documentBlob,
            v2Collaboration: {
              providerType: 'hocuspocus',
              documentId: room.document_id,
              serverUrl: room.collaboration_url,
              roomMode: 'join',
            },
          },
        ]}
        user={{ name: 'Demo user', email: 'demo@example.com' }}
        onTransaction={onActivity}
        onException={(event) => console.error('SuperDoc error', event)}
      />
    </div>
  );
}
