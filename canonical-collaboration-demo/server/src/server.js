import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { createCollaborationAuthorize, signCollaborationToken } from './collaboration/auth/example-token.js';
import { createCollaborationServer } from './collaboration/create-server.js';
import { createDocxAutosave } from './collaboration/docx-autosave.js';
import { documentIdFromRoomName } from './collaboration/room-name.js';
import { createDeletableRoomStore } from './collaboration/storage/deletable-room-store.js';
import { createFileDocxStore } from './collaboration/storage/file-docx-store.js';
import { createFileRoomStore } from './collaboration/storage/file-room-store.js';
import { createMemoryRoomStore } from './collaboration/storage/memory-room-store.js';
import { config } from './config.js';
import { logEvent } from './logging.js';

if (config.collaborationAgent === 'on' && config.collaborationApi === 'off') {
  throw new Error('COLLABORATION_AGENT=on requires COLLABORATION_API=on.');
}
if (config.collaborationAgent === 'on' && !process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required when COLLABORATION_AGENT=on.');
}

const userTokenExpiry = () => Math.floor(Date.now() / 1000) + 300;
// The SDK accepts a fixed credential per open document, not a refresh callback. Service
// credentials are document-scoped, stay inside this process, and must survive reconnects
// for as long as an active room can live. Browser and autosave tokens remain short-lived.
const serviceTokenExpiry = () => 253_402_300_799; // 9999-12-31T23:59:59Z
const createToken = (claims) => config.collaborationAuth.mode === 'none'
  ? 'collaboration-auth-disabled'
  : signCollaborationToken(config.collaborationAuth.secret, claims);
const createUserToken = (documentId, userId) => createToken({
  sub: userId, documents: [documentId], exp: userTokenExpiry(),
});
const createServiceToken = (documentId) => createToken({
  sub: 'document-service', documents: [documentId], exp: serviceTokenExpiry(),
});

const app = Fastify({ logger: false });
await app.register(cors, {
  origin: config.clientOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['Location'],
});
await app.register(websocket);
if (config.collaborationApi === 'on') {
  await app.register(multipart, { limits: { files: 1, fileSize: config.maximumUploadBytes } });
}

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
const documentNames = new Map();
const roomStateStore = createDeletableRoomStore(config.collaborationStorage === 'memory'
  ? createMemoryRoomStore()
  : createFileRoomStore(config.collaborationStorageDirectory));
const docxAutosave = config.collaborationDocx.mode === 'off'
  ? null
  : createDocxAutosave({
      serverUrl: `ws://127.0.0.1:${config.port}/collaboration`,
      docxStore: createFileDocxStore(config.collaborationDocxDirectory),
      idleMs: config.collaborationDocx.idleMs,
      token: () => createToken({ sub: 'docx-autosave', documents: '*', exp: userTokenExpiry() }),
      log: (message) => logEvent('collab', 'docx.autosave', { message }),
    });
const collaborationServer = createCollaborationServer({
  authorize: config.collaborationAuth.mode === 'none'
    ? null
    : createCollaborationAuthorize(config.collaborationAuth.secret),
  roomStore: roomStateStore,
  docxAutosave,
  hooks: {
    async onConnect({ documentName }) {
      const documentId = documentIdFromRoomName(documentName);
      if (documentId) documentNames.set(documentId, documentName);
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
    const documentId = documentIdFromRoomName(documentName);
    if (documentId) rooms?.updateLastActivityAt(documentId);
    const timestamp = Date.now();
    if (timestamp - (lastChangeLog.get(documentName) ?? 0) >= 1_000) {
      lastChangeLog.set(documentName, timestamp);
      logEvent('collab', 'document.changed', { documentName });
    }
    },
  },
});
const collaboration = {
  server: collaborationServer,
  async prepareDelete(documentId) {
    await docxAutosave?.delete(documentId);
  },
  async unload(documentId, { deleteState = false } = {}) {
    const documentName = [...collaborationServer.documents.keys()].find(
      (candidate) => documentIdFromRoomName(candidate) === documentId,
    ) ?? documentNames.get(documentId);
    if (documentName) {
      lastChangeLog.delete(documentName);
      collaborationServer.closeConnections(documentName);
      const document = collaborationServer.documents.get(documentName);
      if (document) await collaborationServer.unloadDocument(document);
    }
    if (deleteState) {
      if (documentName) await roomStateStore.delete(documentName);
      documentNames.delete(documentId);
    }
  },
  async close() {
    collaborationServer.closeConnections();
    for (const document of [...collaborationServer.documents.values()]) {
      await collaborationServer.unloadDocument(document);
    }
  },
};
let documents;
let jobService;
let registerRoomRoutes;
if (config.collaborationApi === 'on') {
  const [{ DocumentService }, { RoomStore }, routes] = await Promise.all([
    import('./document-service.js'),
    import('./rooms/store.js'),
    import('./rooms/routes.js'),
  ]);
  registerRoomRoutes = routes.registerRoomRoutes;
  documents = new DocumentService();
  await documents.initialize();
  rooms = new RoomStore(collaboration, documents, { createServiceToken });
  await rooms.initialize();
  if (config.collaborationAgent === 'on') {
    const [{ createDocumentAgent }, { JobService }] = await Promise.all([
      import('./agent.js'),
      import('./job-service.js'),
    ]);
    const agent = createDocumentAgent(documents);
    jobService = new JobService(rooms, agent);
  }
}

async function getHealth() {
  return {
    status: 'ok',
    components: {
      api: config.collaborationApi,
      client: config.collaborationClient,
      agent: config.collaborationAgent,
      auth: config.collaborationAuth.mode,
      storage: config.collaborationStorage,
      docx: config.collaborationDocx.mode,
    },
  };
}

app.route({ url: '/api/health', method: 'GET', handler: getHealth });
if (config.collaborationApi === 'on') {
  registerRoomRoutes(app, {
    rooms,
    jobService,
    createCollaborationToken: createUserToken,
  });
}

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

const cleanup = config.collaborationApi === 'off' ? null : setInterval(async () => {
  const expiredRooms = await rooms.expire();
  const expiredJobs = jobService?.expire() ?? [];
  logEvent('rooms', 'cleanup.completed', { expiredRooms });
  if (jobService) logEvent('worker', 'cleanup.completed', { expiredJobs });
}, 60_000);
cleanup?.unref();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (cleanup) clearInterval(cleanup);
  jobService?.stop();
  await docxAutosave?.stop();
  await rooms?.closeAll();
  await documents?.close();
  await collaboration.close();
  await app.close();
  logEvent('api', 'service.stopped');
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
