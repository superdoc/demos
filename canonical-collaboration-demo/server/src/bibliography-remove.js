import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const nodes = (parent, name) => Array.from(parent.getElementsByTagNameNS(W, name));

// Native paragraph removal can leave the other paragraphs of a rendered field behind.
export async function removeBibliographyInSnapshot(outputPath, bibliographyId) {
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  const fields = [];
  const stack = [];
  for (const run of nodes(document, 'r')) {
    for (const child of Array.from(run.childNodes)) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === 'fldChar') {
        const kind = child.getAttributeNS(W, 'fldCharType');
        if (kind === 'begin') stack.push({ instruction: '', start: run });
        else if (kind === 'end' && stack.length) fields.push({ ...stack.pop(), end: run });
      } else if (child.localName === 'instrText' && stack.length) stack.at(-1).instruction += child.textContent;
    }
  }
  const paragraphOf = (node) => {
    while (node && !(node.namespaceURI === W && node.localName === 'p')) node = node.parentNode;
    return node;
  };
  const matches = fields.filter((field) => /^\s*BIBLIOGRAPHY\b/i.test(field.instruction)
    && paragraphOf(field.start)?.getAttributeNS(W14, 'paraId') === bibliographyId);
  const simple = nodes(document, 'fldSimple').filter((field) => /^\s*BIBLIOGRAPHY\b/i.test(field.getAttributeNS(W, 'instr'))
    && paragraphOf(field)?.getAttributeNS(W14, 'paraId') === bibliographyId);
  if (matches.length + simple.length !== 1) throw new Error('The bibliography field could not be uniquely located. Read list again before deleting.');
  const paragraphs = new Set();
  if (simple.length) {
    paragraphs.add(paragraphOf(simple[0]));
    simple[0].parentNode.removeChild(simple[0]);
  } else {
    const { start, end } = matches[0];
    const runs = nodes(document, 'r');
    const removal = runs.slice(runs.indexOf(start), runs.indexOf(end) + 1);
    if (runs.indexOf(end) < runs.indexOf(start)) throw new Error('The bibliography field is invalid.');
    for (const boundary of [start, end]) {
      if (Array.from(boundary.childNodes).some((child) => child.nodeType === 1
        && !(child.namespaceURI === W && ['rPr', 'fldChar', 'instrText'].includes(child.localName)))) {
        throw new Error('The bibliography shares a boundary run with other content and cannot be safely deleted.');
      }
    }
    for (const run of removal) {
      paragraphs.add(paragraphOf(run));
      run.parentNode.removeChild(run);
    }
  }
  for (const paragraph of paragraphs) {
    if (paragraph && !nodes(paragraph, 'sectPr').length && !Array.from(paragraph.childNodes).some((child) => child.nodeType === 1
      && !(child.namespaceURI === W && child.localName === 'pPr'))) paragraph.parentNode.removeChild(paragraph);
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
