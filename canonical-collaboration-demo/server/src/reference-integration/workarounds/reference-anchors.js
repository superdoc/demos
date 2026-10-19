import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { validateReferenceAnchor } from '../tools/reference-anchor-contract.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const children = (node, name) => Array.from(node.childNodes).filter((child) => child.namespaceURI === W && child.localName === name);

// Shared visible coordinates for exact-text resolution and OOXML insertion.
export function readParagraphPosition(paragraph) {
  const leaves = [];
  let length = 0;
  let fieldDepth = 0;
  function visit(node) {
    if (node.nodeType !== 1) return;
    if (node.namespaceURI === W) {
      const name = node.localName;
      if (['del', 'moveFrom', 'pPr', 'rPr', 'instrText', 'delInstrText'].includes(name) || (name === 'p' && node !== paragraph)) return;
      if (name === 'fldSimple') {
        fieldDepth++;
        for (const child of Array.from(node.childNodes)) visit(child);
        fieldDepth--;
        return;
      }
      if (name === 'fldChar') {
        const kind = node.getAttributeNS(W, 'fldCharType');
        if (kind === 'begin') fieldDepth++;
        else if (kind === 'end') fieldDepth = Math.max(0, fieldDepth - 1);
        return;
      }
      let text;
      if (name === 't') text = node.textContent;
      else if (name === 'tab') text = '\t';
      else if (['br', 'cr'].includes(name)) text = '\n';
      else if (['footnoteReference', 'endnoteReference', 'drawing', 'pict', 'object', 'sym'].includes(name)) text = '\ufffc';
      else if (name === 'noBreakHyphen') text = '\u2011';
      else if (name === 'softHyphen') text = '\u00ad';
      if (text !== undefined) {
        leaves.push({ node, start: length, end: length + text.length, fieldDepth, text });
        length += text.length;
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  }
  visit(paragraph);
  return { leaves, length, text: leaves.map((leaf) => leaf.text).join('') };
}

export async function resolveReferenceAnchor(outputPath, anchor) {
  anchor = validateReferenceAnchor(anchor);
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const document = parse(await zip.file('word/document.xml').async('string'));
  const body = document.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('The document has no main body. No insertion was made.');
  const paragraphs = children(body, 'p').map((node) => ({ node, ...readParagraphPosition(node), blockId: node.getAttributeNS(W14, 'paraId') }));
  const stylesFile = zip.file('word/styles.xml');
  const styles = stylesFile ? parse(await stylesFile.async('string')) : undefined;
  const definitions = new Map(Array.from(styles?.getElementsByTagNameNS(W, 'style') ?? []).map((node) => [node.getAttributeNS(W, 'styleId'), node]));
  const outlineLevel = (properties) => {
    const value = properties && children(properties, 'outlineLvl')[0]?.getAttributeNS(W, 'val');
    return value && /^[0-8]$/.test(value) ? Number(value) : undefined;
  };
  function headingLevel(paragraph) {
    const properties = children(paragraph.node, 'pPr')[0];
    const direct = outlineLevel(properties);
    if (direct !== undefined) return direct;
    let id = properties && children(properties, 'pStyle')[0]?.getAttributeNS(W, 'val');
    const seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const style = definitions.get(id);
      if (!style) break;
      const level = outlineLevel(children(style, 'pPr')[0]);
      if (level !== undefined) return level;
      id = children(style, 'basedOn')[0]?.getAttributeNS(W, 'val');
    }
    return undefined;
  }
  let scope = paragraphs;
  if (anchor.sectionHeading) {
    const normalize = (text) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
    const matches = paragraphs.map((paragraph, index) => ({ paragraph, index, level: headingLevel(paragraph) }))
      .filter(({ paragraph, level }) => level !== undefined && normalize(paragraph.text) === normalize(anchor.sectionHeading));
    if (matches.length !== 1) throw new Error('The section heading was not found uniquely. Inspect it and supply its exact heading text.');
    const heading = matches[0];
    let end = heading.index + 1;
    while (end < paragraphs.length) {
      const level = headingLevel(paragraphs[end]);
      if (level !== undefined && level <= heading.level) break;
      end++;
    }
    scope = paragraphs.slice(heading.index + 1, end);
  }
  if (anchor.blockId) scope = scope.filter((paragraph) => paragraph.blockId === anchor.blockId);
  let paragraph;
  let offset;
  if (anchor.kind === 'afterText') {
    const matches = [];
    for (const candidate of scope) {
      let from = 0;
      while (from <= candidate.text.length) {
        const index = candidate.text.indexOf(anchor.text, from);
        if (index < 0) break;
        matches.push({ paragraph: candidate, offset: index + anchor.text.length });
        from = index + 1;
      }
    }
    if (matches.length !== 1) throw new Error(`The exact text anchor matched ${matches.length} locations. Supply an exact, unique quote and/or its section or paragraph. No insertion was made.`);
    ({ paragraph, offset } = matches[0]);
  } else {
    const candidates = scope.filter((item) => item.text.trim() && headingLevel(item) === undefined);
    if (anchor.kind === 'paragraphEnd' && scope.length !== 1) throw new Error('The paragraph anchor changed. Inspect it again.');
    paragraph = anchor.kind === 'sectionEnd' ? candidates.at(-1) : scope[0];
    if (!paragraph) throw new Error('The requested section has no addressable body paragraph.');
    offset = paragraph.text.trimEnd().length;
  }
  if (!paragraph.blockId) throw new Error('The reference paragraph has no stable block ID. Inspect the document again.');
  return {
    at: { kind: 'text', coordinateSpace: 'visible', segments: [{ blockId: paragraph.blockId, range: { start: offset, end: offset } }] },
    resolvedAnchor: { ...anchor, blockId: paragraph.blockId, offset,
      before: paragraph.text.slice(Math.max(0, offset - 120), offset), after: paragraph.text.slice(offset, offset + 120) },
  };
}

export async function verifyInsertedReference(outputPath, { kind, blockId, offset, noteId, instruction }) {
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  const paragraphs = Array.from(document.getElementsByTagNameNS(W, 'p')).filter((node) => node.getAttributeNS(W14, 'paraId') === blockId);
  if (paragraphs.length !== 1) throw new Error('The inserted reference paragraph could not be verified. No changes were applied.');
  const paragraph = paragraphs[0];
  const { leaves } = readParagraphPosition(paragraph);
  let matches;
  if (kind === 'footnote') {
    matches = leaves.filter((leaf) => leaf.node.namespaceURI === W && leaf.node.localName === 'footnoteReference'
      && leaf.node.getAttributeNS(W, 'id') === noteId && leaf.start === offset);
  } else {
    const order = new Map();
    let index = 0;
    function visit(node) { order.set(node, index++); for (const child of Array.from(node.childNodes)) visit(child); }
    visit(paragraph);
    matches = Array.from(paragraph.getElementsByTagNameNS(W, 'instrText')).filter((node) => node.textContent.trim() === instruction.trim()
      && leaves.filter((leaf) => order.get(leaf.node) < order.get(node)).reduce((length, leaf) => length + leaf.text.length, 0) === offset);
  }
  if (matches.length !== 1) throw new Error('The inserted reference did not match its resolved text anchor. No changes were applied.');
  return true;
}
