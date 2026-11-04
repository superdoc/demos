import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SuperDocEditor, type SuperDocEditorProps } from '@superdoc/react';
import type { SuperDoc } from 'superdoc';
import { api } from '../api';
import type { Room } from '../types';
import type { DocumentMode } from './Topbar';

type DocumentEditorProps = {
  room: Room;
  mode: DocumentMode;
  onActivity: () => void;
  onConnectedUsersChange: (count: number | null) => void;
  onReady: (superdoc: SuperDoc | undefined) => void;
};

const editorModules: SuperDocEditorProps['modules'] = {
  trackChanges: {
    enabled: true,
    mode: 'review',
    visible: true,
  },
};
const baseEditorUi: SuperDocEditorProps['ui'] = {
  toolbar: { container: '#superdoc-toolbar', excludeItems: ['ruler'], responsiveTo: 'container', overflow: 'menu' },
  loading: false,
};
export const DocumentEditor = memo(function DocumentEditor({ room, mode, onActivity, onConnectedUsersChange, onReady }: DocumentEditorProps) {
  const instance = useRef<SuperDoc | undefined>(undefined);
  const editorUi = useMemo<SuperDocEditorProps['ui']>(() => ({
    ...baseEditorUi,
    contextMenu: { sections: [{ id: 'metadata', items: [{
      id: 'demo.addMetadata', label: 'Add metadata',
      showWhen: (context) => context.hasSelection && context.isEditable,
      onSelect: () => { instance.current?.ui.commands.get('demo.addMetadata').execute(); },
    }, {
      id: 'demo.editMetadata', label: 'Edit metadata',
      showWhen: (context) => context.isEditable && !!instance.current
        && !instance.current.ui.commands.get('demo.editMetadata').getState().disabled,
      onSelect: () => { instance.current?.ui.commands.get('demo.editMetadata').execute(); },
    }, {
      id: 'demo.removeMetadata', label: 'Remove metadata',
      showWhen: (context) => context.isEditable && !!instance.current
        && !instance.current.ui.commands.get('demo.removeMetadata').getState().disabled,
      onSelect: () => { instance.current?.ui.commands.get('demo.removeMetadata').execute(); },
    }] }] },
  }), []);
  const editorUser = useMemo(() => {
    const sessionId = crypto.randomUUID();
    return { name: `Demo user ${sessionId.slice(0, 8)}`, email: `${sessionId}@demo.example` };
  }, []);
  const presenceCount = useRef(0);
  const synced = useRef(false);
  const handleAwarenessUpdate = useCallback<NonNullable<SuperDocEditorProps['onAwarenessUpdate']>>(({ states }) => {
    presenceCount.current = states.filter((state) => state.email !== 'document-service@demo.local').length;
    if (synced.current) onConnectedUsersChange(presenceCount.current);
  }, [onConnectedUsersChange]);
  const handleConnectionChange = useCallback<NonNullable<SuperDocEditorProps['onCollaborationConnectionChange']>>(({ state }) => {
    synced.current = state === 'synced';
    onConnectedUsersChange(synced.current ? presenceCount.current : null);
  }, [onConnectedUsersChange]);

  useEffect(() => {
    onConnectedUsersChange(null);
    return () => {
      onReady(undefined);
      onConnectedUsersChange(null);
    };
  }, [room.document_id, onConnectedUsersChange, onReady]);
  const [documentBlob, setDocumentBlob] = useState<Blob>();
  const [loadError, setLoadError] = useState<string>();
  const [editorReady, setEditorReady] = useState(false);
  const mountedEditor = useRef(false);
  const documents = useMemo<SuperDocEditorProps['documents']>(() => documentBlob ? [
    {
      id: room.document_id,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: documentBlob,
      v2Collaboration: {
        providerType: 'hocuspocus',
        documentId: room.document_id,
        serverUrl: room.collaboration_url,
        token: () => api.getCollaborationToken(room.room_id, editorUser.email),
        roomMode: 'join',
      },
    },
  ] : [], [documentBlob, editorUser.email, room.collaboration_url, room.document_id, room.room_id]);

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

  if (loadError) return <div className="editor-state" role="alert">Error loading editor</div>;

  return (
    <div className="editor-shell" aria-busy={!editorReady} onPointerDown={onActivity} onKeyDown={onActivity}>
      {!editorReady && (
        <div className="editor-loading-overlay" role="status" aria-label="Loading editor">
          <span className="spinner" aria-hidden="true" />
        </div>
      )}
      {documentBlob && <div className="editor-content" inert={!editorReady} aria-hidden={!editorReady}>
      <SuperDocEditor
        key={room.document_id}
        documentMode={mode}
        modules={editorModules}
        rulers={false}
        ui={editorUi}
        documents={documents}
        user={editorUser}
        onTransaction={onActivity}
        onAwarenessUpdate={handleAwarenessUpdate}
        onCollaborationConnectionChange={handleConnectionChange}
        onReady={({ superdoc }) => {
          instance.current = superdoc;
          mountedEditor.current = true;
          setEditorReady(true);
          onReady(superdoc);
        }}
        onException={(event) => {
          console.error('SuperDoc error', event);
          if (!mountedEditor.current || ('code' in event && event.code === 'worker-init-failed')) {
            setLoadError('Error loading editor');
            onReady(undefined);
            onConnectedUsersChange(null);
          }
        }}
      />
      </div>}
    </div>
  );
});
