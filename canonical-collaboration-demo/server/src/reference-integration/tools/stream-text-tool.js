export const streamTextTool = {
  type: 'function',
  function: {
    name: 'superdoc_stream_text',
    description: 'The required tool for writing document prose and heading wording. Streams one paragraph as it is generated, without the user needing to request streaming. Use replace for an exact unique existing passage within ONE paragraph (including headings), before/after for inline text beside an exact unique passage, paragraphBefore/paragraphAfter to create a NEW paragraph beside an existing passage, or append for a NEW paragraph at document end. To create a heading, stream the paragraph then apply_style with headingLevel. To style new prose, stream first then format_text. Text must not contain newlines: make a separate call per paragraph. Inspect before editing. Supply mode and anchor BEFORE text, and text LAST. Use dedicated tools for native lists, tables, citations, footnotes and bibliographies.',
    strict: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['replace', 'before', 'after', 'append', 'paragraphBefore', 'paragraphAfter'] },
        anchor: { type: ['string', 'null'], description: 'Exact unique current document text; null only for append.' },
        text: { type: 'string', description: 'New plain text for one paragraph, without newlines. Emit this property last.' },
      },
      required: ['mode', 'anchor', 'text'],
    },
  },
};

export function streamTextInput(args) {
  if (!args || !['replace', 'before', 'after', 'append', 'paragraphBefore', 'paragraphAfter'].includes(args.mode)
    || typeof args.text !== 'string' || /[\r\n]/.test(args.text) || Object.keys(args).some((key) => !['mode', 'anchor', 'text', 'changeMode'].includes(key))
    || (args.mode === 'append' ? args.anchor !== null : typeof args.anchor !== 'string' || !args.anchor.trim())) {
    throw new Error('Supply mode, an exact unique anchor (null for append), and plain text.');
  }
  return args;
}
