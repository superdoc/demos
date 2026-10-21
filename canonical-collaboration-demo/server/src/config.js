import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maximumUploadMegabytes = 25;
const defaultClientOrigins = [
  'http://localhost:15173',
  'http://127.0.0.1:15173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://demos.superdoc.dev',
];

export const config = Object.freeze({
  port: Number(process.env.PORT ?? 8000),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'http://localhost:8000',
  documentRoot: path.resolve(process.env.DOCUMENT_ROOT ?? path.join(serverRoot, '..', 'data')),
  collaborationStorageDirectory: path.resolve(
    process.env.COLLABORATION_STORAGE_DIR ?? path.join(serverRoot, '..', 'data', 'collaboration-rooms'),
  ),
  collaborationDocxDirectory: path.resolve(
    process.env.COLLABORATION_DOCX_DIR ?? path.join(serverRoot, '..', 'data', 'collaboration-docx'),
  ),
  collaborationApi: componentMode('COLLABORATION_API', process.env.COLLABORATION_API),
  collaborationClient: componentMode('COLLABORATION_CLIENT', process.env.COLLABORATION_CLIENT),
  collaborationAgent: componentMode('COLLABORATION_AGENT', process.env.COLLABORATION_AGENT),
  collaborationAuth: authMode(process.env),
  collaborationStorage: storageMode(process.env.COLLABORATION_STORAGE),
  collaborationDocx: docxMode(process.env),
  blankDocumentPath: path.join(serverRoot, 'assets', 'blank.docx'),
  defaultDocumentPath: path.resolve(process.env.DEFAULT_DOCUMENT_PATH || path.join(serverRoot, 'assets', 'contract.docx')),
  roomTtlMs: Number(process.env.ROOM_TTL_SECONDS ?? 3600) * 1000,
  completedJobTtlMs: Number(process.env.COMPLETED_JOB_TTL_SECONDS ?? 600) * 1000,
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
  clientOrigins: (process.env.CLIENT_ORIGINS ?? defaultClientOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  maximumUploadMegabytes,
  maximumUploadBytes: maximumUploadMegabytes * 1024 * 1024,
});

export function componentMode(name, value) {
  const mode = value ?? 'on';
  if (mode !== 'on' && mode !== 'off') throw new Error(`${name} must be "on" or "off". Received "${mode}".`);
  return mode;
}

export function authMode(env) {
  const mode = env.COLLABORATION_AUTH ?? 'example-token';
  if (mode === 'none') return { mode };
  if (mode !== 'example-token') {
    throw new Error(`COLLABORATION_AUTH must be "example-token" or "none". Received "${mode}".`);
  }
  const secret = env.COLLABORATION_AUTH_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error(
      'Set COLLABORATION_AUTH_SECRET to a random value of at least 32 characters, ' +
      'or set COLLABORATION_AUTH=none to run without access checks on a private network.',
    );
  }
  return { mode, secret };
}

export function storageMode(value) {
  const mode = value ?? 'file';
  if (mode !== 'file' && mode !== 'memory') {
    throw new Error(`COLLABORATION_STORAGE must be "file" or "memory". Received "${mode}".`);
  }
  return mode;
}

export function docxMode(env) {
  const mode = env.COLLABORATION_DOCX ?? 'autosave';
  if (mode === 'off') return { mode };
  if (mode !== 'autosave') {
    throw new Error(`COLLABORATION_DOCX must be "autosave" or "off". Received "${mode}".`);
  }
  const idleMs = Number(env.COLLABORATION_DOCX_IDLE_MS ?? 10_000);
  if (!Number.isInteger(idleMs) || idleMs < 0) {
    throw new Error('COLLABORATION_DOCX_IDLE_MS must be a non-negative whole number.');
  }
  return { mode, idleMs };
}
