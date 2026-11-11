/** Optional editor navigation, separate from generation and rendering. */
import type { BorrowedSuperDocUI, BrowserDocumentApi, TextTarget } from 'superdoc/ui';
import type { OutlineEntry } from './generate-outline';

/** Resolve inside the entry’s native block, so duplicate labels cannot pick another section. */
export async function revealOutlineEntry(
  doc: BrowserDocumentApi,
  ui: BorrowedSuperDocUI,
  item: OutlineEntry,
  current: () => boolean,
): Promise<boolean> {
  if (!doc || !item.within || !item.quote) return false;
  const matches = await doc.query.match({
    select: { type: "text", pattern: item.quote, caseSensitive: true },
    within: item.within,
    ...(item.story ? { in: item.story } : {}),
  });
  if (!current()) return false;
  const match = matches.items[0];
  if (!match || match.matchKind !== "text") return false;
  const [first, ...rest] = match.blocks;
  const target: TextTarget = {
    kind: "text",
    segments: [
      { blockId: first.blockId, range: first.range },
      ...rest.map((block) => ({ blockId: block.blockId, range: block.range })),
    ],
    ...(match.target.story ? { story: match.target.story } : {}),
  };
  // Each public call performs one bounded reveal step. Eight covers the supplied
  // multi-page fixtures. Measure this budget for your application's longest files.
  for (let step = 0; step < 8 && current(); step++) {
    const result = await ui.viewport.scrollIntoView({
      target,
      block: "center",
      behavior: "instant",
    });
    if (result.success) return current();
  }
  return false;
}
