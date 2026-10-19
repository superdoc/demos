import { citationTool } from '../tools/citation-tool.js';
import { footnoteTool } from '../tools/footnote-tool.js';
import { referenceTool } from '../tools/reference-tool.js';
import { bibliographyTool } from '../tools/bibliography-tool.js';

const quote = (value) => typeof value === 'string' && value ? JSON.stringify(value) : '(unspecified)';
function location(anchor) {
  if (anchor?.kind === 'sectionEnd') return ` at the end of ${quote(anchor.sectionHeading)}`;
  if (anchor?.kind === 'afterText') return ` after ${quote(anchor.text)}`;
  if (anchor?.kind === 'paragraphEnd') return ` at the end of paragraph ${quote(anchor.blockId)}`;
  return '';
}

// Reference-aware receipt descriptions live beside the demo tools. The generic
// agent policy consumes these descriptions without knowing citation semantics.
export function createReferenceProgress(catalog) {
  const titles = new Map(catalog.items.map((source) => [source.sourceId, source.fields.title]));
  return ({ tool, args, result }) => {
    for (const source of result?.references ?? []) titles.set(source.sourceId, source.fields?.title);
    if (result?.source) titles.set(result.source.sourceId, result.source.fields?.title);
    if (tool === referenceTool.function.name) {
      const title = result?.source?.fields?.title ?? args.fields?.title ?? titles.get(args.sourceId) ?? args.sourceId;
      const verbs = { create: 'Saved', update: 'Updated', delete: 'Deleted' };
      return { operation: `${args.action} reference ${quote(title)}`,
        completed: verbs[args.action] ? `${verbs[args.action]} reference ${quote(title)}.` : undefined };
    }
    if (tool === citationTool.function.name) {
      const source = quote(titles.get(args.sourceId) ?? args.sourceId);
      const verified = result?.resolvedAnchor?.verified;
      return { operation: `Insert citation for ${source}${location(args.anchor)}`,
        completed: `Inserted citation for ${source}${verified ? location(result.resolvedAnchor) + ' (placement verified)' : ''}.` };
    }
    if (tool === footnoteTool.function.name) {
      const verified = result?.resolvedAnchor?.verified;
      return { operation: `Insert footnote${location(args.anchor)}`,
        completed: `Inserted footnote${verified ? location(result.resolvedAnchor) + ' (placement verified)' : ''}.` };
    }
    if (tool === bibliographyTool.function.name) {
      const verbs = { create: 'Created', update: 'Updated', delete: 'Deleted' };
      return { operation: `${args.action} bibliography`, completed: args.action === 'delete' && result?.removed === false
        ? 'No bibliography was removed.' : verbs[args.action] ? `${verbs[args.action]} bibliography.` : undefined };
    }
    return { operation: tool };
  };
}
