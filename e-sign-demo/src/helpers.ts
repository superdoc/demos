import { config } from './config';
import type { DocumentInput } from './types';

export function fileType(buffer: Buffer): 'pdf' | 'docx' | null {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'docx';
  return null;
}

function decodeBase64(value: string | undefined): Buffer {
  if (typeof value !== 'string' || value.length < 16) throw new Error('document.base64 is required');

  const buffer = Buffer.from(value.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length || buffer.length > config.maxFileSize) {
    throw new Error('Document is empty or exceeds the size limit');
  }
  return buffer;
}

async function fetchDocument(url: string | undefined): Promise<Buffer> {
  if (!url) throw new Error('document.url is required');
  const response = await fetch(url, { signal: AbortSignal.timeout(config.requestTimeout) });
  if (!response.ok) throw new Error(`Document URL returned HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > config.maxFileSize) throw new Error('Document exceeds the size limit');
  return buffer;
}

export async function loadDocument(document: DocumentInput): Promise<Buffer> {
  return document.base64 ? decodeBase64(document.base64) : fetchDocument(document.url);
}
