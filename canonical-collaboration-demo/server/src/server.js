import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { Hocuspocus } from '@hocuspocus/server';
import { DocumentAgent } from './agent.js';
import { config } from './config.js';
import { logEvent } from './logging.js';
import { DocumentWorkerClient } from './document-worker-client.js';
import { JobService } from './jobs.js';
import { RoomStore } from './rooms.js';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required.');

class RoomEvents {
  #subscribers = new Map();

  subscribe(roomId, socket) {
    const subscribers = this.#subscribers.get(roomId) ?? new Set();
    subscribers.add(socket);
    this.#subscribers.set(roomId, subscribers);
    socket.once('close', () => {
      subscribers.delete(socket);
      if (subscribers.size === 0) this.#subscribers.delete(roomId);
    });
  }

  publish(roomId, document) {
    const message = JSON.stringify({ type: 'room.updated', document });
    for (const socket of this.#subscribers.get(roomId) ?? []) {
      if (socket.readyState === 1) socket.send(message);
    }
  }
}

let onCollaborationActivity = () => {};
const lastChangeLog = new Map();
const canonicalDocumentId = (documentName) => documentName.split('/').at(-1);
const collaborationServer = new Hocuspocus({
  quiet: true,
  async onConnect({ documentName }) {
    logEvent('collab', 'connection.opened', {
      documentName,
      documents: collaborationServer.getDocumentsCount(),
      connections: collaborationServer.getConnectionsCount(),
    });
  },
  async onDisconnect({ documentName }) {
    logEvent('collab', 'connection.closed', {
      documentName,
      documents: collaborationServer.getDocumentsCount(),
      connections: collaborationServer.getConnectionsCount(),
    });
  },
  async onChange({ documentName }) {
    onCollaborationActivity(canonicalDocumentId(documentName));
    const timestamp = Date.now();
    if (timestamp - (lastChangeLog.get(documentName) ?? 0) >= 1_000) {
      lastChangeLog.set(documentName, timestamp);
      logEvent('collab', 'document.changed', { documentName });
    }
  },
});
const collaboration = {
  server: collaborationServer,
  handleConnection(socket, request) {
    const originalUrl = request.url;
    request.url = originalUrl?.replace(/^\/collaboration/, '') || '/';
    collaborationServer.handleConnection(socket, request);
    request.url = originalUrl;
  },
  async unload(documentId) {
    const documentName = [...collaborationServer.documents.keys()].find(
      (candidate) => canonicalDocumentId(candidate) === documentId,
    );
    if (!documentName) return;
    lastChangeLog.delete(documentName);
    collaborationServer.closeConnections(documentName);
    const document = collaborationServer.documents.get(documentName);
    if (document) await collaborationServer.unloadDocument(document);
  },
  async close() {
    collaborationServer.closeConnections();
    for (const document of [...collaborationServer.documents.values()]) {
      await collaborationServer.unloadDocument(document);
    }
  },
};

