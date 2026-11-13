/** Outline generation only: public API reads, custom detection, and hierarchy. */
import type { BrowserDocumentApi, DocumentStoryLocator as StoryLocator } from 'superdoc/ui';
import { outlineFromHtml } from './custom-outline';
import type { OutlineLabel, OutlineMode, OutlineSkeleton } from './types';

export type OutlineEntry = {
  id: string;
  text: string;
  quote: string;
  level: number;
  story?: StoryLocator;
  source?: "heading" | "detected";
  within: { kind: "block"; nodeType: "heading" | "paragraph" | "listItem"; nodeId: string };
};

export type GeneratedOutline = {
  entries: OutlineEntry[];
  skeleton: OutlineSkeleton;
};

/** Generate renderable outline data; this module does not render or navigate. */
export async function generateOutline(doc: BrowserDocumentApi, mode: OutlineMode = 'headings'): Promise<GeneratedOutline> {
  const entries = await (mode === 'custom' ? readCustomOutline(doc) : readOutline(doc));
  return { entries, skeleton: buildOutlineSkeleton(entries) };
}

/** Build plain parent/child nodes without leaking editor addresses into the UI. */
export function buildOutlineSkeleton(entries: readonly OutlineLabel[]): OutlineSkeleton {
  type Node = { id: string; text: string; children: Node[] };
  const roots: Node[] = [];
  const stack: { level: number; node: Node }[] = [];
  for (const entry of entries) {
    while (stack.length && stack[stack.length - 1].level >= entry.level) stack.pop();
    const node: Node = { id: entry.id, text: entry.text, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) parent.node.children.push(node);
    else roots.push(node);
    stack.push({ level: entry.level, node });
  }
  return roots;
}

/** List native Word headings in document order through the public Document API. */
export async function readOutline(doc: BrowserDocumentApi): Promise<OutlineEntry[]> {
  const info = await doc.info({});
  return info.outline.filter((item) => item.text.trim()).map((item: {
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

