export async function readBibliographies(handle, { style, fieldCodes, readSources }) {
  const items = [];
  let offset = 0;
  let evaluatedRevision;
  do {
    // SDK 2.15 fields.list does not forward a type filter to the runtime.
    const page = await handle.fields.list({ limit: 100, offset });
    if (evaluatedRevision && evaluatedRevision !== page.evaluatedRevision) throw new Error('The document changed while reading bibliographies. Read list again.');
    evaluatedRevision = page.evaluatedRevision;
    for (const field of page.items) {
      if (!/^\s*BIBLIOGRAPHY\b/i.test(field.instruction)) continue;
      const bibliographyId = field.address.blockId;
      if (items.some((item) => item.bibliographyId === bibliographyId)) throw new Error('Multiple bibliography fields share a paragraph and cannot be addressed separately.');
      const target = { kind: 'block', nodeType: 'bibliography', nodeId: bibliographyId };
      const info = await handle.citations.bibliography.get({ target });
      items.push({ ...info, bibliographyId, style, text: field.resolvedText });
    }
    offset += page.items.length;
    if (offset >= page.total || !page.items.length) break;
  } while (true);
  const current = await readSources();
  if (current.evaluatedRevision !== evaluatedRevision) throw new Error('The document changed while reading bibliographies. Read list again.');
  return { items, evaluatedRevision, bibliographyStyle: style, fieldCodes };
}
