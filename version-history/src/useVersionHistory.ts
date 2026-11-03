import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { apiPath, authHeaders, checked, type RoomSession, type User } from './session';

export type Version = { id: string; number: number; createdAt: string; createdBy: User; bytes: number };
export type OpenedVersion = Version & { file: File };
export type SaveStatus = 'loading' | 'ready' | 'pending' | 'saving' | 'saved' | 'error';

export function useVersionHistory(session: RoomSession) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const editor = useRef<SuperDoc | null>(null);
  const revision = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const files = useRef(new Map<string, File>());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++generation.current;
    try {
      const response = await checked(await fetch(apiPath(session, 'versions'), { headers: authHeaders(session), signal, cache: 'no-store' }));
      const list: Version[] = await response.json();
      if (mounted.current && generation.current === request) { setVersions(list); setListError(''); }
    } catch {
      if (mounted.current && !signal?.aborted && generation.current === request) setListError('Shared versions could not be refreshed. Retrying every five seconds.');
    }
  }, [session]);

  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    const poll = async () => {
      if (fetching) return;
      fetching = true;
      try { await refresh(controller.signal); } finally { fetching = false; }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    return () => { clearInterval(interval); controller.abort(); };
  }, [refresh]);

  const save = useCallback((): Promise<void> => {
    if (saving.current) return saving.current;
    const source = editor.current;
    if (!source) return Promise.resolve();
    const targetRevision = revision.current;
    setStatus('saving');
    const task = (async () => {
      const blob = await source.export({ exportType: ['docx'], triggerDownload: false, policies: { trackedChanges: 'review-preserving' } });
      if (!(blob instanceof Blob) || !blob.size) throw new Error('Empty DOCX export');
      const response = await checked(await fetch(apiPath(session, 'versions'), {
        method: 'POST', headers: { ...authHeaders(session), 'Content-Type': blob.type, 'X-Version-Id': crypto.randomUUID() }, body: blob,
      }));
      const version: Version = await response.json();
      if (!mounted.current || editor.current !== source) return;
      generation.current += 1;
      files.current.set(version.id, new File([blob], 'document.docx', { type: blob.type }));
      setVersions((previous) => [version, ...previous.filter((item) => item.id !== version.id)].sort((a, b) => b.number - a.number));
      setError('');
      setStatus(revision.current === targetRevision ? 'saved' : 'pending');
      void refresh();
    })().catch(() => {
      if (mounted.current) {
        setStatus('error');
        setError('This version could not be saved to the server. Your current document is still open.');
      }
    }).finally(() => { if (saving.current === task) saving.current = null; });
    saving.current = task;
    return task;
  }, [session, refresh]);

  const open = useCallback(async (version: Version): Promise<OpenedVersion> => {
    let file = files.current.get(version.id);
    if (!file) {
      const response = await checked(await fetch(apiPath(session, `versions/${version.id}/file`), {
        headers: authHeaders(session), signal: AbortSignal.timeout(20_000),
      }));
      const blob = await response.blob();
      file = new File([blob], 'document.docx', { type: blob.type });
      files.current.set(version.id, file);
    }
    return { ...version, file };
  }, [session]);

  const onReady = useCallback((superdoc: SuperDoc) => { editor.current = superdoc; setStatus('ready'); }, []);
  const onChange = useCallback(() => {
    if (!editor.current) return;
    revision.current += 1;
    if (!saving.current) setStatus('pending');
  }, []);

  return { versions, status, error, listError, onReady, onChange, save, open, refresh };
}
