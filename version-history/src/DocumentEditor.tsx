import { useEffect, useRef, useState } from 'react';
import { SuperDoc } from 'superdoc';
import { apiPath, authHeaders, checked, collaborationUrl, type RoomSession } from './session';

type Props = {
  document: string | File;
  readOnly?: boolean;
  toolbarContainer: string;
  onReady?: (superdoc: SuperDoc) => void;
  onChange?: () => void;
  session?: RoomSession;
  onConnection?: (connected: boolean) => void;
};

// Both the live document and historical DOCX files use the same editor component.
export function DocumentEditor({ document, readOnly = false, toolbarContainer, onReady, onChange, session, onConnection }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onChange, onConnection });
  callbacks.current = { onReady, onChange, onConnection };
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!mount.current) return;
    let alive = true;
    let ready = false;
    let synchronized = !session;
    let host: SuperDoc | null = null;
    let reported = false;
    const reportReady = async () => {
      if (!alive || !host || !synchronized || reported) return;
      reported = true;
      try {
        if (session?.mode === 'create') await checked(await fetch(apiPath(session, 'ready'), {
          method: 'POST', headers: authHeaders(session),
        }));
        if (!alive) return;
        ready = true;
        setState('ready');
        callbacks.current.onConnection?.(true);
        callbacks.current.onReady?.(host);
      } catch (error) {
        if (alive) { console.error(error); setState('error'); }
      }
    };
    setState('loading');
    const superdoc = new SuperDoc({
      selector: mount.current,
      document: session && typeof document === 'string' ? {
        url: document,
        collaboration: {
          providerType: 'hocuspocus', documentId: session.documentId,
          serverUrl: collaborationUrl(), token: session.token,
          roomMode: session.mode, syncTimeoutMs: 45_000,
        },
      } : document,
      // The application calls this Editing; every native edit is still recorded.
      documentMode: readOnly ? 'viewing' : 'suggesting',
      viewing: { trackedChanges: 'markup' },
      trackChanges: { enabled: readOnly },
      interaction: { trackedChanges: { allowDecisions: false } },
      // The editor role permits the post-save API acceptance; UI decisions stay disabled.
      role: readOnly ? 'viewer' : 'editor',
      allowSelectionInViewMode: true,
      user: session?.user ?? { name: 'You', email: 'you@example.com' },
      ui: {
        toolbar: {
          container: toolbarContainer,
          excludeItems: ['document-mode', 'ruler', 'track-changes-accept-selection', 'track-changes-reject-selection'],
          responsiveTo: 'container',
          overflow: 'menu',
        },
        comments: false, contextMenu: false, search: true, ruler: false, loading: false,
      },
      onReady: ({ superdoc: loaded }) => {
        host = loaded;
        void reportReady();
      },
      onCollaborationReady: () => { synchronized = true; void reportReady(); },
      onCollaborationConnectionChange: ({ state }) => {
        if (alive && ready) callbacks.current.onConnection?.(state === 'synced');
      },
      onEditorUpdate: () => {
        if (alive && ready && !readOnly) callbacks.current.onChange?.();
      },
      onException: (exception) => {
        if (!alive || ready) return;
        console.error(exception);
        setState('error');
      },
    });
    return () => {
      alive = false;
      superdoc.destroy();
    };
  }, [document, readOnly, toolbarContainer, session]);

  return <>
    {state === 'loading' && <div className="editor-message" role="status">Opening document…</div>}
    {state === 'error' && <div className="editor-message error" role="alert">This document could not be opened. Try selecting the version again.</div>}
    <div ref={mount} className="editor-mount" aria-label={readOnly ? 'Historical document' : 'Editable document'} aria-busy={state === 'loading'} />
  </>;
}
