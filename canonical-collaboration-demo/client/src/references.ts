import type { SuperDoc } from 'superdoc';
import type { BrowserDocumentApi, TextTarget } from 'superdoc/ui';

export type BibliographyStyle = 'APA' | 'Chicago' | 'MLA';
export type CitationSource = Awaited<ReturnType<BrowserDocumentApi['citations']['sources']['get']>>;
export type CitationInsertResult = Awaited<ReturnType<BrowserDocumentApi['citations']['insert']>> & { formattingWarning?: string };

export async function citationTarget(superdoc: SuperDoc): Promise<TextTarget | undefined> {
  const selection = await superdoc.activeEditor?.doc?.selection.current();
  if (!selection) return;
  const endpoint = selection.selectionTarget?.end;
  const last = selection.target?.segments[selection.target.segments.length - 1];
  const point = endpoint?.kind === 'text' ? { blockId: endpoint.blockId, offset: endpoint.offset }
    : last ? { blockId: last.blockId, offset: last.range.end } : undefined;
  if (!point) return;
  return {
    kind: 'text', story: selection.selectionTarget?.story ?? selection.target?.story,
    coordinateSpace: selection.selectionTarget?.coordinateSpace ?? selection.target?.coordinateSpace,
    segments: [{ blockId: point.blockId, range: { start: point.offset, end: point.offset } }],
  };
}

export function referenceDetails(source: CitationSource) {
  const fields = source.fields;
  return [fields.authors?.map((person) => [person.first, person.middle, person.last].filter(Boolean).join(' ')).join(', '),
    fields.year, fields.publisher || fields.journalName, fields.pages && `pp. ${fields.pages}`, fields.doi && `doi:${fields.doi}`, fields.url]
    .filter(Boolean).join(' · ');
}
