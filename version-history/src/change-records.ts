import type { SuperDoc } from 'superdoc';
import type { SelectionTarget } from 'superdoc/ui';

export type Story = NonNullable<SelectionTarget['story']>;
export type Actor = { id: string | null; name?: string; email?: string; claim?: string };
export type BlockChange =
  | { kind: 'text'; story: Story; blockId: string; range: { start: number; end: number }; inserted: string; deleted: string }
  | { kind: 'format'; story: Story; blockId: string; range: { start: number; end: number }; attributes: Record<string, unknown> }
  | { kind: 'paragraph'; story: Story; blockId: string; properties: Record<string, unknown> }
  | { kind: 'split'; story: Story; blockId: string; tailBlockId: string; offset: number }
  | { kind: 'merge'; story: Story; blockId: string; mergedBlockId: string }
  | { kind: 'move'; story: Story; blockId: string; afterBlockId: string | null }
  | { kind: 'create' | 'remove'; story: Story; blockId: string; text: string }
  | { kind: 'table'; story: Story; tableId: string; detail: Record<string, unknown> }
  | { kind: 'sidecar'; affects: 'comment' | 'trackedChange' | 'bookmark'; ids: string[] };

// Structural public Changes API contracts let the demo fail clearly on older
// packages while the merged API is being released. No tracked-change fallback.
export type ChangeRecord = {
  id: string; seq: number; revision: string; origin: 'local' | 'remote';
  actor: Actor | null; contributors?: Actor[]; actorType: 'human' | 'code' | null;
  cause: 'user' | 'api' | 'undo' | 'redo' | null;
  provenance: 'authored' | 'declared' | 'relayed' | 'unknown';
  at: { declared: string | null; observed: string }; session: { id: string | null; clientId: number };
  changeTag?: string; changes: BlockChange[]; update?: string;
};
export type ChangeCheckpoint = {
  revision: string; cursor: string | null; lastChangeId: string | null;
  stateVector: string; state?: string; at: string;
};
export type ChangesApi = {
  list(input?: { after?: string; limit?: number; includeUpdate?: boolean; waitMs?: number }): Promise<{
    items: ChangeRecord[]; cursor: string | null; truncated: boolean; identity: 'configured' | 'missing'; collaboration: boolean;
  }>;
  snapshot(input?: { includeState?: boolean }): Promise<ChangeCheckpoint>;
};
export type SnapshotEditor = Pick<SuperDoc, 'getDocumentApi' | 'export'>;

export function getChangesApi(source: SnapshotEditor): ChangesApi {
  const api = source.getDocumentApi() as (ReturnType<SuperDoc['getDocumentApi']> & { changes?: ChangesApi });
  if (!api?.changes?.list || !api.changes.snapshot) {
    throw new Error('This SuperDoc build does not include the Changes API. Use a build containing Orbit PR #5351.');
  }
  return api.changes;
}
