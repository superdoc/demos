/** Reusable outline helpers. These functions do not depend on React or the rendered DOM. */
import type {
  BorrowedSuperDocUI,
  BrowserDocumentApi,
  DocumentStoryLocator as StoryLocator,
  TextTarget,
} from 'superdoc/ui';

export type OutlineEntry = {
  id: string;
  text: string;
  quote: string;
  level: number;
  story?: StoryLocator;
  within: { kind: "block"; nodeType: "heading"; nodeId: string };
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

/** Resolve inside the native heading, so duplicate labels cannot pick another section. */
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
