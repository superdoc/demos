import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { apiPath, authHeaders, checked, type RoomSession, type User } from './session';
import { acceptSnapshotChanges, captureSnapshot } from './snapshot';

export type Version = { id: string; number: number; createdAt: string; createdBy: User; bytes: number };
export type OpenedVersion = Version & { file: File };
export type SaveStatus = 'loading' | 'ready' | 'pending' | 'saving' | 'saved' | 'error';
type Checkpoint = { source: SuperDoc; revision: string };

export function useVersionHistory(session: RoomSession) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [checkpointWarning, setCheckpointWarning] = useState<{ message: string; retry: boolean } | null>(null);
  const pendingCheckpoint = useRef<Checkpoint | null>(null);
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

  const finishCheckpoint = useCallback(async (checkpoint: Checkpoint) => {
    if (!mounted.current || editor.current !== checkpoint.source) return;
    try {
      const result = await acceptSnapshotChanges(checkpoint.source, checkpoint.revision);
      if (!mounted.current || editor.current !== checkpoint.source) return;
      pendingCheckpoint.current = null;
      if (result === 'changed') {
        setCheckpointWarning({ message: 'Version saved. The shared document changed during saving, so resetting its edit history was skipped. Save again to capture any remaining edits.', retry: false });
        setStatus('pending');
        return;
      }
      setCheckpointWarning(null);
      // Acceptance is itself an editor update. Check for genuinely new revisions
      // after it, instead of treating our cleanup as another unsaved user edit.
      const acceptedRevision = revision.current;
      let remaining: number | null = null;
      try {
        const api = checkpoint.source.getDocumentApi();
        if (api) remaining = (await api.trackChanges.list({ in: 'all', limit: 1 })).total;
      } catch { /* A failed status read must not retry an already-completed acceptance. */ }
      if (!mounted.current || editor.current !== checkpoint.source) return;
      setStatus(remaining !== 0 || revision.current !== acceptedRevision ? 'pending' : 'saved');
    } catch {
      if (mounted.current && editor.current === checkpoint.source) {
        pendingCheckpoint.current = checkpoint;
        setCheckpointWarning({ message: 'Version saved, but resetting the live edit history could not be confirmed. Your saved snapshot is preserved.', retry: true });
        setStatus('pending');
      }
    }
  }, []);

  const save = useCallback((): Promise<void> => {
    if (saving.current) return saving.current;
    const source = editor.current;
    if (!source) return Promise.resolve();
    setStatus('saving');
    const task = (async () => {
      const { blob, revision: snapshotRevision } = await captureSnapshot(source);
      const response = await checked(await fetch(apiPath(session, 'versions'), {
        method: 'POST', headers: { ...authHeaders(session), 'Content-Type': blob.type, 'X-Version-Id': crypto.randomUUID() }, body: blob,
      }));
      const version: Version = await response.json();
      if (!mounted.current || editor.current !== source) return;
      generation.current += 1;
      files.current.set(version.id, new File([blob], 'document.docx', { type: blob.type }));
      setVersions((previous) => [version, ...previous.filter((item) => item.id !== version.id)].sort((a, b) => b.number - a.number));
      setError('');
      void refresh();
      const checkpoint = { source, revision: snapshotRevision };
      pendingCheckpoint.current = checkpoint;
      await finishCheckpoint(checkpoint);
    })().catch(() => {
      if (mounted.current) {
        setStatus('error');
        setError('This version could not be saved to the server. Your current document is still open.');
      }
    }).finally(() => { if (saving.current === task) saving.current = null; });
    saving.current = task;
    return task;
  }, [session, refresh, finishCheckpoint]);

  const retryCheckpoint = useCallback((): Promise<void> => {
    if (saving.current) return saving.current;
    const checkpoint = pendingCheckpoint.current;
    if (!checkpoint) return Promise.resolve();
    setStatus('saving');
    const task = finishCheckpoint(checkpoint).finally(() => { if (saving.current === task) saving.current = null; });
    saving.current = task;
    return task;
  }, [finishCheckpoint]);

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

  return { versions, status, error, listError, checkpointWarning, retryCheckpoint, onReady, onChange, save, open, refresh };
}
