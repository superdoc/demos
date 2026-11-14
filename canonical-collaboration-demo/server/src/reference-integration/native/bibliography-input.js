const actions = ['list', 'get', 'create', 'update', 'delete'];
const styles = ['APA', 'Chicago', 'MLA'];
const positions = ['documentStart', 'documentEnd', 'before', 'after'];

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
