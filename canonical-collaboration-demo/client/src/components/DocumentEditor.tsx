import { memo, useEffect, useMemo, useState } from 'react';
import { SuperDocEditor, type SuperDocEditorProps } from '@superdoc/react';
import { api } from '../api';
import type { Room } from '../types';
import type { DocumentMode } from './Topbar';

type DocumentEditorProps = {
  room: Room;
  mode: DocumentMode;
  onActivity: () => void;
};

const editorModules: SuperDocEditorProps['modules'] = {
  trackChanges: {
    enabled: true,
    mode: 'review',
    visible: true,
  },
};
const editorUi: SuperDocEditorProps['ui'] = {
  toolbar: { container: '#superdoc-toolbar' },
  loading: false,
};
const editorUser = { name: 'Demo user', email: 'demo@example.com' };

export const DocumentEditor = memo(function DocumentEditor({ room, mode, onActivity }: DocumentEditorProps) {
  const [documentBlob, setDocumentBlob] = useState<Blob>();
  const [loadError, setLoadError] = useState<string>();
  const documents = useMemo<SuperDocEditorProps['documents']>(() => documentBlob ? [
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
  ] : [], [documentBlob, room.collaboration_url, room.document_id]);

  useEffect(() => {
    const controller = new AbortController();
    setDocumentBlob(undefined);
    setLoadError(undefined);
    api.getDocumentBlob(room.room_id, controller.signal)
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
        modules={editorModules}
        rulers
        ui={editorUi}
        documents={documents}
        user={editorUser}
        onTransaction={onActivity}
        onException={(event) => console.error('SuperDoc error', event)}
      />
    </div>
  );
});
