export const nonStreamingTextActions = new Set([
  'insert_paragraphs', 'insert_heading', 'replace_text', 'rewrite_block', 'fill_placeholders',
]);

export const streamingInstructions = `DOCUMENT TEXT MUST STREAM
All ordinary prose, heading wording, paragraph insertions, rewrites and placeholder replacements must use superdoc_stream_text. This is enforced by the host, requires no special user instruction, and overrides earlier SDK guidance recommending insert_paragraphs, insert_heading, replace_text, rewrite_block or fill_placeholders. Those actions are unavailable to this agent.
Inspect existing text first. Emit mode and anchor before text, and text last. Write one paragraph per call. Use replace for an exact unique passage within a paragraph (including headings), append for a new paragraph at document end, paragraphBefore/paragraphAfter for a new paragraph beside an exact existing passage, and before/after for inline insertion. For several paragraphs, inspect their individual text and make separate streaming calls.
For a heading, stream the paragraph text first, then use apply_style with headingLevel. For inline styling, stream the text first, then use format_text. This overrides earlier advice to insert styled prose in a single non-streaming action. Preserve existing formatting when changing wording only.
Keep dedicated tools for native lists, tables, citations, footnotes and bibliographies. Do not imitate those structures with streamed prose. If a streaming write fails after text appears, inspect the current text before retrying; partial text may remain applied.`;

export function streamingTools(tools) {
  return tools.map((tool) => {
    if (tool.function?.name !== 'superdoc_perform_action') return tool;
    const parameters = structuredClone(tool.function.parameters);
    const action = parameters?.properties?.action;
    if (action?.enum) action.enum = action.enum.filter((name) => !nonStreamingTextActions.has(name));
    return { ...tool, function: { ...tool.function, parameters,
      description: `Document structure, formatting, review and other native actions. Ordinary prose and heading text MUST be written with superdoc_stream_text; insert_paragraphs, insert_heading, replace_text, rewrite_block and fill_placeholders are unavailable. After streaming a heading, use apply_style with headingLevel; after streaming styled prose, use format_text. Available actions: ${action?.enum?.join(', ') ?? 'see schema'}. The following SDK reference documents the remaining actions; any legacy text-writing actions it mentions are unavailable:\n\n${tool.function.description ?? ''}` } };
  });
}
