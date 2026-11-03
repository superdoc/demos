import type { TrackChangeInfo } from 'superdoc/ui';

export type ChangeOrder = 'newest' | 'oldest' | 'author';
export type Change = TrackChangeInfo;

export const changeKey = (change: Change) => `${change.id}:${JSON.stringify(change.address.story ?? null)}`;
export const changeAuthor = (change: Change) => change.author?.trim() || 'Unknown author';
export const changeTime = (change: Change) => {
  const time = change.date ? Date.parse(change.date) : NaN;
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
    if (order === 'author') {
      const author = collator.compare(changeAuthor(a), changeAuthor(b));
      if (author) return author;
    }
    const first = changeTime(a);
    const second = changeTime(b);
    if (first === null && second !== null) return 1;
    if (first !== null && second === null) return -1;
    const date = first !== null && second !== null ? (first - second) * (order === 'oldest' ? 1 : -1) : 0;
    return date || collator.compare(changeKey(a), changeKey(b));
  });
}

export function changeLabel(change: Change): string {
  if (change.type === 'insertion' || change.type === 'insert') return 'Inserted';
  if (change.type === 'deletion' || change.type === 'delete') return 'Deleted';
  if (change.type === 'replacement') return 'Replaced';
  if (change.type === 'formatting' || change.type === 'format') return 'Formatted';
  if (change.type === 'move') return 'Moved';
  return 'Changed';
}

export function changeText(change: Change): string {
  if (change.insertedText && change.deletedText) return `“${change.deletedText}” → “${change.insertedText}”`;
  return change.insertedText || change.deletedText || change.formattingDeltaSummary || change.excerpt || 'Document structure';
}
