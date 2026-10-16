import { useEffect, useState } from 'react';
import { SuperDocEditor } from '@superdoc/react';
import type { SuperDoc } from 'superdoc';
import { api } from '../api';
import type { Room } from '../types';

export function FieldCodesView({ room, superdoc, refresh }: { room: Room; superdoc?: SuperDoc; refresh: number }) {
  const [blob, setBlob] = useState<Blob>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: number | undefined;
    let active = true;
    async function load() {
      controller?.abort(); controller = new AbortController();
      try {
        const next = await api.getDocumentBlob(room.room_id, controller.signal, true);
        if (active) { setBlob(next); setVersion((current) => current + 1); setError(''); }
      } catch (caught) {
        if (active && !(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void load(), 350); };
    void load();
    superdoc?.on('editor-update', schedule);
    superdoc?.on('document-replaced', schedule);
    return () => {
      active = false; controller?.abort(); window.clearTimeout(timer);
      superdoc?.off('editor-update', schedule); superdoc?.off('document-replaced', schedule);
    };
  }, [room.room_id, room.generation, superdoc, refresh]);
  return (
    <div className="field-codes-view">
      <div className="field-codes-notice" role="status">Field codes · Option–F9 returns to the editable document</div>
      {error ? <p className="banner error">{error}</p> : !blob ? <div className="editor-state">Loading field codes…</div> : (
        <SuperDocEditor key={version} documentMode="viewing" ui={false} rulers={false}
          documents={[{ id: `${room.document_id}-field-codes`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: blob }]} />
      )}
    </div>
  );
}
