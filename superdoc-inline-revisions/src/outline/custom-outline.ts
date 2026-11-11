/** Outline discovery stays local to the already authorized, current document. */
export type OutlineEntry = {
  id: string;
  text: string;
  quote: string;
  level: number;
  occurrence: number;
  page?: number;
  source?: "heading" | "detected";
  within?: OutlineBlock["within"];
};
export type OutlineBlock = {
  text: string;
  label?: string;
  group?: boolean;
  level?: number;
  bold?: boolean;
  inTable?: boolean;
  inList?: boolean;
  within?: {
    kind: "block";
    nodeType: "paragraph" | "heading" | "listItem";
    nodeId: string;
  };
};
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function selectDocumentOutline(blocks: OutlineBlock[]): OutlineEntry[] {
  const meaningful = blocks
    .map((block, index) => ({
      ...block,
      index,
      label: normalize(block.label || block.text),
    }))
    .filter((block) => block.label);
  const semantic = meaningful.some((block) => block.level !== undefined);
  const counts = new Map<string, number>();
  for (const block of meaningful)
    counts.set(block.label, (counts.get(block.label) || 0) + 1);
  const occurrences = new Map<string, number>();
  let firstProse = true;
  let parentLevel = 1;
  let hasOpeningTitle = false;
  let inGroup = false;
  const entries: OutlineEntry[] = [];
  for (const block of meaningful) {
    const occurrence = occurrences.get(block.label) || 0;
    occurrences.set(block.label, occurrence + 1);
    const standalone = !block.inTable && !block.inList;
    const opening = standalone && firstProse;
    if (standalone) firstProse = false;
    const allCaps = block.label === block.label.toLocaleUpperCase();
    const words = block.label.split(/\s+/).length;
    const inferred =
      block.bold &&
      block.label.length <= 95 &&
      words >= 2 &&
      words <= 12 &&
      /\p{L}/u.test(block.label) &&
      !/[.!?;:]$/.test(block.label) &&
      !/^(https?:\/\/|www\.)/i.test(block.label) &&
      (!/^\d/.test(block.label) || /^[1-9][.)]?\s+\p{Lu}/u.test(block.label)) &&
      counts.get(block.label) === 1 &&
      !block.inList &&
      (opening || !allCaps || block.group || (!semantic && standalone));
    if (block.level === undefined && !inferred) continue;
    if (opening && inferred) hasOpeningTitle = true;
    if (block.level !== undefined) {
      parentLevel = block.level;
      inGroup = false;
    }
    if (block.group) inGroup = true;
    entries.push({
      id: block.within?.nodeId || `section-${block.index}`,
      text: block.label,
      quote:
        block.label && block.label !== normalize(block.text)
          ? block.label
          : block.text.trim(),
      level: Math.max(
        1,
        Math.min(
          9,
          block.level ??
            (opening
              ? 1
              : semantic || hasOpeningTitle
                ? parentLevel + 1 + (inGroup && !block.group ? 1 : 0)
                : 1),
        ),
      ),
      source: block.level === undefined ? "detected" : "heading",
      occurrence,
      ...(block.within ? { within: block.within } : {}),
    });
  }
  return entries;
}

/** Read semantic HTML from SuperDoc, never from the paginated visual line DOM. */
export function outlineFromHtml(
  html: string,
  blocks: {
    identity: string;
    blockId?: string;
    nodeType: string;
    output: { start: number; end: number };
  }[] = [],
): OutlineEntry[] {
  // Retain the engine's public block identities. Identical heading text or a
  // reference to it in body copy must not send navigation to the wrong place.
  const inserts = blocks
    .flatMap((block, index) => {
      if (
        block.identity !== "public" ||
        !block.blockId ||
        !["paragraph", "heading", "listItem"].includes(block.nodeType)
      )
        return [];
      const tag = /^<(?:p|h[1-6])\b/.exec(
        html.slice(block.output.start, block.output.start + 8),
      );
      return tag
        ? [
            {
              at: block.output.start + tag[0].length,
              value: ` data-outline-block="${index}"`,
            },
          ]
        : [];
    })
    .sort((a, b) => a.at - b.at);
  const parts: string[] = [];
  let offset = 0;
  for (const insert of inserts) {
    parts.push(html.slice(offset, insert.at), insert.value);
    offset = insert.at;
  }
  parts.push(html.slice(offset));
  html = parts.join("");
  const document = new DOMParser().parseFromString(html, "text/html");
  const text = (node: Node): string => {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeName === "BR") return "\n";
    return Array.from(node.childNodes).map(text).join("");
  };
  return selectDocumentOutline(
    Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,p")).map(
      (element) => {
        const value = text(element);
        const emphasis = Array.from(element.querySelectorAll("strong,b"))
          .map(text)
          .join("");
        const blockIndex = element.getAttribute("data-outline-block");
        const block =
          blockIndex === null ? undefined : blocks[Number(blockIndex)];
        const inTable = !!element.closest("table");
        const prefix =
          /^([\p{Lu}\d][\p{Lu}\d /&]{2,70}?)\s{2,}(?=\p{Lu}\p{Ll})/u.exec(
            value.trim(),
          )?.[1];
        const table = element.closest("table");
        const banner =
          !!prefix &&
          table?.querySelectorAll("tr").length === 1 &&
          table.querySelectorAll("td,th").length === 1;
        const label = prefix || normalize(value);
        const bold =
          normalize(emphasis).replace(/\s/g, "") ===
            normalize(value).replace(/\s/g, "") ||
          (!!prefix && normalize(emphasis).startsWith(prefix));
        return {
          text: value,
          label,
          group:
            (!inTable || banner) && bold && label === label.toLocaleUpperCase(),
          level: /^H[1-6]$/.test(element.tagName)
            ? Number(element.tagName[1])
            : undefined,
          bold,
          inTable,
          inList: !!element.closest("li"),
          within: block?.blockId
            ? {
                kind: "block" as const,
                nodeType: block.nodeType as
                  "paragraph" | "heading" | "listItem",
                nodeId: block.blockId,
              }
            : undefined,
        };
      },
    ),
  );
}
