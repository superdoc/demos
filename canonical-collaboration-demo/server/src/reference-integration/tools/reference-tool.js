const sourceTypes = ['book', 'journalArticle', 'conferenceProceedings', 'website', 'report', 'patent', 'case', 'statute', 'thesis', 'film', 'interview', 'misc'];
const textFields = ['title', 'year', 'publisher', 'city', 'journalName', 'volume', 'issue', 'pages', 'url', 'doi', 'edition', 'medium', 'shortTitle', 'standardNumber', 'corporateAuthor'];
const peopleFields = ['authors', 'editor', 'translator'];
const person = {
  type: 'object', additionalProperties: false,
  properties: { first: { type: 'string' }, middle: { type: 'string' }, last: { type: 'string', minLength: 1 } },
  required: ['last'],
};

export const referenceTool = {
  type: 'function',
  function: {
    name: 'superdoc_references',
    description: 'Create citations/references in the saved library, or list/get/update/delete them. "Create citations but do not insert anything yet" means call this tool with action=create to save the source records now, without inserting document text, citation markers, footnotes, or a bibliography. For paragraph-by-paragraph requests, inspect the paragraphs, identify their sources, and save each distinct missing source; reuse a source across paragraphs rather than duplicating it. Create returns a stable sourceId for later superdoc_insert_citation calls. Updates refresh existing citation/bibliography results. Delete refuses still-cited sources. Metadata saves directly. Use list/get for the current revision before mutations.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'delete'] },
        sourceId: { type: 'string', minLength: 1, description: 'Required for get/update/delete. Copy from the reference library or a tool result.' },
        type: { type: 'string', enum: sourceTypes, description: 'Required for create; optional for update.' },
        fields: {
          type: 'object', additionalProperties: false,
          description: 'Source metadata. Create requires title. Update patches only supplied fields; empty strings/arrays clear optional fields. Use corporateAuthor for an organization instead of authors. Do not invent missing publication details.',
          properties: {
            ...Object.fromEntries(textFields.map((name) => [name, { type: 'string' }])),
            ...Object.fromEntries(peopleFields.map((name) => [name, { type: 'array', items: person }])),
          },
        },
        expectedRevision: { type: 'string', minLength: 1, description: 'Required for create/update/delete: latest evaluatedRevision from the library/list/get or revision from superdoc_inspect.' },
      },
      required: ['action'],
    },
  },
};

export const referenceInstructions = `Use superdoc_references to list/get/create/update/delete saved references.

CREATING REFERENCES VERSUS INSERTING CITATIONS
- "Create citations", "prepare citations", or "create references" requests saved source records: call superdoc_references with action=create. Citation suggestions written only in chat do not complete a request to create references.
- "Don't insert anything yet" / "do not insert into the document" permits saving reference-library metadata now. It forbids inserting document text, citation markers, footnotes, or bibliography blocks. Do not defer saving the library entries until a future insertion request, and do not ask permission again for the creation the user just requested.
- Example: "for each paragraph, create citations, but dont insert anything yet" → inspect the body paragraphs, identify relevant sources, reuse existing references, and create each distinct missing source now with superdoc_references. Report which saved sources cover which paragraphs. One source can support several paragraphs; do not create duplicate records for the same source. If a paragraph has no identifiable source, state that limitation instead of inventing one.
- Use source identity/metadata from the user's request, the document, the conversation, and established bibliographic facts you confidently know. Omit unknown optional details. Never fabricate a publication, edition-specific page numbers, publisher, URL, or DOI. Ask for missing source identity only when it cannot be identified from the available information.
- Claim a reference was saved only after a successful create result. When the user later asks to insert it, use the returned source.sourceId with superdoc_insert_citation.

Use corporateAuthor for an organization. Read list/get when refreshing source IDs or revisions; use the latest result's evaluatedRevision after a mutation. Update patches only supplied fields and refreshes native citation/bibliography results. Source-catalog edits are metadata saved directly, while inserted document citations/footnotes still follow the request's tracked/direct mode. Do not describe metadata edits as tracked changes. Deleting a still-cited source is refused; do not bypass this by deleting document content. Creating references leaves rendered document text alone and does not create a bibliography block. Earlier chat claims that source creation needs an insertion request or additional permission are outdated.`;

export function referenceInput(args) {
  if (!['list', 'get', 'create', 'update', 'delete'].includes(args?.action)) throw new Error('Choose list, get, create, update, or delete.');
  const { action, sourceId, type, fields, expectedRevision } = args;
  if (['get', 'update', 'delete'].includes(action) && (typeof sourceId !== 'string' || !sourceId.trim())) throw new Error('A saved sourceId is required.');
  if (['create', 'update', 'delete'].includes(action) && (typeof expectedRevision !== 'string' || !expectedRevision)) throw new Error('Read the current reference library or inspect the document for expectedRevision first.');
  if ((action === 'create' || type !== undefined) && !sourceTypes.includes(type)) throw new Error('Choose a supported reference type.');
  if (fields !== undefined) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Reference fields must be an object.');
    for (const [name, value] of Object.entries(fields)) {
      if (textFields.includes(name) && typeof value === 'string') continue;
      if (peopleFields.includes(name) && Array.isArray(value) && value.every((p) => p && typeof p.last === 'string' && p.last.trim()
        && Object.keys(p).every((key) => ['first', 'middle', 'last'].includes(key) && typeof p[key] === 'string'))) continue;
      throw new Error(`Invalid reference field: ${name}.`);
    }
    if ('authors' in fields && 'corporateAuthor' in fields) throw new Error('Use authors or corporateAuthor, not both.');
    if ('title' in fields && !fields.title.trim()) throw new Error('Reference title cannot be empty.');
  }
  if (action === 'create' && !fields?.title?.trim()) throw new Error('A title is required to create a reference.');
  if (action === 'update' && !type && !Object.keys(fields ?? {}).length) throw new Error('Supply fields or a type to update.');
  return { action, sourceId, type, fields, expectedRevision };
}
