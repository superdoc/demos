/** Reusable outline helpers. These functions do not depend on React or the rendered DOM. */
import type {
  BorrowedSuperDocUI,
  BrowserDocumentApi,
  DocumentStoryLocator as StoryLocator,
  TextTarget,
} from 'superdoc/ui';
import { outlineFromHtml } from './custom-outline';

export type OutlineMode = 'headings' | 'custom';

export type OutlineEntry = {
  id: string;
  text: string;
  quote: string;
  level: number;
  story?: StoryLocator;
  source?: "heading" | "detected";
  within: { kind: "block"; nodeType: "heading" | "paragraph" | "listItem"; nodeId: string };
};

/** List native Word headings in document order through the public Document API. */
export async function readOutline(doc: BrowserDocumentApi): Promise<OutlineEntry[]> {
  const info = await doc.info({});
  return info.outline.map((item: {
    nodeId: string;
    text: string;
    level: number;
    story?: StoryLocator;
  }) => ({
    id: `${JSON.stringify(item.story?.storyType === "body" ? null : item.story ?? null)}:${item.nodeId}`,
    text: item.text || "Untitled heading",
    quote: item.text,
    level: item.level,
    story: item.story,
    within: { kind: "block", nodeType: "heading", nodeId: item.nodeId },
  }));
}

/** Read native headings and title-like text using SuperDoc's public HTML projection. */
export async function readCustomOutline(doc: BrowserDocumentApi): Promise<OutlineEntry[]> {
  const native = await readOutline(doc);
  const projection = await doc.projectHtml({ reviewMode: 'final' });
  if (projection.status === 'failed') throw new Error('Section titles could not be read.');
  const nativeById = new Map(native
    .filter((item) => !item.story || item.story.storyType === 'body')
    .map((item) => [item.within.nodeId, item]));
  const entries = outlineFromHtml(projection.content, projection.blocks).flatMap((item): OutlineEntry[] => {
    const heading = item.source === 'heading' && item.within ? nativeById.get(item.within.nodeId) : undefined;
    if (heading) return [heading];
    // Only expose entries that can be addressed through the public navigation API.
    if (!item.within) return [];
    return [{
      id: `null:${item.within.nodeId}`,
      text: item.text,
      quote: item.quote,
      level: item.level,
      source: item.source,
      within: item.within,
    }];
  });
  const included = new Set(entries.map((item) => item.id));
  return [...entries, ...native.filter((item) => !included.has(item.id))];
}

export type OutlineLabel = {
  id: string;
  text: string;
  level: number;
};
export type OutlineNode<T extends OutlineLabel> = {
  item: T;
  children: OutlineNode<T>[];
};
/** Nest entries beneath their preceding parent heading, using heading levels. */
export function outlineTree<T extends OutlineLabel>(
  items: T[],
): OutlineNode<T>[] {
  const roots: OutlineNode<T>[] = [],
    stack: OutlineNode<T>[] = [];
  for (const item of items) {
    while (stack.length && stack[stack.length - 1].item.level >= item.level)
      stack.pop();
    const node = { item, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

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
