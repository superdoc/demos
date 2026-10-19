import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { readParagraphPosition } from './reference-anchors.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const C = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relationshipType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const serializer = new XMLSerializer();
const nodes = (parent, name) => Array.from(parent.getElementsByTagNameNS(W, name));

function footnoteDocument(xml) {
  const document = parse(xml);
  const root = document.documentElement;
  const elements = (node) => Array.from(node.childNodes).filter((child) => child.nodeType === 1);
  const children = elements(root);
  if (root.namespaceURI !== W || root.localName !== 'document' || children.length !== 1
    || children[0].namespaceURI !== W || children[0].localName !== 'body') return document;
  const body = children[0];
  if (!Array.from(body.childNodes).every((child) => child.nodeType === 1
    ? child.namespaceURI === W && child.localName === 'footnote'
    : child.nodeType === 8 || !child.textContent?.trim())) return document;
  // SDK exports can wrap separator-only footnote parts as a main document.
  const footnotes = word(document, 'footnotes');
  for (const attribute of Array.from(root.attributes)) {
    footnotes.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
  }
  for (const child of Array.from(body.childNodes)) footnotes.appendChild(child);
  document.replaceChild(footnotes, root);
  return document;
}

export async function normalizeFootnoteParts(outputPath) {
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const relationshipFile = zip.file('word/_rels/document.xml.rels');
  if (!relationshipFile) return;
  const relationships = parse(await relationshipFile.async('string'));
  let changed = false;
  for (const relationship of Array.from(relationships.getElementsByTagNameNS(R, 'Relationship'))) {
    if (relationship.getAttribute('Type') !== relationshipType || relationship.getAttribute('TargetMode') === 'External') continue;
    const target = relationship.getAttribute('Target');
    const partPath = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join('word', target));
    const file = zip.file(partPath);
    if (!file) continue;
    const xml = await file.async('string');
    const original = parse(xml).documentElement;
    const repaired = footnoteDocument(xml);
    if (original.localName === 'document' && repaired.documentElement.localName === 'footnotes') {
      zip.file(partPath, serializer.serializeToString(repaired));
      changed = true;
    }
  }
  if (changed) await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

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

export function insertReference(paragraph, offset, reference, label = 'footnote') {
  const { leaves, length: position } = readParagraphPosition(paragraph);
  if (offset < 0 || offset > position) throw new Error(`The ${label} position changed. Place the cursor again.`);
  if (offset === position) { paragraph.appendChild(reference); return; }
  if (offset === 0) {
    const first = Array.from(paragraph.childNodes).find((node) => !(node.namespaceURI === W && node.localName === 'pPr'));
    paragraph.insertBefore(reference, first ?? null);
    return;
  }
  const leaf = leaves.find((item) => offset < item.end) ?? leaves.at(-1);
  if (!leaf) { paragraph.appendChild(reference); return; }
  if (leaf.fieldDepth) throw new Error(`Place the cursor outside the citation or bibliography field to add a ${label}.`);
  const run = leaf.node.parentNode;
  if (run.namespaceURI !== W || run.localName !== 'r') throw new Error(`This location cannot contain a ${label}.`);
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
  if (reference.namespaceURI === W && reference.localName === 'ins') {
    for (let ancestor = parent; ancestor && ancestor !== paragraph; ancestor = ancestor.parentNode) {
      if (ancestor.namespaceURI === W && ['ins', 'del', 'moveFrom', 'moveTo'].includes(ancestor.localName)) {
        throw new Error(`Accept or reject the existing tracked change before adding a tracked ${label} here.`);
      }
    }
  }
  const hasContent = (element) => Array.from(element.childNodes).some((child) => child.nodeType === 1 && child.localName !== 'rPr');
  if (hasContent(left)) parent.insertBefore(left, run);
  parent.insertBefore(reference, run);
  if (hasContent(right)) parent.insertBefore(right, run);
  parent.removeChild(run);
}

// Preserve native Word fields while working around the plain-run footnote adapter.
export async function insertFootnoteInSnapshot(outputPath, { at, content = '', changeMode = 'direct', author = 'Demo user' }) {
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
  const notes = existing ? footnoteDocument(await existing.async('string')) : parse(`<w:footnotes xmlns:w="${W}" xmlns:w14="${W14}"/>`);
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
  let insertionAttributes;
  if (changeMode === 'tracked') {
    const ids = [...nodes(document, 'ins'), ...nodes(document, 'del')].map((node) => Number(node.getAttributeNS(W, 'id')) || 0);
    insertionAttributes = { id: Math.max(0, ...ids) + 1, author, date: new Date().toISOString() };
    const insertion = word(document, 'ins', insertionAttributes);
    insertion.appendChild(reference); reference = insertion;
  }
  insertReference(paragraph, segment.range.start, reference);
  const note = word(notes, 'footnote', { id: noteId });
  const p = word(notes, 'p');
  p.setAttributeNS(W14, 'w14:paraId', randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase());
  const properties = word(notes, 'pPr'); properties.appendChild(word(notes, 'pStyle', { val: 'FootnoteText' })); p.appendChild(properties);
  if (content) {
    const container = insertionAttributes ? word(notes, 'ins', insertionAttributes) : p;
    const run = word(notes, 'r');
    for (const [index, line] of content.split(/\r\n|\r|\n/).entries()) {
      if (index) run.appendChild(word(notes, 'br'));
      const text = word(notes, 't');
      text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      text.textContent = line;
      run.appendChild(text);
    }
    container.appendChild(run);
    if (container !== p) p.appendChild(container);
  }
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
