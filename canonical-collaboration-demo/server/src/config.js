import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maximumUploadMegabytes = 25;

export const config = Object.freeze({
  port: Number(process.env.PORT ?? 8000),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'http://localhost:8000',
  documentRoot: path.resolve(process.env.DOCUMENT_ROOT ?? path.join(serverRoot, '..', 'data')),
  blankDocumentPath: path.join(serverRoot, 'assets', 'blank.docx'),
  roomTtlMs: Number(process.env.ROOM_TTL_SECONDS ?? 3600) * 1000,
  completedJobTtlMs: Number(process.env.COMPLETED_JOB_TTL_SECONDS ?? 600) * 1000,
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
  maximumUploadMegabytes,
  maximumUploadBytes: maximumUploadMegabytes * 1024 * 1024,
});
