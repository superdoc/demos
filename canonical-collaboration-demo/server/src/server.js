import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { Hocuspocus } from '@hocuspocus/server';
import { createDocumentAgent } from './agent.js';
import { config } from './config.js';
import { DocumentService } from './document-service.js';
import { JobService } from './job-service.js';
import { logEvent } from './logging.js';
import { registerRoomRoutes } from './rooms/routes.js';
import { RoomStore } from './rooms/store.js';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required.');

const app = Fastify({ logger: false });
await app.register(cors, {
  origin: config.clientOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['Location'],
});
await app.register(websocket);
await app.register(multipart, { limits: { files: 1, fileSize: config.maximumUploadBytes } });

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

let rooms;
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
    rooms?.updateLastActivityAt(canonicalDocumentId(documentName));
    const timestamp = Date.now();
    if (timestamp - (lastChangeLog.get(documentName) ?? 0) >= 1_000) {
      lastChangeLog.set(documentName, timestamp);
      logEvent('collab', 'document.changed', { documentName });
    }
  },
});
const collaboration = {
  server: collaborationServer,
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
const documents = new DocumentService();
await documents.initialize();
rooms = new RoomStore(collaboration, documents);
const agent = createDocumentAgent(documents);
const jobService = new JobService(rooms, agent);
await rooms.initialize();

async function getHealth() {
  return { status: 'ok' };
}

app.route({ url: '/api/health', method: 'GET', handler: getHealth });
registerRoomRoutes(app, { rooms, jobService });

function connectCollaboration(socket, request) {
  const originalUrl = request.raw.url;
  request.raw.url = originalUrl?.replace(/^\/collaboration/, '') || '/';
  collaborationServer.handleConnection(socket, request.raw);
  request.raw.url = originalUrl;
}

const collaborationRoutes = [
  { url: '/collaboration', method: 'GET', handler: connectCollaboration, websocket: true },
  { url: '/collaboration/*', method: 'GET', handler: connectCollaboration, websocket: true },
];
for (const route of collaborationRoutes) app.route(route);

await app.listen({ host: '0.0.0.0', port: config.port });
logEvent('api', 'service.ready', { port: config.port });

const cleanup = setInterval(async () => {
  const expiredRooms = await rooms.expire();
  const expiredJobs = jobService.expire();
  logEvent('rooms', 'cleanup.completed', { expiredRooms });
  logEvent('worker', 'cleanup.completed', { expiredJobs });
}, 60_000);
cleanup.unref();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  jobService.stop();
  await rooms.closeAll();
  await documents.close();
  await collaboration.close();
  await app.close();
  logEvent('api', 'service.stopped');
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
