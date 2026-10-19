import { referenceAnchorSchema, validateReferenceAnchor } from './reference-anchor-contract.js';

export const footnoteTool = {
  type: 'function',
  function: {
    name: 'superdoc_insert_footnote',
    strict: true,
    description: 'Insert a native, automatically numbered footnote and its plain-text content. First use superdoc_inspect to read the target body block and revision. Pass anchor={kind:afterText, text:<exact requested words>, sectionHeading:<heading>} for a phrase, or sectionEnd for the end of a named section. Never count character offsets. The host resolves and verifies the exact position and returns placement evidence. The marker is inserted at that position without replacing text. Re-inspect after each mutation before inserting another note. Do not type a superscript number or append a fake footnote section.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        anchor: referenceAnchorSchema,
        content: { type: 'string', minLength: 1, description: 'The footnote text, without a manually typed number.' },
        expectedRevision: { type: 'string', minLength: 1, description: 'revision from the latest superdoc_inspect; never invent it.' },
      },
      required: ['anchor', 'content', 'expectedRevision'],
    },
  },
};

export const footnoteInstructions = `The additional superdoc_insert_footnote tool provides real Word footnotes through the host integration. Use it for real footnotes, including the note text, instead of typing superscript numbers or creating a footnote section manually. Read the exact anchor text/section and revision with superdoc_inspect first. Use afterText for a phrase and sectionEnd for a named section ending; never calculate offsets. Check resolvedAnchor in the result before claiming placement. The host enforces the current request's change mode. Re-inspect after any mutation; a stale revision fails without inserting a note. If insertion fails, report the error; do not offer or insert imitation footnotes unless the user explicitly requests them. Earlier chat messages claiming native footnotes are unavailable are outdated; use this tool.`;

export function footnoteInput(args) {
  const anchor = validateReferenceAnchor(args?.anchor);
  if (typeof args.content !== 'string' || !args.content.trim()
    || typeof args.expectedRevision !== 'string' || !args.expectedRevision
    || !['direct', 'tracked'].includes(args.changeMode ?? 'direct')) {
    throw new Error('Footnote insertion requires an exact text/section anchor, note content, and the latest inspected expectedRevision.');
  }
  return {
    anchor,
    content: args.content,
    changeMode: args.changeMode ?? 'direct',
    expectedRevision: args.expectedRevision,
    author: 'Assistant',
  };
}
