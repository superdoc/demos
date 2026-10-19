import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

// Insert a native Word field without invoking the SDK's paragraph-style resolver.
export async function insertBibliographyInSnapshot(outputPath, { position = 'documentEnd', blockId }) {
  if (!['documentStart', 'documentEnd', 'before', 'after'].includes(position)) throw new Error('Choose a bibliography position in the main document.');
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  const body = document.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('The main document body could not be found.');
  let before;
  if (position === 'documentStart') before = body.firstChild;
  else if (position === 'documentEnd') {
    before = Array.from(body.childNodes).find((node) => node.namespaceURI === W && node.localName === 'sectPr') ?? null;
  } else {
    const matches = Array.from(body.childNodes).filter((node) => node.namespaceURI === W && node.localName === 'p'
      && node.getAttributeNS(W14, 'paraId') === blockId);
    if (matches.length !== 1) throw new Error('The bibliography position must identify a current top-level body paragraph. Inspect the document again.');
    before = position === 'before' ? matches[0] : matches[0].nextSibling;
  }
  const paragraph = document.createElementNS(W, 'w:p');
  const ids = new Set(Array.from(document.getElementsByTagNameNS(W, 'p')).map((node) => node.getAttributeNS(W14, 'paraId')));
  let nodeId;
  do { nodeId = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase(); } while (ids.has(nodeId));
  paragraph.setAttributeNS(W14, 'w14:paraId', nodeId);
  const field = document.createElementNS(W, 'w:fldSimple');
  field.setAttributeNS(W, 'w:instr', 'BIBLIOGRAPHY');
  paragraph.appendChild(field);
  body.insertBefore(paragraph, before);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { kind: 'block', nodeType: 'bibliography', nodeId };
}
