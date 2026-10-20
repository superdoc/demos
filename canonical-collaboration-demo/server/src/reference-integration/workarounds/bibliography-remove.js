import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const nodes = (parent, name) => Array.from(parent.getElementsByTagNameNS(W, name));

// Native paragraph removal can leave the other paragraphs of a rendered field behind.
export async function removeBibliographyInSnapshot(outputPath, bibliographyId, { onlyIfEmpty = false } = {}) {
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
  let removal;
  if (simple.length) {
    paragraphs.add(paragraphOf(simple[0]));
    removal = [simple[0]];
  } else {
    const { start, end } = matches[0];
    const runs = nodes(document, 'r');
    removal = runs.slice(runs.indexOf(start), runs.indexOf(end) + 1);
    if (runs.indexOf(end) < runs.indexOf(start)) throw new Error('The bibliography field is invalid.');
    for (const boundary of [start, end]) {
      if (Array.from(boundary.childNodes).some((child) => child.nodeType === 1
        && !(child.namespaceURI === W && ['rPr', 'fldChar', 'instrText'].includes(child.localName)))) {
        throw new Error('The bibliography shares a boundary run with other content and cannot be safely deleted.');
      }
    }
    for (const run of removal) {
      paragraphs.add(paragraphOf(run));
    }
  }
  if (onlyIfEmpty && [...paragraphs].some((paragraph) => !paragraph
    || ['t', 'delText'].some((name) => nodes(paragraph, name).some((node) => node.textContent.trim()))
    || ['drawing', 'pict', 'object', 'sym', 'footnoteReference', 'endnoteReference', 'commentReference', 'bookmarkStart', 'bookmarkEnd', 'sdt', 'tab', 'br', 'cr', 'sectPr'].some((name) => nodes(paragraph, name).length))) {
    return { removed: false };
  }
  const allParagraphs = nodes(document, 'p');
  const firstIndex = allParagraphs.indexOf([...paragraphs][0]);
  const previous = allParagraphs.slice(0, firstIndex).reverse().find((paragraph) => !paragraphs.has(paragraph));
  const next = allParagraphs.slice(firstIndex + 1).find((paragraph) => !paragraphs.has(paragraph));
  const destination = previous ?? next;
  const blockId = destination?.getAttributeNS(W14, 'paraId');
  const offset = previous ? nodes(previous, 't').reduce((length, text) => length + text.textContent.length, 0)
    + ['tab', 'br', 'cr', 'footnoteReference', 'endnoteReference', 'drawing', 'pict'].reduce((length, name) => length + nodes(previous, name).length, 0) : 0;
  for (const node of removal) node.parentNode.removeChild(node);
  const hasContent = (node) => {
    if (node.nodeType === 3) return Boolean(node.textContent.trim());
    if (node.nodeType !== 1) return false;
    if (node.namespaceURI !== W) return true;
    if (['pPr', 'rPr'].includes(node.localName)) return false;
    if (['r', 'ins', 'del', 'hyperlink', 't', 'delText'].includes(node.localName)) return Array.from(node.childNodes).some(hasContent);
    return true;
  };
  for (const paragraph of paragraphs) {
    if (paragraph && !nodes(paragraph, 'sectPr').length && !Array.from(paragraph.childNodes).some(hasContent)) paragraph.parentNode.removeChild(paragraph);
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { removed: true, ...(blockId ? { caret: { blockId, offset } } : {}) };
}
