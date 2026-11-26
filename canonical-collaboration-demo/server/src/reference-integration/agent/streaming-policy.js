export const nonStreamingTextActions = new Set([
  'insert_paragraphs', 'insert_heading', 'replace_text', 'rewrite_block', 'fill_placeholders',
]);

const streamingOperations = new Set([
  'doc.insert', 'doc.replace', 'doc.create.paragraph', 'doc.create.heading',
  'doc.blocks.insert', 'doc.mutations.apply', 'doc.diff.apply',
]);

function headerFooterKey(story) {
  if (story?.kind !== 'story') return;
  if (story.storyType === 'headerFooterPart' && typeof story.refId === 'string' && story.refId.trim()) {
    return 'part:' + story.refId;
  }
  if (story.storyType === 'headerFooterSlot' && story.section?.kind === 'section' &&
    typeof story.section.sectionId === 'string' && story.section.sectionId.trim() &&
    ['header', 'footer'].includes(story.headerFooterKind) && ['default', 'first', 'even'].includes(story.variant)) {
    return JSON.stringify([story.section.sectionId, story.headerFooterKind, story.variant, story.resolution, story.onWrite]);
  }
}

export function requiresStreaming(operationId, args) {
  if (!streamingOperations.has(operationId)) return false;
  if (operationId === 'doc.create.paragraph') {
    return !headerFooterKey(args?.in) || Boolean(args.input) ||
      (args.at != null && !['documentStart', 'documentEnd'].includes(args.at.kind));
  }
  if (operationId === 'doc.insert' || operationId === 'doc.replace') {
    const target = args?.target;
    const scope = headerFooterKey(target?.story);
    return !scope || !['selection', 'text'].includes(target.kind) || Boolean(args.ref || args.snapshotId) ||
      [args.in, target.start?.story, target.end?.story].some((story) => story != null && headerFooterKey(story) !== scope);
  }
  return true;
}

export const streamingInstructions = `STREAMING DOCUMENT TEXT
Ordinary body prose, heading wording, paragraph insertions, rewrites and placeholder replacements must use superdoc_stream_text. This is enforced by the host and overrides earlier SDK guidance recommending insert_paragraphs, insert_heading, replace_text, rewrite_block or fill_placeholders. Those actions are unavailable to this agent.
Inspect existing text first. Emit mode, anchor and story before text, and text last. Supply story: null for the body. Write one paragraph per call. Use replace for an exact unique passage within a paragraph (including headings), append for a new paragraph at the end of the selected story, paragraphBefore/paragraphAfter for a new paragraph beside an exact existing passage, and before/after for inline insertion. For several paragraphs, inspect their individual text and make separate streaming calls.
For a heading, stream the paragraph text first, then use apply_style with headingLevel. For inline styling, stream the text first, then use format_text. This overrides earlier advice to insert styled prose in a single non-streaming action. Preserve existing formatting when changing wording only.
For headers and footers, find the requested section and variant with doc.headerFooters.list or doc.headerFooters.resolve. Use the resolved {kind:"story", storyType:"headerFooterPart", refId} to inspect existing wording with doc.query.match or doc.blocks.list using "in". Pass that same object as "story" to superdoc_stream_text. A header or footer request must never fall back to the body. Use native story-scoped operations for edits that require a structured target.
For a blank header or footer, call superdoc_stream_text with mode:"append" and anchor:null. If the slot has no part, first create it with doc.headerFooters.parts.create({kind:"header" or "footer"}) and link it with doc.headerFooters.refs.set({target:<requested slot>,refId:<created part>}) in Editing mode. Then stream directly into the newly created part with mode:"append" and anchor:null. In Reviewing mode, text streamed into an existing part is tracked. If the part is missing, explain that it must first be created in Editing mode.
After the stream succeeds, check the new wording once with doc.query.match scoped to the same story, then give the user a brief confirmation. Blank placeholder paragraphs do not need cleanup. Preserve existing fields and unrelated variants.
Keep dedicated tools for native lists, tables, citations, footnotes and bibliographies. Do not imitate those structures with streamed prose. If a streaming write fails after text appears, inspect the current text before retrying; partial text may remain applied.`;

export function streamingTools(tools) {
  return tools.map((tool) => {
    if (tool.function?.name !== 'superdoc_perform_action') return tool;
    const parameters = structuredClone(tool.function.parameters);
    const action = parameters?.properties?.action;
    if (action?.enum) action.enum = action.enum.filter((name) => !nonStreamingTextActions.has(name));
    return { ...tool, function: { ...tool.function, parameters,
      description: `Document structure, formatting, review and other native actions. Body prose and heading text MUST be written with superdoc_stream_text. Stream ordinary header and footer text using the resolved part as the story. The actions insert_paragraphs, insert_heading, replace_text, rewrite_block and fill_placeholders are unavailable. After streaming a heading, use apply_style with headingLevel; after streaming styled prose, use format_text. Available actions: ${action?.enum?.join(', ') ?? 'see schema'}. The following SDK reference documents the remaining actions; any legacy text-writing actions it mentions are unavailable:\n\n${tool.function.description ?? ''}` } };
  });
}