const app = Fastify({ logger: false });
await app.register(cors, {
  origin: ['http://localhost:15173', 'http://127.0.0.1:15173'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['Location'],
});
await app.register(websocket);
await app.register(multipart, { limits: { files: 1, fileSize: config.maximumUploadBytes } });

const roomEvents = new RoomEvents();
const documentWorker = new DocumentWorkerClient();
await documentWorker.start();
const rooms = new RoomStore(collaboration, roomEvents, documentWorker);
const agent = new DocumentAgent(documentWorker);
const jobs = new JobService(rooms, agent);
await rooms.initialize();
await agent.initialize();
onCollaborationActivity = (documentId) => rooms.updateLastActivityAt(documentId);

app.decorate('httpErrors', {
  badRequest(message) {
    const error = new Error(message);
    error.name = 'HttpError';
    error.statusCode = 400;
    return error;
  },
});

app.addHook('onResponse', async (request, reply) => {
  logEvent('api', 'request.completed', { method: request.method, path: request.url, status: reply.statusCode });
});
app.addHook('onError', async (request, _reply, error) => {
  logEvent('api', 'request.failed', { method: request.method, path: request.url, error: error.name });
});
app.setErrorHandler((error, _request, reply) => {
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(statusCode).send({ detail: statusCode === 500 ? 'Internal server error.' : error.message });
  if (statusCode === 500) console.error(error);
});

app.get('/api/health', async () => ({ status: 'ok' }));

app.get('/api/rooms/:roomId', async (request) => {
  const room = rooms.find(request.params.roomId);
  return { room_id: request.params.roomId, document: room ? rooms.response(room) : null };
});

app.get('/api/rooms/:roomId/events', {
  websocket: true,
  preValidation(request, _reply, done) {
    try {
      rooms.validateId(request.params.roomId);
      done();
    } catch (error) {
      done(error);
    }
  },
}, (socket, request) => {
  const { roomId } = request.params;
  roomEvents.subscribe(roomId, socket);
  const room = rooms.find(roomId, false);
  socket.send(JSON.stringify({ type: 'room.updated', document: room ? rooms.response(room) : null }));
});

app.put('/api/rooms/:roomId/document', async (request, reply) => {
  const upload = await request.file({ limits: { fileSize: config.maximumUploadBytes } });
  if (!upload) throw app.httpErrors.badRequest('Upload a .docx document.');
  const room = await rooms.replaceUpload(request.params.roomId, upload.filename, await upload.toBuffer());
  return reply.send(rooms.response(room));
});

app.post('/api/rooms/:roomId/document', async (request, reply) => {
  const room = await rooms.createBlank(request.params.roomId);
  return reply.code(201).send(rooms.response(room));
});

app.get('/api/rooms/:roomId/document/info', async (request) => rooms.response(rooms.require(request.params.roomId)));

app.get('/api/rooms/:roomId/document', async (request, reply) => {
  const { room, content } = await rooms.export(request.params.roomId);
  const filename = room.filename.replace(/["\r\n]/g, '_');
  return reply
    .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(content);
});

app.patch('/api/rooms/:roomId/document', async (request) => {
  const room = rooms.require(request.params.roomId);
  const { tool, arguments: args = {} } = request.body ?? {};
  if (typeof tool !== 'string' || !tool) throw app.httpErrors.badRequest('tool is required.');
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw app.httpErrors.badRequest('arguments must be an object.');
  }
  const result = await agent.dispatch(room.documentId, tool, args);
  room.updateLastActivityAt();
  return { ok: true, result };
});

app.delete('/api/rooms/:roomId/document', async (request, reply) => {
  await rooms.delete(request.params.roomId);
  return reply.code(204).send();
});

app.post('/api/rooms/:roomId/activity', async (request, reply) => {
  rooms.heartbeat(request.params.roomId, request.body?.generation);
  return reply.code(204).send();
});

app.get('/api/rooms/:roomId/chat', async (request) => ({
  messages: rooms.require(request.params.roomId).conversation,
}));

app.post('/api/rooms/:roomId/jobs', async (request, reply) => {
  const record = jobs.create(request.params.roomId, request.body);
  return reply
    .code(202)
    .header('Location', `/api/rooms/${encodeURIComponent(request.params.roomId)}/jobs/${record.id}`)
    .send(record);
});

app.get('/api/rooms/:roomId/jobs/:jobId', async (request) => jobs.get(request.params.roomId, request.params.jobId));
app.delete('/api/rooms/:roomId/jobs/:jobId', async (request) => jobs.cancel(request.params.roomId, request.params.jobId));

app.get('/collaboration', { websocket: true }, (socket, request) => collaboration.handleConnection(socket, request.raw));
app.get('/collaboration/*', { websocket: true }, (socket, request) => collaboration.handleConnection(socket, request.raw));

await app.listen({ host: '0.0.0.0', port: config.port });
logEvent('api', 'service.ready', { port: config.port });

const cleanup = setInterval(async () => {
  const expiredRooms = await rooms.expire();
  const expiredJobs = jobs.expire();
  logEvent('rooms', 'cleanup.completed', { expiredRooms });
  logEvent('worker', 'cleanup.completed', { expiredJobs });
}, 60_000);
cleanup.unref();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  jobs.stop();
  await rooms.closeAll();
  await documentWorker.stop();
  await collaboration.close();
  await app.close();
  logEvent('api', 'service.stopped');
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
