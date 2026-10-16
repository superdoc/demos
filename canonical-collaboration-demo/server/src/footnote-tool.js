export const footnoteTool = {
  type: 'function',
  function: {
    name: 'superdoc_insert_footnote',
    description: 'Insert a native, automatically numbered footnote and its plain-text content. First use superdoc_inspect to read the target body block and revision. Pass that block nodeId as blockId and a zero-based visible-text offset (UTF-16 code units). The marker is inserted at that position without replacing text. Re-inspect after each mutation before inserting another note. Do not type a superscript number or append a fake footnote section.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        blockId: { type: 'string', minLength: 1, description: 'Body paragraph nodeId from the latest superdoc_inspect.' },
        offset: { type: 'integer', minimum: 0, description: 'Insertion offset within that block. Each existing inline footnote marker occupies one position.' },
        content: { type: 'string', minLength: 1, description: 'The footnote text, without a manually typed number.' },
        expectedRevision: { type: 'string', minLength: 1, description: 'revision from the latest superdoc_inspect; never invent it.' },
      },
      required: ['blockId', 'offset', 'content', 'expectedRevision'],
    },
  },
};

export const footnoteInstructions = `The additional superdoc_insert_footnote tool wraps the document footnote API. Use it for real footnotes, including the note text, instead of typing superscript numbers or creating a footnote section manually. Read the target block and revision with superdoc_inspect first. The host enforces the current request's change mode. Re-inspect after any mutation; a stale revision fails without inserting a note. If insertion fails, report the error; do not offer or insert imitation footnotes unless the user explicitly requests them. Earlier chat messages claiming native footnotes are unavailable are outdated; use this tool.`;

export function footnoteInput(args) {
  if (typeof args.blockId !== 'string' || !args.blockId.trim()
    || !Number.isSafeInteger(args.offset) || args.offset < 0
    || typeof args.content !== 'string' || !args.content.trim()
    || typeof args.expectedRevision !== 'string' || !args.expectedRevision
    || !['direct', 'tracked'].includes(args.changeMode ?? 'direct')) {
    throw new Error('Footnote insertion requires a blockId, non-negative integer offset, note content, and the latest inspected expectedRevision.');
  }
  return {
    at: {
      kind: 'text',
      segments: [{ blockId: args.blockId, range: { start: args.offset, end: args.offset } }],
      coordinateSpace: 'visible',
    },
    content: args.content,
    changeMode: args.changeMode ?? 'direct',
    expectedRevision: args.expectedRevision,
    author: 'Assistant',
  };
}
