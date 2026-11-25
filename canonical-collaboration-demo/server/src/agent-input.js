import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

const maximumBytes = 5 * 1024 * 1024;
const maximumText = 150_000;
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const strictWordNamespace = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

export const jobBodyLimit = Math.ceil(maximumBytes / 3) * 4 + 500_000;

function badInput(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function readDocumentContext(input, document) {
  if (input.documentTarget === undefined) return undefined;
  const { id, generation, cursor, selection } = input.documentTarget ?? {};
  if (id !== document.id || generation !== document.generation) {
    throw badInput('The document has changed. Try submitting your prompt again.');
  }
  if (cursor !== undefined && (typeof cursor?.blockId !== 'string' || !cursor.blockId || cursor.blockId.length > 200
      || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || typeof cursor.paragraph !== 'string'
      || cursor.paragraph.length > 100_000)) {
    throw badInput('Invalid document cursor.');
  }
  if (selection !== undefined && (typeof selection?.blockId !== 'string' || !selection.blockId || selection.blockId.length > 200
      || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end)
      || selection.start < 0 || selection.end <= selection.start || cursor !== undefined)) {
    throw badInput('Invalid document selection.');
  }
  return { id, generation, cursor, selection };
}

function imageThumbnail(value) {
  if (typeof value !== 'string' || value.length > 65_536) return;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return;
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) && bytes.toString('base64') === match[1]) return value;
}

export function readAttachment(input) {
  if (input === undefined) return undefined;
  const { name, kind, base64 } = input ?? {};
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\r\n]/.test(name)
      || typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(maximumBytes / 3) * 4) {
    throw badInput('Choose a supported attachment up to 5 MB.');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > maximumBytes || bytes.toString('base64') !== base64) throw badInput('Invalid attachment data.');
  if (kind === 'image') {
    const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
    if (!png && !jpeg) throw badInput('Choose a PNG or JPEG image.');
    return { name, kind, src: `data:image/${png ? 'png' : 'jpeg'};base64,${base64}`, thumbnail: imageThumbnail(input.thumbnail) };
  }
  const extension = /\.([^.]+)$/.exec(name)?.[1].toLowerCase();
  if (kind !== 'file' || !['docx', 'txt', 'md', 'markdown'].includes(extension)) {
    throw badInput('Choose a DOCX, TXT, or Markdown file.');
  }
  return { name, kind, extension, bytes };
}

async function docxText(bytes) {
  const entry = (await JSZip.loadAsync(bytes)).file('word/document.xml');
  if (!entry) throw new Error('The attachment has no Word document body.');
  const xml = await new Promise((resolve, reject) => {
    const stream = entry.internalStream('nodebuffer');
    const chunks = [];
    let total = 0;
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > maximumBytes) {
        stream.pause();
        reject(new Error('The Word document body exceeds 5 MB.'));
      } else {
        chunks.push(chunk);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.resume();
  });
  if (/<!DOCTYPE/i.test(xml)) throw new Error('The Word attachment contains an unsupported document type declaration.');
  const parsed = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(xml, 'application/xml');
  const namespace = parsed.documentElement.namespaceURI;
  const body = [wordNamespace, strictWordNamespace].includes(namespace)
    && parsed.getElementsByTagNameNS(namespace, 'body').item(0);
  if (!body) throw new Error('The attachment has no Word document body.');
  const paragraphs = [];

  function visit(node) {
    if (node.nodeType !== 1) return;
    if (node.namespaceURI === namespace) {
      if (['del', 'moveFrom', 'txbxContent', 'sdtPr'].includes(node.localName)) return;
      if (node.localName === 'p') {
        paragraphs.push([]);
      } else if (paragraphs.length) {
        if (node.localName === 't') paragraphs.at(-1).push(node.textContent);
        if (node.localName === 'tab') paragraphs.at(-1).push('\t');
        if (['br', 'cr'].includes(node.localName)) paragraphs.at(-1).push('\n');
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  }

  visit(body);
  return paragraphs.map((parts) => parts.join('')).join('\n');
}

export async function extractAttachmentText(attachment) {
  let text;
  try {
    text = attachment.extension === 'docx'
      ? await docxText(attachment.bytes)
      : new TextDecoder('utf-8', { fatal: true }).decode(attachment.bytes);
  } catch {
    throw new Error('Could not read the attachment. Choose a valid DOCX or a UTF-8 text or Markdown file.');
  }
  if (!text.trim()) throw new Error('The attachment has no readable text.');
  if (text.length > maximumText) throw new Error('The attachment exceeds the 150,000-character text limit.');
  return text;
}
