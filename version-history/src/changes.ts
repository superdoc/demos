import type { TextAddress } from 'superdoc/ui';
import type { BlockChange, ChangeRecord, Story } from './change-records';

export type ChangeOrder = 'newest' | 'oldest' | 'author';
export type Location = { blockId: string; story: Story; range: { start: number; end: number } | null };
export type Change = { id: string; record: ChangeRecord; change: BlockChange; locations: Location[]; targets: TextAddress[]; contextOnly: boolean;
  members?: Change[]; summary?: string };
export const changeKey = (change: Change) => change.id;
export const changeAuthor = (change: Change) => [...new Set([change.record.actor, ...(change.record.contributors ?? [])]
  .filter((actor) => actor !== null).map((actor) => actor.name?.trim() || actor.id).filter(Boolean))].join(', ') || 'Unknown author';
export const changeTime = (change: Change) => {
  const time = Date.parse(change.record.at.declared || change.record.at.observed);
  return Number.isFinite(time) ? time : null;
};
export const changeDate = (change: Change) => {
  const time = changeTime(change);
  return time === null ? 'Time unavailable' : new Date(time).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
};

export function orderChanges(changes: readonly Change[], order: ChangeOrder): Change[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return [...changes].sort((a, b) => {
    if (order === 'author') { const author = collator.compare(changeAuthor(a), changeAuthor(b)); if (author) return author; }
    const first = changeTime(a); const second = changeTime(b);
    if (first === null && second !== null) return 1;
    if (first !== null && second === null) return -1;
    const date = first !== null && second !== null ? (first - second) * (order === 'oldest' ? 1 : -1) : 0;
    return date || collator.compare(a.id, b.id);
  });
}

export function changeLabel(entry: Change): string {
  if (entry.members && new Set(entry.members.map((member) => changeLabel(member))).size > 1) return 'Edited paragraph';
  const { change } = entry;
  if (change.kind === 'text') return change.inserted && change.deleted ? 'Replaced' : change.inserted ? 'Inserted' : 'Deleted';
  return { format: 'Formatted', paragraph: 'Paragraph', split: 'Split paragraph', merge: 'Merged paragraphs',
    move: 'Moved', create: 'Created', remove: 'Removed', table: 'Table', sidecar: 'Review edit' }[change.kind];
}

export function changeText({ change, summary }: Change): string {
  if (summary !== undefined) return summary;
  if (change.kind === 'text') return change.inserted && change.deleted ? `“${change.deleted}” → “${change.inserted}”` : change.inserted || change.deleted;
  if (change.kind === 'create' || change.kind === 'remove') return change.text || 'Document structure';
  if (change.kind === 'format') return Object.entries(change.attributes).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ');
  if (change.kind === 'paragraph') return Object.keys(change.properties).join(', ') || 'Paragraph properties';
  if (change.kind === 'sidecar') return `${change.affects}: ${change.ids.join(', ')}`;
  return 'Document structure';
}

const sameStory = (a: Story, b: Story) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
export const locationKey = (location: { blockId: string; story?: Story }) => JSON.stringify([location.blockId, Object.entries(location.story ?? {}).sort()]);

const mapOffset = (offset: number, start: number, deleted: number, inserted: number, right: boolean) =>
  offset < start ? offset : offset > start + deleted ? offset + inserted - deleted : start + (right ? inserted : 0);

export function mapLocation(location: Location, edit: BlockChange): Location[] {
  if (edit.kind === 'sidecar' || edit.kind === 'table' || !sameStory(location.story, edit.story)) return [location];
  if (edit.kind === 'merge' && edit.mergedBlockId === location.blockId) return [{ ...location, blockId: edit.blockId, range: null }];
  if (edit.blockId !== location.blockId) return [location];
  if (edit.kind === 'remove') return [];
  if (edit.kind === 'merge') return [{ ...location, range: null }];
  if (edit.kind === 'split') {
    if (!location.range) return [location, { ...location, blockId: edit.tailBlockId }];
    const { start, end } = location.range;
    if (start >= edit.offset) return [{ ...location, blockId: edit.tailBlockId, range: { start: start - edit.offset, end: end - edit.offset } }];
    if (end <= edit.offset) return [location];
    return [{ ...location, range: { start, end: edit.offset } }, { ...location, blockId: edit.tailBlockId, range: { start: 0, end: end - edit.offset } }];
  }
  if (edit.kind === 'text' && location.range) {
    const { start, end } = location.range;
    if (end > start && edit.deleted.length && edit.range.start <= start && edit.range.start + edit.deleted.length >= end) return [];
    const mappedStart = mapOffset(start, edit.range.start, edit.deleted.length, edit.inserted.length, true);
    if (start === end) return [{ ...location, range: { start: mappedStart, end: mappedStart } }];
    const mappedEnd = mapOffset(end, edit.range.start, edit.deleted.length, edit.inserted.length, false);
    return [{ ...location, range: { start: Math.min(mappedStart, mappedEnd), end: Math.max(mappedStart, mappedEnd) } }];
  }
  return [location];
}

export function recordChanges(records: readonly ChangeRecord[]): Change[] {
  return records.flatMap((record, index) => record.changes.map((change, offset) => {
    let locations: Location[] = 'blockId' in change ? [{ blockId: change.blockId,
      story: change.story, range: 'range' in change ? { ...change.range } : change.kind === 'create' ? { start: 0, end: change.text.length } : null }] : [];
    for (const later of records.slice(index + 1)) for (const edit of later.changes) locations = locations.flatMap((location) => mapLocation(location, edit));
    return { id: `${record.id}:${offset}`, record, change, locations, targets: [], contextOnly: false };
  }));
}

export function nodeText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as Record<string, unknown>;
  if (node.kind === 'run') return String((node.run as { text?: string })?.text ?? '');
  if (node.kind === 'tab') return '\t';
  if (node.kind === 'lineBreak') return '\n';
  const body = typeof node.kind === 'string' && node[node.kind] && typeof node[node.kind] === 'object' ? node[node.kind] as Record<string, unknown> : node;
  for (const key of ['inlines', 'content', 'children']) if (Array.isArray(body[key])) return (body[key] as unknown[]).map(nodeText).join('');
  return '';
}
