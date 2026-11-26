export const streamTextTool = {
  type: 'function',
  function: {
    name: 'superdoc_stream_text',
    description: 'Streams one paragraph of plain text as it is generated. Use this for body prose, heading wording, and text in existing headers and footers. Use replace for an exact unique existing passage within one paragraph, before/after for inline text beside an exact passage, paragraphBefore/paragraphAfter for a new paragraph beside an existing passage, or append for a new paragraph at the end of the selected story. Inspect before editing. Supply mode, anchor and story before text, and text last. Use dedicated tools for lists, tables, citations, footnotes and bibliographies.',
    strict: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['replace', 'before', 'after', 'append', 'paragraphBefore', 'paragraphAfter'] },
        anchor: { type: ['string', 'null'], description: 'Exact current text unique within the selected story. Use null for append.' },
        story: {
          description: 'Use null for the body. For a header or footer, use its resolved part reference.',
          anyOf: [
            { type: 'null' },
            { type: 'object', additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['story'] },
                storyType: { type: 'string', enum: ['headerFooterPart'] },
                refId: { type: 'string' },
              },
              required: ['kind', 'storyType', 'refId'],
            },
          ],
        },
        text: { type: 'string', pattern: '^[^\\r\\n]*$', description: 'New plain text for one paragraph, without newlines. Emit this property last.' },
      },
      required: ['mode', 'anchor', 'story', 'text'],
    },
  },
};

export function streamTextInput(args) {
  if (!args || !['replace', 'before', 'after', 'append', 'paragraphBefore', 'paragraphAfter'].includes(args.mode)
    || Object.keys(args).some((key) => !['mode', 'anchor', 'story', 'text', 'changeMode'].includes(key))) {
    throw new Error('Supply a valid streaming mode with anchor, story and text.');
  }
  if (args.mode === 'append' ? args.anchor !== null : typeof args.anchor !== 'string' || !args.anchor.trim()) {
    throw new Error('Use a null anchor for append or supply an exact, nonempty anchor for the other modes.');
  }
  if (typeof args.text !== 'string' || /[\r\n]/.test(args.text)) {
    throw new Error('Supply plain text for one paragraph without line breaks.');
  }
  const { story } = args;
  if (story != null && (story.kind !== 'story' || story.storyType !== 'headerFooterPart'
    || typeof story.refId !== 'string' || !story.refId.trim() || Object.keys(story).length !== 3)) {
    throw new Error('Use null for the body or supply a resolved headerFooterPart story with its refId.');
  }
  return args;
}
