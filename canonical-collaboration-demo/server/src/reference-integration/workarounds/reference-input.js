export const sourceTypes = ['book', 'journalArticle', 'conferenceProceedings', 'website', 'report', 'patent', 'case', 'statute', 'thesis', 'film', 'interview', 'misc'];
export const textFields = ['title', 'year', 'publisher', 'city', 'journalName', 'volume', 'issue', 'pages', 'url', 'doi', 'edition', 'medium', 'shortTitle', 'standardNumber', 'corporateAuthor'];
export const peopleFields = ['authors', 'editor', 'translator'];
export const person = {
  type: 'object', additionalProperties: false,
  properties: { first: { type: 'string' }, middle: { type: 'string' }, last: { type: 'string', minLength: 1 } },
  required: ['last'],
};

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

export function referenceLibrary(catalog) {
  return {
    bibliographyStyle: catalog.bibliographyStyle,
    evaluatedRevision: catalog.evaluatedRevision,
    references: catalog.items.map((source, index) => ({
      number: index + 1,
      sourceId: source.sourceId,
      tag: source.tag,
      type: source.type,
      fields: source.fields,
    })),
  };
}
