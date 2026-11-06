import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer } from 'ws';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import { intervalRecords, validateCheckpoint, validateRecords } from './change-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const validId = /^[a-zA-Z0-9_-]{1,80}$/;
const uuid = /^[a-f0-9-]{36}$/i;

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

async function body(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createBackend({ dataDirectory = path.join(root, 'server/data') } = {}) {
  const rooms = new Map();
  const sessions = new Map();
  const roomWrites = new Map();
  const previews = new Map();

  function enqueue(id, task) {
    const next = (roomWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(task);
    roomWrites.set(id, next);
    return next;
  }

  function roomFor(id) {
    if (!validId.test(id)) throw Object.assign(new Error('Invalid room ID'), { status: 400 });
    if (!rooms.has(id)) rooms.set(id, (async () => {
      const directory = path.join(dataDirectory, id);
      await mkdir(directory, { recursive: true });
      const metadata = await readJson(path.join(directory, 'room.json'), { ready: false });
      const versions = await readJson(path.join(directory, 'versions.json'), []);
      const records = await readJson(path.join(directory, 'changes.json'), []);
      return { id, directory, documentId: `version-history-${id}`, ready: metadata.ready,
        initializer: null, versions, records };
    })());
    return rooms.get(id);
  }

  function roomIdFromDocument(name) {
    const match = /^sd2\/v[^/]+\/version-history-([a-zA-Z0-9_-]{1,80})$/.exec(name);
    if (!match) throw new Error('Unknown collaboration document');
    return match[1];
  }

  const collaboration = new Hocuspocus({
    quiet: true,
    debounce: 500,
    maxDebounce: 2000,
    async onAuthenticate({ token, documentName }) {
      const id = roomIdFromDocument(documentName);
      const session = sessions.get(token);
      const room = await roomFor(id);
      if (!session || session.roomId !== id || (!room.ready && session.clientId !== room.initializer)) {
        throw new Error('Access denied');
      }
      return { userId: session.user.id };
    },
    async onLoadDocument({ documentName, document }) {
      const room = await roomFor(roomIdFromDocument(documentName));
      try { applyUpdate(document, await readFile(path.join(room.directory, 'room.yjs'))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return document;
    },
    async onStoreDocument({ documentName, document }) {
      const room = await roomFor(roomIdFromDocument(documentName));
      const bytes = encodeStateAsUpdate(document);
      await enqueue(room.id, () => atomicWrite(path.join(room.directory, 'room.yjs'), bytes));
    },
  });

  const server = createServer(async (request, response) => {
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/health') return json(200, { ok: true });
      const route = /^\/api\/rooms\/([^/]+)\/(session|ready|changes|versions)(?:\/([^/]+)\/(file|changes))?$/.exec(url.pathname);
      if (!route) {
        if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found' });
        const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.resolve(root, 'dist', name);
        if (!file.startsWith(path.join(root, 'dist') + path.sep)) return json(404, { error: 'Not found' });
        const content = await readFile(file);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.docx': docxType, '.png': 'image/png' };
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
        return response.end(content);
      }
      const [, id, action, versionId, resource] = route;
      const room = await roomFor(id);
      if (action === 'session' && request.method === 'POST') {
        let input;
        try { input = JSON.parse(await body(request, 4096)); }
        catch { return json(400, { error: 'Invalid session request' }); }
        if (!uuid.test(input.clientId ?? '') || typeof input.name !== 'string' || !input.name.trim()) {
          return json(400, { error: 'A client ID and display name are required' });
        }
        // Reserve exactly one initializer. Other browsers wait for its native
        // collaboration-ready signal; they never race to create the same room.
        if (!room.ready && room.initializer && room.initializer !== input.clientId) {
          return json(202, { status: 'initializing' });
        }
        if (!room.ready) room.initializer = input.clientId;
        const token = randomUUID();
        const user = { id: input.clientId, name: input.name.trim().slice(0, 80), email: `${input.clientId}@demo.local` };
        const session = { token, roomId: id, clientId: input.clientId, user };
        sessions.set(token, session);
        return json(200, { roomId: id, documentId: room.documentId, token, user,
          mode: room.ready ? 'join' : 'create' });
      }
      const token = request.headers.authorization?.replace(/^Bearer /, '');
      const session = sessions.get(token);
      if (!session || session.roomId !== id) return json(401, { error: 'Invalid room session' });
      if (action === 'ready' && request.method === 'POST') {
        if (!room.ready) {
          if (room.initializer !== session.clientId) return json(403, { error: 'Not the room initializer' });
          const document = [...collaboration.documents.entries()]
            .find(([name]) => roomIdFromDocument(name) === id)?.[1];
          if (!document || document.getMap('content').size === 0) return json(409, { error: 'Room is not initialized' });
          const bytes = encodeStateAsUpdate(document);
          await enqueue(id, async () => {
            await atomicWrite(path.join(room.directory, 'room.yjs'), bytes);
            await atomicWrite(path.join(room.directory, 'room.json'), JSON.stringify({ ready: true }));
            room.ready = true;
          });
        }
        return json(200, { ready: true });
      }
      if (action === 'changes' && request.method === 'POST') {
        if (!room.ready) return json(409, { error: 'Wait for collaboration to connect before recording changes' });
        const items = validateRecords(JSON.parse(await body(request, 16 * 1024 * 1024)));
        await enqueue(id, async () => {
          const known = new Map(room.records.map((record) => [record.id, record]));
          for (const record of items) {
            const existing = known.get(record.id);
            if (existing && existing.update !== record.update) throw Object.assign(new Error('Change ID conflict'), { status: 409 });
            // Prefer the writing client's attribution over a remote observation.
            if (!existing || (record.provenance === 'authored' && existing.provenance !== 'authored')) known.set(record.id, record);
          }
          const records = [...known.values()];
          await atomicWrite(path.join(room.directory, 'changes.json'), JSON.stringify(records));
          room.records = records;
        });
        return json(200, { stored: items.length });
      }
      if (action === 'versions' && !versionId && request.method === 'GET') return json(200, room.versions);
      if (action === 'versions' && !versionId && request.method === 'POST') {
        if (!room.ready) return json(409, { error: 'Wait for collaboration to connect before saving' });
        const idempotencyId = request.headers['x-version-id'];
        if (!uuid.test(idempotencyId ?? '')) return json(400, { error: 'A version ID is required' });
        let bytes = await body(request, 64 * 1024 * 1024);
        let checkpoint = null;
        let state = null;
        if (request.headers['content-type']?.startsWith('multipart/form-data')) {
          const form = await new Request('http://localhost/version', {
            method: 'POST', headers: { 'Content-Type': request.headers['content-type'] }, body: bytes,
          }).formData();
          const document = form.get('document');
          if (!document || typeof document === 'string') return json(400, { error: 'Expected a DOCX document' });
          checkpoint = JSON.parse(String(form.get('checkpoint')));
          state = validateCheckpoint(checkpoint);
          bytes = Buffer.from(await document.arrayBuffer());
        }
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json(400, { error: 'Expected a DOCX file' });
        const version = await enqueue(id, async () => {
          const existing = room.versions.find((item) => item.id === idempotencyId);
          if (existing) {
            if (existing.createdBy.id !== session.user.id) throw Object.assign(new Error('Version ID conflict'), { status: 409 });
            return existing;
          }
          if (checkpoint && checkpoint.baseVersionId !== (room.versions[0]?.id ?? null)) {
            throw Object.assign(new Error('Another user saved a version. Refresh the version list and save again.'), { status: 409 });
          }
          const records = checkpoint ? intervalRecords(room.records, checkpoint, room.versions[0]) : [];
          const entry = { id: idempotencyId, number: (room.versions[0]?.number ?? 0) + 1,
            createdAt: new Date().toISOString(), createdBy: session.user, bytes: bytes.length,
            ...(checkpoint ? { revision: checkpoint.revision, cursor: checkpoint.cursor, stateVector: checkpoint.stateVector, changeCount: records.length } : {}) };
          const versions = [entry, ...room.versions];
          await atomicWrite(path.join(room.directory, `${entry.id}.docx`), bytes);
          if (checkpoint) {
            await atomicWrite(path.join(room.directory, `${entry.id}.yjs`), state);
            await atomicWrite(path.join(room.directory, `${entry.id}.changes.json`), JSON.stringify(records));
          }
          await atomicWrite(path.join(room.directory, 'versions.json'), JSON.stringify(versions));
          room.versions = versions;
          return entry;
        });
        return json(201, version);
      }
      if (action === 'versions' && versionId && request.method === 'GET') {
        if (!room.versions.some((item) => item.id === versionId)) return json(404, { error: 'Version not found' });
        if (resource === 'changes') {
          return json(200, await readJson(path.join(room.directory, `${versionId}.changes.json`), []));
        }
        const bytes = await readFile(path.join(room.directory, `${versionId}.docx`));
        response.writeHead(200, { 'Content-Type': docxType, 'Cache-Control': 'private, max-age=31536000, immutable' });
        return response.end(bytes);
      }
      return json(405, { error: 'Method not allowed' });
    } catch (error) {
      if (!response.headersSent) json(error.status ?? (error instanceof SyntaxError || error instanceof RangeError ? 400 : error.code === 'ENOENT' ? 404 : 500), {
        error: error.status ? error.message : error instanceof SyntaxError || error instanceof RangeError ? 'Invalid request data' : 'Request could not be completed',
      });
    }
  });
  function previewServer(roomId, versionId) {
    // Native shard IDs include the document identity. Keep that identity while
    // isolating each immutable checkpoint in its own read-only server instance.
    const key = `${roomId}:${versionId}`;
    if (!previews.has(key)) previews.set(key, new Hocuspocus({
      quiet: true,
      async onAuthenticate({ token, documentName, connection }) {
        const session = sessions.get(token);
        const room = await roomFor(roomId);
        if (!session || session.roomId !== roomId || roomIdFromDocument(documentName) !== roomId
          || !room.versions.some((version) => version.id === versionId && version.stateVector)) throw new Error('Access denied');
        connection.readOnly = true;
        return { userId: session.user.id };
      },
      async onLoadDocument({ document }) {
        const room = await roomFor(roomId);
        applyUpdate(document, await readFile(path.join(room.directory, `${versionId}.yjs`)));
        return document;
      },
    }));
    return previews.get(key);
  }
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/collaboration')) return socket.destroy();
    const url = new URL(request.url, 'http://localhost');
    const snapshot = url.searchParams.get('snapshot');
    const room = url.searchParams.get('room');
    if (snapshot && (!uuid.test(snapshot) || !validId.test(room ?? ''))) return socket.destroy();
    const provider = snapshot ? previewServer(room, snapshot) : collaboration;
    websocket.handleUpgrade(request, socket, head, (connection) => provider.handleConnection(connection, request));
  });

  return {
    server,
    collaboration,
    async close() {
      await collaboration.destroy();
      await Promise.all([...previews.values()].map((preview) => preview.destroy()));
      await Promise.allSettled(roomWrites.values());
      websocket.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const dataDirectory = process.env.DATA_DIRECTORY || mountPath;
  if (process.env.RAILWAY_ENVIRONMENT_ID && (!mountPath || !dataDirectory
    || (path.resolve(dataDirectory) !== path.resolve(mountPath) && !path.resolve(dataDirectory).startsWith(path.resolve(mountPath) + path.sep)))) {
    throw new Error('Attach a persistent volume and set DATA_DIRECTORY inside it before deploying version history to Railway');
  }
  const backend = createBackend({ dataDirectory });
  const port = Number(process.env.PORT ?? 4191);
  backend.server.listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Version history backend: http://127.0.0.1:${port}`));
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await backend.close(); process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
