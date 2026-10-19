import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const nodes = (parent, name) => Array.from(parent.getElementsByTagNameNS(W, name));

// The collaboration runtime cannot remove some imported citation fields through citations.remove.
export async function removeCitationInSnapshot(outputPath, { target, instruction, displayText, changeMode, author = 'Demo user' }) {
  const anchor = target?.anchor;
  if (target?.kind !== 'inline' || target.nodeType !== 'citation' || !anchor
    || anchor.start?.blockId !== anchor.end?.blockId || typeof anchor.start?.blockId !== 'string'
    || !Number.isSafeInteger(anchor.start.offset) || !Number.isSafeInteger(anchor.end.offset)
    || anchor.start.offset < 0 || anchor.end.offset < anchor.start.offset
    || typeof instruction !== 'string' || !/^\s*CITATION\b/i.test(instruction)
    || typeof displayText !== 'string' || !['direct', 'tracked'].includes(changeMode)) {
    throw new Error('A current citation address, instruction, display text, and change mode are required.');
  }
  if (target.story && target.story.storyType !== 'body') throw new Error('The citation deletion fallback currently supports main document text.');
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml').async('string'), 'application/xml');
  const paragraphs = nodes(document, 'p').filter((paragraph) => paragraph.getAttributeNS(W14, 'paraId') === anchor.start.blockId);
  if (paragraphs.length !== 1) throw new Error('The citation paragraph changed. Place the cursor again.');
  const paragraph = paragraphs[0];
  const fields = [];
  const stack = [];
  let position = 0;
  function visit(node) {
    if (node.nodeType !== 1) return;
    if (node.namespaceURI === W) {
      const name = node.localName;
      if (['pPr', 'rPr', 'del', 'moveFrom', 'delInstrText'].includes(name) || (name === 'p' && node !== paragraph)) return;
      if (name === 'fldSimple') {
        const field = { simple: node, start: position, instruction: node.getAttributeNS(W, 'instr'), text: '', separated: true };
        stack.push(field);
        for (const child of Array.from(node.childNodes)) visit(child);
        stack.pop(); fields.push({ ...field, end: position });
        return;
      }
      if (name === 'fldChar') {
        const kind = node.getAttributeNS(W, 'fldCharType');
        if (kind === 'begin') stack.push({ startRun: node.parentNode, start: position, instruction: '', text: '' });
        else if (kind === 'separate' && stack.length) stack.at(-1).separated = true;
        else if (kind === 'end' && stack.length) fields.push({ ...stack.pop(), endRun: node.parentNode, end: position });
        return;
      }
      if (name === 'instrText') {
        if (stack.length && !stack.at(-1).separated) stack.at(-1).instruction += node.textContent;
        return;
      }
      if (name === 't' || ['tab', 'br', 'cr', 'footnoteReference', 'endnoteReference', 'drawing', 'pict'].includes(name)) {
        const text = name === 't' ? node.textContent : name === 'tab' ? '\t' : ['br', 'cr'].includes(name) ? '\n' : '\ufffc';
        position += text.length;
        for (const field of stack) if (field.separated) field.text += text;
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  }
  visit(paragraph);
  const matches = fields.filter((field) => field.instruction.trim() === instruction.trim()
    && field.start === anchor.start.offset && field.end === anchor.end.offset && field.text === displayText);
  if (matches.length !== 1) throw new Error('The citation changed before deletion. Place the cursor again and retry.');
  const field = matches[0];
  let originals;
  let runs;
  const word = (name) => document.createElementNS(W, `w:${name}`);
  const marker = (kind) => {
    const run = word('r'); const mark = word('fldChar');
    mark.setAttributeNS(W, 'w:fldCharType', kind); run.appendChild(mark);
    return run;
  };
  if (field.simple) {
    originals = [field.simple];
    runs = Array.from(field.simple.childNodes).filter((child) => child.nodeType === 1);
    if (runs.some((run) => run.namespaceURI !== W || run.localName !== 'r')) throw new Error('This citation contains unsupported nested content. No changes were made.');
    const codeRun = word('r'); const code = word('instrText');
    code.textContent = field.instruction; codeRun.appendChild(code);
    runs = [marker('begin'), codeRun, marker('separate'), ...runs.map((run) => run.cloneNode(true)), marker('end')];
  } else {
    const parent = field.startRun?.parentNode;
    if (!parent || parent !== field.endRun?.parentNode) throw new Error('This citation crosses unsupported wrappers. No changes were made.');
    const siblings = Array.from(parent.childNodes);
    const first = siblings.indexOf(field.startRun);
    const last = siblings.indexOf(field.endRun);
    if (first < 0 || last < first) throw new Error('The citation field is invalid.');
    originals = siblings.slice(first, last + 1);
    if (originals.some((node) => node.nodeType === 1 && (node.namespaceURI !== W || node.localName !== 'r'))) throw new Error('This citation contains unsupported nested content. No changes were made.');
    for (const boundary of [field.startRun, field.endRun]) {
      if (Array.from(boundary.childNodes).some((node) => node.nodeType === 1
        && !(node.namespaceURI === W && ['rPr', 'fldChar', 'instrText'].includes(node.localName)))) {
        throw new Error('The citation shares a boundary run with other text. No changes were made.');
      }
    }
    runs = originals.filter((node) => node.nodeType === 1).map((run) => run.cloneNode(true));
  }
  if (changeMode === 'tracked') {
    for (let ancestor = originals[0].parentNode; ancestor && ancestor !== paragraph; ancestor = ancestor.parentNode) {
      if (ancestor.namespaceURI === W && ['ins', 'del', 'moveFrom', 'moveTo'].includes(ancestor.localName)) {
        throw new Error('Tracked citation removal inside another pending revision is not supported. No changes were made.');
      }
    }
    const deletion = word('del');
    const ids = ['ins', 'del', 'moveFrom', 'moveTo'].flatMap((name) => nodes(document, name).map((node) => Number(node.getAttributeNS(W, 'id')) || 0));
    deletion.setAttributeNS(W, 'w:id', String(Math.max(0, ...ids) + 1));
    deletion.setAttributeNS(W, 'w:author', author);
    deletion.setAttributeNS(W, 'w:date', new Date().toISOString());
    for (const run of runs) {
      for (const [from, to] of [['t', 'delText'], ['instrText', 'delInstrText']]) {
        for (const old of nodes(run, from)) {
          const replacement = word(to);
          for (const attribute of Array.from(old.attributes)) replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
          replacement.textContent = old.textContent;
          old.parentNode.replaceChild(replacement, old);
        }
      }
      deletion.appendChild(run);
    }
    originals[0].parentNode.insertBefore(deletion, originals[0]);
  }
  for (const original of originals) original.parentNode.removeChild(original);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { success: true, caret: { blockId: anchor.start.blockId, offset: anchor.start.offset } };
}
