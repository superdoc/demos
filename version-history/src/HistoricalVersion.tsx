import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { SuperDoc } from 'superdoc';
import { SuperDocUIProvider, useSetSuperDoc, useSuperDocDocumentApi, useSuperDocUI } from 'superdoc/ui/react';
import { SnapshotView, Changelog, ChangeHighlights, resolveSnapshotChanges } from './versioning';
import { DocumentEditor } from './DocumentEditor';
import type { Change } from './versioning';
import type { OpenedVersion } from './useVersionHistory';
import type { RoomSession } from './session';

type Props = { version: OpenedVersion; session: RoomSession; panel: HTMLElement | null; stage: RefObject<HTMLElement | null> };

export function HistoricalVersion(props: Props) {
  return <SuperDocUIProvider><Preview {...props} /></SuperDocUIProvider>;
}

function Preview({ version, session, panel, stage }: Props) {
  const setSuperDoc = useSetSuperDoc();
  const api = useSuperDocDocumentApi();
  const ui = useSuperDocUI();
  const [changes, setChanges] = useState<Change[]>([]);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const snapshotSession = useMemo(() => version.stateVector ? {
    ...session, snapshotId: version.id, mode: 'join' as const,
  } : undefined, [session, version.id, version.stateVector]);
  const onReady = useCallback((superdoc: SuperDoc) => {
    setSuperDoc(superdoc);
    stage.current?.scrollTo(0, 0);
  }, [setSuperDoc, stage]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    setReady(false);
    void (async () => {
      const grouped = await resolveSnapshotChanges(api, version.records);
      if (alive) { setChanges(grouped); setReady(true); }
    })();
    return () => { alive = false; };
  }, [api, version.records]);

  const select = async (change: Change) => {
    if (!ui || !change.targets[0]) throw new Error('Location unavailable');
    const result = await ui.viewport.scrollIntoView({ target: change.targets[0], block: 'center', behavior: 'instant' });
    if (!result.success) throw new Error('Location unavailable');
    setActive(change.id);
  };

  return <>
    <SnapshotView editor={DocumentEditor} document={version.file} session={snapshotSession} toolbarContainer="#version-document-toolbar" onReady={onReady} />
    {panel && createPortal(<>
      {!version.stateVector && <p className="changes-message">This older DOCX version has no Changes API checkpoint.</p>}
      <Changelog changes={changes} ready={ready} active={active} onSelect={select} />
    </>, panel)}
    <ChangeHighlights changes={changes} active={active} stage={stage} />
  </>;
}
