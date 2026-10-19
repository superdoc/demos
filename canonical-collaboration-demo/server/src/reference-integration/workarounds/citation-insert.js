import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { readCitationImport } from './citation-import.js';
import { insertReference } from './footnote-insert.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const nodes = (parent, name) => Array.from(parent.getElementsByTagNameNS(W, name));

// Use the saved Word source tags; SDK source IDs do not survive V2 reloads.
export async function insertCitationInSnapshot(outputPath, { at, sourceIds, changeMode = 'direct', author = 'Demo user' }) {
  const segment = at?.segments?.[0];
  const offset = segment?.range?.start;
  if (at?.kind !== 'text' || at.segments.length !== 1 || !segment?.blockId
    || !Number.isSafeInteger(offset) || offset < 0 || offset !== segment.range.end
    || (at.story && at.story.storyType !== 'body') || (at.coordinateSpace && at.coordinateSpace !== 'visible')) {
    throw new Error('Place the cursor in main document text before inserting a citation.');
  }
  if (!Array.isArray(sourceIds) || !sourceIds.length
    || sourceIds.some((id) => typeof id !== 'string' || !id.trim() || /["\\\r\n]/.test(id))
    || !['direct', 'tracked'].includes(changeMode)) {
    throw new Error('Saved source tags and a direct or tracked change mode are required.');
  }
  const bytes = await fs.readFile(outputPath);
  const library = await readCitationImport(bytes);
  if (sourceIds.some((id) => !library.records.some((source) => source.tag === id))) {
    throw new Error('A citation source is not in the document reference library. Refresh the references and retry.');
  }
  const zip = await JSZip.loadAsync(bytes);
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  const paragraphs = nodes(document, 'p').filter((node) => node.getAttributeNS(W14, 'paraId') === segment.blockId);
  if (paragraphs.length !== 1) throw new Error('The document position changed. Place the cursor again.');
  const paragraph = paragraphs[0];
  const word = (name) => document.createElementNS(W, `w:${name}`);
  const quote = (id) => /\s/.test(id) ? `"${id}"` : id;
  const instruction = `CITATION ${sourceIds.map((id, index) => `${index ? '\\m ' : ''}${quote(id)}`).join(' ')}`;
  const field = document.createDocumentFragment();
  for (const kind of ['begin', 'instruction', 'separate', 'result', 'end']) {
    const run = word('r');
    const node = word(kind === 'instruction' ? 'instrText' : kind === 'result' ? 't' : 'fldChar');
    if (kind === 'instruction' || kind === 'result') {
      node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      node.textContent = kind === 'instruction' ? instruction : ' ';
    } else node.setAttributeNS(W, 'w:fldCharType', kind);
    run.appendChild(node); field.appendChild(run);
  }
  let reference = field;
  if (changeMode === 'tracked') {
    reference = word('ins');
    const ids = [...nodes(document, 'ins'), ...nodes(document, 'del')].map((node) => Number(node.getAttributeNS(W, 'id')) || 0);
    reference.setAttributeNS(W, 'w:id', String(Math.max(0, ...ids) + 1));
    reference.setAttributeNS(W, 'w:author', author);
    reference.setAttributeNS(W, 'w:date', new Date().toISOString());
    reference.appendChild(field);
  }
  insertReference(paragraph, offset, reference, 'citation');
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { instruction, blockId: segment.blockId, offset };
}
