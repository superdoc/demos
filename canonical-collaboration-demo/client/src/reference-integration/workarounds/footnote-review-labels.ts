// SuperDoc 2.18 presents structural footnote insertions with its table caption.
// This changes only the local review caption, preserving native decision IDs.
export function applyFootnoteReviewLabel(comment: Record<string, unknown> | null) {
  if (!comment || comment.trackedChange !== true
    || comment.trackedChangeDisplayType !== 'tableInsert'
    || comment.trackedChangeText !== 'footnote insertion') return false;
  if (comment.trackedChangeLabel === 'Added footnote') return false;
  comment.trackedChangeLabel = 'Added footnote';
  return true;
}
