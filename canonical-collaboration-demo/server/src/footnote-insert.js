import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const C = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relationshipType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const serializer = new XMLSerializer();
const nodes = (parent, name) => Array.from(parent.getElementsByTagNameNS(W, name));

function word(document, name, attributes = {}) {
  const element = document.createElementNS(W, `w:${name}`);
  for (const [key, value] of Object.entries(attributes)) element.setAttributeNS(W, `w:${key}`, String(value));
  return element;
}

function referenceRun(document, name, noteId) {
  const run = word(document, 'r');
  const properties = word(document, 'rPr');
  properties.appendChild(word(document, 'rStyle', { val: 'FootnoteReference' }));
  properties.appendChild(word(document, 'vertAlign', { val: 'superscript' }));
  run.appendChild(properties);
  run.appendChild(word(document, name, noteId ? { id: noteId } : {}));
  return run;
}

function insertReference(paragraph, offset, reference) {
  const leaves = [];
  let position = 0;
  let fieldDepth = 0;
  function visit(node) {
    if (node.nodeType !== 1) return;
    if (node.namespaceURI === W) {
      if (node.localName === 'del') return;
      if (node.localName === 'fldSimple') {
        fieldDepth++;
        for (const child of Array.from(node.childNodes)) visit(child);
        fieldDepth--;
        return;
      }
      if (node.localName === 'fldChar') {
        const type = node.getAttributeNS(W, 'fldCharType');
        if (type === 'begin') fieldDepth++;
        else if (type === 'end') fieldDepth--;
        return;
      }
      if (node.localName === 't' || ['tab', 'br', 'cr', 'footnoteReference', 'endnoteReference', 'drawing', 'pict'].includes(node.localName)) {
        const length = node.localName === 't' ? node.textContent.length : 1;
        leaves.push({ node, start: position, end: position + length, fieldDepth });
        position += length;
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  }
  visit(paragraph);
  if (offset < 0 || offset > position) throw new Error('The footnote position changed. Place the cursor again.');
  if (offset === position) { paragraph.appendChild(reference); return; }
  if (offset === 0) {
    const first = Array.from(paragraph.childNodes).find((node) => !(node.namespaceURI === W && node.localName === 'pPr'));
    paragraph.insertBefore(reference, first ?? null);
    return;
  }
  const leaf = leaves.find((item) => offset < item.end) ?? leaves.at(-1);
  if (!leaf) { paragraph.appendChild(reference); return; }
  if (leaf.fieldDepth) throw new Error('Place the cursor outside the citation or bibliography field to add a footnote.');
  const run = leaf.node.parentNode;
  if (run.namespaceURI !== W || run.localName !== 'r') throw new Error('This location cannot contain a footnote.');
  const left = run.cloneNode(false);
  const right = run.cloneNode(false);
  let passed = false;
  for (const child of Array.from(run.childNodes)) {
    if (child.namespaceURI === W && child.localName === 'rPr') {
      left.appendChild(child.cloneNode(true)); right.appendChild(child.cloneNode(true));
    } else if (child === leaf.node) {
      const localOffset = offset - leaf.start;
      if (child.localName === 't') {
        for (const [container, text] of [[left, child.textContent.slice(0, localOffset)], [right, child.textContent.slice(localOffset)]]) {
          if (!text) continue;
          const part = child.cloneNode(false);
          part.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
          part.textContent = text; container.appendChild(part);
        }
      } else (localOffset ? left : right).appendChild(child.cloneNode(true));
      passed = true;
    } else (passed ? right : left).appendChild(child.cloneNode(true));
  }
  const parent = run.parentNode;
  const hasContent = (element) => Array.from(element.childNodes).some((child) => child.nodeType === 1 && child.localName !== 'rPr');
  if (hasContent(left)) parent.insertBefore(left, run);
  parent.insertBefore(reference, run);
  if (hasContent(right)) parent.insertBefore(right, run);
  parent.removeChild(run);
}

// Preserve native Word fields while working around the plain-run footnote adapter.
export async function insertFootnoteInSnapshot(outputPath, { at, changeMode = 'direct' }) {
  const segment = at?.segments?.[0];
  if (at?.kind !== 'text' || at.segments.length !== 1 || segment.range.start !== segment.range.end
    || (at.story && at.story.storyType !== 'body') || (at.coordinateSpace && at.coordinateSpace !== 'visible')) {
    throw new Error('Place the cursor in main document text before inserting a footnote.');
  }
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const document = parse(await zip.file('word/document.xml').async('string'));
  const paragraph = nodes(document, 'p').find((node) => node.getAttributeNS(W14, 'paraId') === segment.blockId);
  if (!paragraph) throw new Error('The document position changed. Place the cursor again.');
  const relationships = parse(await zip.file('word/_rels/document.xml.rels').async('string'));
  let relationship = Array.from(relationships.getElementsByTagNameNS(R, 'Relationship'))
    .find((node) => node.getAttribute('Type') === relationshipType);
  if (relationship?.getAttribute('TargetMode') === 'External') throw new Error('External footnote parts are not supported.');
  const target = relationship?.getAttribute('Target') || 'footnotes.xml';
  const partPath = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join('word', target));
  const existing = zip.file(partPath);
  const notes = existing ? parse(await existing.async('string')) : parse(`<w:footnotes xmlns:w="${W}" xmlns:w14="${W14}"/>`);
  if (notes.documentElement.localName !== 'footnotes') throw new Error('The footnote part is invalid. Reimport the original Word document.');
  if (!existing) {
    for (const [id, type, marker] of [[-1, 'separator', 'separator'], [0, 'continuationSeparator', 'continuationSeparator']]) {
      const note = word(notes, 'footnote', { id, type });
      const p = word(notes, 'p'); const run = word(notes, 'r');
      run.appendChild(word(notes, marker)); p.appendChild(run); note.appendChild(p); notes.documentElement.appendChild(note);
    }
  }
  const noteId = String(Math.max(0, ...nodes(notes, 'footnote').map((node) => Number(node.getAttributeNS(W, 'id')) || 0)) + 1);
  let reference = referenceRun(document, 'footnoteReference', noteId);
  if (changeMode === 'tracked') {
    const ids = [...nodes(document, 'ins'), ...nodes(document, 'del')].map((node) => Number(node.getAttributeNS(W, 'id')) || 0);
    const insertion = word(document, 'ins', { id: Math.max(0, ...ids) + 1, author: 'Demo user', date: new Date().toISOString() });
    insertion.appendChild(reference); reference = insertion;
  }
  insertReference(paragraph, segment.range.start, reference);
  const note = word(notes, 'footnote', { id: noteId });
  const p = word(notes, 'p');
  p.setAttributeNS(W14, 'w14:paraId', randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase());
  const properties = word(notes, 'pPr'); properties.appendChild(word(notes, 'pStyle', { val: 'FootnoteText' })); p.appendChild(properties);
  note.appendChild(p); notes.documentElement.appendChild(note);
  if (!relationship) {
    relationship = relationships.createElementNS(R, 'Relationship');
    for (const [key, value] of Object.entries({ Id: `rIdFootnotes${randomUUID().replaceAll('-', '')}`, Type: relationshipType, Target: target })) relationship.setAttribute(key, value);
    relationships.documentElement.appendChild(relationship);
  }
  const contentTypes = parse(await zip.file('[Content_Types].xml').async('string'));
  if (!Array.from(contentTypes.getElementsByTagNameNS(C, 'Override')).some((node) => node.getAttribute('PartName') === `/${partPath}`)) {
    const override = contentTypes.createElementNS(C, 'Override');
    override.setAttribute('PartName', `/${partPath}`); override.setAttribute('ContentType', contentType); contentTypes.documentElement.appendChild(override);
  }
  zip.file('word/document.xml', serializer.serializeToString(document));
  zip.file(partPath, serializer.serializeToString(notes));
  zip.file('word/_rels/document.xml.rels', serializer.serializeToString(relationships));
  zip.file('[Content_Types].xml', serializer.serializeToString(contentTypes));
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { success: true, footnote: { kind: 'entity', entityType: 'footnote', noteId } };
}
