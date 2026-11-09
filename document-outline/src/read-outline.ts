import type { SuperDoc } from "superdoc";
import type { DocumentStoryLocator as StoryLocator } from "superdoc/ui";

export type Entry = {
  id: string;
  text: string;
  quote: string;
  level: number;
  story?: StoryLocator;
  within: { kind: "block"; nodeType: "heading"; nodeId: string };
};

export async function readOutline(superdoc: SuperDoc): Promise<Entry[]> {
  const doc = superdoc.activeEditor?.doc;
  if (!doc) throw new Error("The document is not ready.");
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
