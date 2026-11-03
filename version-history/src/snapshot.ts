import type { SuperDoc } from 'superdoc';

export type SnapshotEditor = Pick<SuperDoc, 'export' | 'getDocumentApi'>;

export async function captureSnapshot(source: SnapshotEditor) {
  const api = source.getDocumentApi();
  if (!api) throw new Error('Document API is unavailable');
  // Guard the later acceptance against edits arriving during export or upload.
  const { revision } = await api.info({});
  const blob = await source.export({
    exportType: ['docx'], triggerDownload: false, policies: { trackedChanges: 'review-preserving' },
  });
  if (!(blob instanceof Blob) || !blob.size) throw new Error('Empty DOCX export');
  return { blob, revision };
}

export async function acceptSnapshotChanges(source: SnapshotEditor, revision: string): Promise<'accepted' | 'changed'> {
  const api = source.getDocumentApi();
  if (!api) throw new Error('Document API is unavailable');
  try {
    // Resolve the complete catalog explicitly so permission failures cannot be
    // silently skipped by a bulk review operation.
    const ids: string[] = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await api.trackChanges.list({ in: 'all', limit: 200, offset });
      if (page.evaluatedRevision !== revision) return 'changed';
      ids.push(...page.items.map((change) => change.id));
      offset += page.items.length;
      total = page.total;
      if (page.items.length === 0 && offset < total) throw new Error('Incomplete change catalog');
    } while (offset < total);
    if (!ids.length) return 'accepted';
    const result = await api.trackChanges.decide({
      decision: 'accept', target: { kind: 'ids', ids },
    }, { expectedRevision: revision });
    if (result.success) {
      if (result.changed === false) throw new Error('Tracked changes were not accepted');
      return 'accepted';
    }
    if (isRevisionConflict(result.failure)) return 'changed';
    throw new Error(result.failure?.message || 'Tracked changes could not be accepted');
  } catch (error) {
    if (isRevisionConflict(error)) return 'changed';
    throw error;
  }
}

function isRevisionConflict(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error
    && (error.code === 'REVISION_MISMATCH' || error.code === 'STALE_REVISION');
}
