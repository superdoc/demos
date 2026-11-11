import type { SuperDoc } from "superdoc";
import type { DocumentStoryLocator as StoryLocator } from "superdoc/ui";
import { outlineFromHtml, type OutlineEntry } from "./document-outline";
export type Entry = OutlineEntry & { story?: StoryLocator };
export async function readOutline(
  superdoc: SuperDoc,
  detectTitles: boolean,
): Promise<Entry[]> {
  const doc = superdoc.activeEditor?.doc;
  if (!doc) throw new Error("The document is not ready.");
  const info = await doc.info({});
  const nativeEntry = (item: {
    nodeId: string;
    text: string;
    level: number;
    story?: StoryLocator;
  }): Entry => ({
    id: `${JSON.stringify(item.story ?? null)}:${item.nodeId}`,
    text: item.text || "Untitled heading",
    quote: item.text,
    level: item.level,
    occurrence: 0,
    source: "heading",
    story: item.story,
    within: { kind: "block", nodeType: "heading", nodeId: item.nodeId },
  });
  const native = info.outline
    .filter((item) => item.text.trim())
    .map(nativeEntry);
  if (!detectTitles) return native;
  const projection = await doc.projectHtml({ reviewMode: "final" });
  if (projection.status === "failed")
    throw new Error("Section titles could not be read from this document.");
  const byId = new Map(
    native
      .filter((item) => !item.story || item.story.storyType === "body")
      .map((item) => [item.within?.nodeId, item]),
  );
  const sections = outlineFromHtml(projection.content, projection.blocks).map(
    (item) =>
      item.source === "heading"
        ? (byId.get(item.within?.nodeId) ?? item)
        : item,
  );
  const included = new Set(sections.map((item) => item.id));
  return [...sections, ...native.filter((item) => !included.has(item.id))];
}
