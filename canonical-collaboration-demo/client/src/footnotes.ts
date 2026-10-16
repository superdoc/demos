import JSZip from 'jszip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

export async function readFootnoteLocations(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('Document text could not be read.');
  const document = new DOMParser().parseFromString(await part.async('string'), 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Document text could not be read.');
  const blocks = new Map<string, number>();
  const references: { noteId: string; blockId: string; offset: number }[] = [];
  for (const [index, paragraph] of Array.from(document.getElementsByTagNameNS(W, 'p')).entries()) {
    const blockId = paragraph.getAttributeNS(W14, 'paraId');
    if (!blockId) continue;
    blocks.set(blockId, index);
    let offset = 0;
    function visit(node: Element) {
      if (node.namespaceURI === W) {
        if (node.localName === 'del' || (node.localName === 'p' && node !== paragraph)) return;
        if (node.localName === 't') { offset += node.textContent?.length ?? 0; return; }
        if (node.localName === 'footnoteReference') {
          const noteId = node.getAttributeNS(W, 'id');
          if (noteId) references.push({ noteId, blockId: blockId!, offset });
          offset++;
          return;
        }
        if (['endnoteReference', 'tab', 'br', 'cr', 'drawing', 'pict', 'object', 'sym', 'noBreakHyphen'].includes(node.localName)) {
          offset++;
          return;
        }
      }
      for (const child of Array.from(node.children)) visit(child);
    }
    visit(paragraph);
  }
  return { references, blocks };
}
