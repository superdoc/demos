const actions = ['list', 'get', 'create', 'update', 'delete'];
const styles = ['APA', 'Chicago', 'MLA'];
const positions = ['documentStart', 'documentEnd', 'before', 'after'];

export const bibliographyTool = {
  type: 'function',
  function: {
    name: 'superdoc_bibliographies',
    description: 'Use this tool when asked to add/insert/create a bibliography, including "add a bibliography to the last page": read list, then create at documentEnd using the returned evaluatedRevision and current style. Do the requested operation now; do not ask for confirmation or insert a heading/plain-text entries through generic tools. Also supports get/update/delete of native Word bibliography fields. Use superdoc_references for individual saved sources and superdoc_insert_citation for in-text citations. Update refreshes entries and optionally applies APA, Chicago, or MLA document-wide, matching the toolbar. Delete preserves sources and in-text citations. The host enforces the request mode and returns capability errors; call this tool rather than predicting failure or offering a workaround.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: actions },
        bibliographyId: { type: 'string', minLength: 1, description: 'Required for get/update/delete. Copy the bibliographyId from list/get, not a source ID or heading ID.' },
        style: { type: 'string', enum: styles, description: 'Optional for create/update. Uses the current style when omitted; changing it also updates document citations and other bibliographies.' },
        position: { type: 'string', enum: positions, description: 'Create only. Defaults to documentEnd. Before/after positions require blockId.' },
        blockId: { type: 'string', minLength: 1, description: 'For create before/after an inspected body paragraph. Copy its nodeId from superdoc_inspect.' },
        expectedRevision: { type: 'string', minLength: 1, description: 'Required for create/update/delete: evaluatedRevision from the latest list/get or revision from superdoc_inspect.' },
      },
      required: ['action'],
    },
  },
};

export const bibliographyInstructions = `Use superdoc_bibliographies to list/get/create/update/delete native bibliography fields in the document. Use superdoc_references to manage individual source records and superdoc_insert_citation to insert in-text markers; these are separate tasks.
- "Add a bibliography to the last page" means call superdoc_bibliographies action=list, then action=create with position=documentEnd, the returned evaluatedRevision, and the current style. The user has authorized creation; do not ask for approval, a title, or a style already supplied by the document. DocumentEnd appends to the final page and may flow onto a new page if needed. Do not insert a page break unless requested.
- Native bibliography requests MUST use this tool before any generic document mutation. Never use insert_paragraphs, insert_heading, insert_list, rewrite_block, or other text actions to imitate a bibliography or work around mode/style failures. Do not repair document styles as part of a bibliography request.
- Read list first to discover real bibliography IDs and the current revision. A heading named Bibliography is not itself a native bibliography. Never invent IDs or create a duplicate when the user asked to refresh an existing bibliography.
- Create uses saved references, defaults to the document end/current style, and does not create new sources. For a requested location, inspect the body paragraph and use position=before/after with its blockId. Do not add a heading or insert any other text unless requested.
- Update refreshes an existing bibliography from current sources; optional style=APA/Chicago/MLA applies document-wide, keeping citations and the toolbar in sync. An update without style just refreshes results. Re-read after each mutation.
- Delete removes the selected bibliography field and all its generated paragraphs. It leaves in-text citation markers and saved references intact. It does not delete an independently typed heading.
- The host enforces changeMode. Call the requested bibliography operation even in Reviewing mode to obtain its actual result. If it reports Editing mode is required, state that the user must choose Editing in the Agent edit mode dropdown and retry. Do not ask for permission, offer a plain-text alternative, claim you can switch UI modes, or retry as direct. Reads still work in either mode.
- A formattingWarning means the native change succeeded; do not repeat creation. Report the warning and use update to retry rendering if needed. Only claim success after a successful tool result. Earlier chat statements that bibliography tools are unavailable are outdated.`;

export function requestsBibliographyCreation(prompt) {
  const command = /\b(?:add|insert|create|append|generate|build)\s+(?:(?:a|an|the|new|native|word|formatted|apa|chicago|mla)\s+)*bibliograph(?:y|ies)\b/i;
  const match = command.exec(prompt);
  if (!match) return false;
  const preceding = prompt.slice(Math.max(0, match.index - 40), match.index);
  return !/\b(?:do\s+not|don['’]?t|never|without|not\s+to)\s+(?:\w+\s+){0,3}$/i.test(preceding);
}

export function bibliographyInput(args) {
  if (!actions.includes(args?.action)) throw new Error('Choose list, get, create, update, or delete.');
  const { action, bibliographyId, style, blockId, expectedRevision } = args;
  const position = args.position ?? 'documentEnd';
  const changeMode = args.changeMode ?? 'direct';
  const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());
  if (['get', 'update', 'delete'].includes(action) && !nonempty(bibliographyId)) throw new Error('A bibliographyId from list/get is required.');
  if (['create', 'update', 'delete'].includes(action) && !nonempty(expectedRevision)) throw new Error('Read the current bibliography list or inspect the document for expectedRevision first.');
  if (style !== undefined && (!styles.includes(style) || !['create', 'update'].includes(action))) throw new Error('Style must be APA, Chicago, or MLA and is only used for create/update.');
  if (!positions.includes(position)) throw new Error('Choose documentStart, documentEnd, before, or after.');
  if (action === 'create' && ['before', 'after'].includes(position) && !nonempty(blockId)) throw new Error('An inspected body paragraph blockId is required for before/after insertion.');
  if (action !== 'create' && (args.position !== undefined || blockId !== undefined)) throw new Error('Position and blockId are only used for creation.');
  if (!['direct', 'tracked'].includes(changeMode)) throw new Error('Choose direct or tracked change mode.');
  return { action, bibliographyId, style, position, blockId, expectedRevision, changeMode };
}
