import { nativeCalls, nativeOperationId } from './reference-integration/native/reference-api.js';

const readTools = new Set([
  'superdoc_inspect', 'superdoc_api_search', 'superdoc_api_call', 'get_document_cursor',
  'document_memory', 'recent_document_passage', 'recent_document_table',
]);
const readOperations = new Set([
  'doc.info', 'doc.get', 'doc.find', 'doc.getText', 'doc.getMarkdown', 'doc.getHtml', 'doc.getNode', 'doc.getNodeById',
  'doc.blocks.list', 'doc.query.match', 'doc.sections.list', 'doc.sections.get',
  'doc.headerFooters.list', 'doc.headerFooters.resolve', 'doc.format.readSelection',
  'doc.tables.get', 'doc.tables.getCells', 'doc.tables.getProperties', 'doc.tables.getStyles',
  'doc.styles.getCatalog', 'doc.styles.getTheme', 'doc.fields.list', 'doc.hyperlinks.list',
  'doc.images.list', 'doc.lists.list', 'doc.comments.list',
  'doc.trackChanges.list', 'doc.trackChanges.get', 'doc.citations.sources.list', 'doc.footnotes.list',
]);
const relativeMemoryRequest = /^(?:please\s+)?(?:remember|save) (?:this|that|the selected|the last) (?:clause|passage|paragraph|sentence|text|selection)(?: and its formatting)?(?: for later)?[.!?]?$/i;
const noDocumentEdit = /(?:^|[.!?]\s+)(?:please\s+)?(?:don't|don’t|do not) (?:edit|change|modify) (?:anything|the (?:current )?document)(?: yet)?(?:[.!?,](?=\s|$)|$)/i;
const readRequest = /^(?:please\s+)?(?:(?:(?:can|could) you )?(?:check|verify|confirm) (?:whether|if)|what (?:did|have) you (?:remember|save)|what would (?:happen|change) if|would it (?:help|be better) to|should we|(?:give|show) me .*?alternative (?:wordings|phrasings|rewrites))\b/i;
const additionalEdit = /(?:[.!?]\s+|\b(?:and|then)\s+)(?:please\s+)?(?:add|insert|apply|replace|change|delete|remove|fix|rewrite|format|make|update|correct|bold|underline)\b/i;

export function explicitlyReadOnly(prompt) {
  const text = prompt.trim();
  if (/^(?:please\s+)?(?:in chat only|only in chat)\b/i.test(text)
    || /\b(?:in chat only|without (?:editing|changing|modifying) the (?:current )?document)[.!?]?$/i.test(text)
    || relativeMemoryRequest.test(text)) return true;
  return (noDocumentEdit.test(text) || readRequest.test(text)) && !additionalEdit.test(text);
}

export function refersToRecentMemory(prompt) {
  return relativeMemoryRequest.test(prompt.trim());
}

export function isRelativePassageEdit(prompt) {
  const text = prompt.trim();
  return /^(?:please\s+)?(?:make (?:it|(?:this|that) (?:clause|passage|sentence|paragraph)) (?:bold|italic|underlined|green|red|blue|black|shorter|longer|more concise|clearer)(?: and (?:bold|italic|underlined|green|red|blue|black))?|(?:bold|underline|italicize|shorten|rewrite|remove|delete) (?:it|(?:this|that) (?:clause|passage|sentence|paragraph)))[.!?]?$/i.test(text)
    || /^(?:please\s+)?(?:change|replace|rewrite) (?:it|(?:this|that) (?:clause|passage|sentence|paragraph)) (?:to|with) [“"][^”"]+[”"][.!?]?$/i.test(text);
}

export function isRelativeTableEdit(prompt) {
  return /^(?:please\s+)?(?:add (?:a|one|two|three|four|five|\d+) (?:blank )?rows? (?:to|at the end of) (?:it|(?:that|this|the new) table)|(?:remove|delete) (?:it|(?:that|this|the new) table))[.!?]?$/i.test(prompt.trim());
}

export function choosesDiscussedDraft(prompt) {
  return /^(?:please\s+)?(?:use|apply|go with) (?:the )?(?:(?:first|second|third|last)(?: (?:one|option|version|draft|wording))?|option (?:one|two|three|[1-9]))[.!?]?$/i.test(prompt.trim());
}

export function followsChatDraft(prompt, history) {
  if (!isRelativePassageEdit(prompt)) return false;
  const previous = history.findLast(({ role }) => role === 'user')?.content;
  return typeof previous === 'string' && (
    previous === 'Create a reusable prompt'
    || (explicitlyReadOnly(previous) && /\b(?:write|draft|rewrite|rephrase)\b/i.test(previous))
  );
}

export function isReadOperation(args) {
  return nativeCalls(args).every((call) => readOperations.has(nativeOperationId(call?.operationId)));
}

export function readOnlyToolAllowed(name) {
  return readTools.has(name);
}

export function assertReadOnly(tool, args) {
  if ((tool === 'superdoc_api_call' && !isReadOperation(args))
    || (tool === 'document_memory' && args.operation === 'insert')
    || (['recent_document_passage', 'recent_document_table'].includes(tool) && args.operation !== 'read')) {
    throw new Error('The user requested a response without modifying the document. Use read operations only.');
  }
}
