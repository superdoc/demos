import { useCallback, useEffect, useRef, useState } from 'react';
import type { SuperDoc } from 'superdoc';
import { apiPath, authHeaders, checked, type RoomSession, type User } from './session';
import { captureSnapshot } from './versioning';
import { ChangeRecorder } from './change-recorder';
import type { ChangeRecord } from './change-records';

export type Version = { id: string; number: number; createdAt: string; createdBy: User; bytes: number;
  revision?: string; cursor?: string | null; stateVector?: string; changeCount?: number };
export type OpenedVersion = Version & { file: File; records: ChangeRecord[] };
export type SaveStatus = 'loading' | 'ready' | 'pending' | 'saving' | 'saved' | 'error';

export function useVersionHistory(session: RoomSession) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [recordError, setRecordError] = useState('');
  const editor = useRef<SuperDoc | null>(null);
  const recorder = useRef<ChangeRecorder | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const currentVersion = useRef<string | null>(null);
  const files = useRef(new Map<string, OpenedVersion>());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; recorder.current?.stop(); };
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++generation.current;
    try {
      const response = await checked(await fetch(apiPath(session, 'versions'), { headers: authHeaders(session), signal, cache: 'no-store' }));
      const list: Version[] = await response.json();
      if (mounted.current && generation.current === request) {
        currentVersion.current = list[0]?.id ?? null;
        setVersions(list); setListError('');
      }
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
    const recording = recorder.current;
    if (!source || !recording) return Promise.resolve();
    setStatus('saving');
    setError('');
    const baseVersionId = currentVersion.current;
    const task = (async () => {
      const { blob, checkpoint } = await captureSnapshot(source, () => recording.flush());
      const form = new FormData();
      form.set('document', blob, 'document.docx');
      form.set('checkpoint', JSON.stringify({ ...checkpoint, baseVersionId }));
      const response = await checked(await fetch(apiPath(session, 'versions'), {
        method: 'POST', headers: { ...authHeaders(session), 'X-Version-Id': crypto.randomUUID() }, body: form,
      }));
      const version: Version = await response.json();
      if (!mounted.current || editor.current !== source) return;
      generation.current += 1;
      currentVersion.current = version.id;
      setVersions((previous) => [version, ...previous.filter((item) => item.id !== version.id)].sort((a, b) => b.number - a.number));
      setStatus('saved');
      try {
        const after = await source.getDocumentApi()?.info({});
        if (mounted.current && after?.revision !== checkpoint.revision) setStatus('pending');
      } catch { if (mounted.current) setStatus('pending'); }
      void refresh();
    })().catch((cause) => {
      if (mounted.current) {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'This version could not be saved. Your current document is still open.');
        void refresh();
      }
    }).finally(() => { if (saving.current === task) saving.current = null; });
    saving.current = task;
    return task;
  }, [session, refresh]);

  const open = useCallback(async (version: Version): Promise<OpenedVersion> => {
    const cached = files.current.get(version.id);
    if (cached) return cached;
    const fetchVersion = async (suffix: string) => checked(await fetch(apiPath(session, `versions/${version.id}/${suffix}`), {
      headers: authHeaders(session), signal: AbortSignal.timeout(20_000),
    }));
    const [fileResponse, changesResponse] = await Promise.all([fetchVersion('file'), fetchVersion('changes')]);
    const blob = await fileResponse.blob();
    const result = { ...version, file: new File([blob], 'document.docx', { type: blob.type }), records: await changesResponse.json() as ChangeRecord[] };
    files.current.set(version.id, result);
    return result;
  }, [session]);

  const onReady = useCallback((superdoc: SuperDoc) => {
    recorder.current?.stop();
    editor.current = superdoc;
    try {
      recorder.current = new ChangeRecorder(superdoc, async (records, signal) => {
        await checked(await fetch(apiPath(session, 'changes'), { method: 'POST',
          headers: { ...authHeaders(session), 'Content-Type': 'application/json' }, body: JSON.stringify(records), signal }));
      }, (message, changed) => {
        if (!mounted.current || editor.current !== superdoc) return;
        setRecordError(message);
        if (changed && !saving.current) setStatus('pending');
      });
      recorder.current.start();
      setStatus('ready');
    } catch (cause) {
      recorder.current = null;
      setRecordError(cause instanceof Error ? cause.message : 'The Changes API is unavailable.');
      setStatus('error');
    }
  }, [session]);
  const onChange = useCallback(() => { if (editor.current && !saving.current) setStatus('pending'); }, []);

  return { versions, status, error, listError, recordError, canSave: recorder.current !== null, onReady, onChange, save, open, refresh };
}
