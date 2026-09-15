import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { DocumentAgent } from './agent.js';
import { createCollaboration } from './collaboration.js';
import { config } from './config.js';
import { logEvent } from './diagnostics.js';
import { DocumentWorkerClient } from './document-worker-client.js';
import { HttpError } from './http-error.js';
import { JobService } from './jobs.js';
import { registerRoutes } from './routes.js';
import { RoomEvents } from './room-events.js';
import { RoomStore } from './rooms.js';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required.');

const app = Fastify({ logger: false });
await app.register(cors, {
  origin: ['http://localhost:15173', 'http://127.0.0.1:15173'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['Location'],
});
await app.register(websocket);
await app.register(multipart, { limits: { files: 1, fileSize: config.maximumUploadBytes } });

const collaboration = createCollaboration();
const roomEvents = new RoomEvents();
const documentWorker = new DocumentWorkerClient();
await documentWorker.start();
const rooms = new RoomStore(collaboration, roomEvents, documentWorker);
const agent = new DocumentAgent(documentWorker);
const jobs = new JobService(rooms, agent);
await rooms.initialize();
await agent.initialize();
collaboration.setActivityHandler((documentId) => rooms.touchDocument(documentId));

app.decorate('httpErrors', {
  badRequest(message) {
    return new HttpError(400, message);
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

await registerRoutes(app, { rooms, jobs, agent, roomEvents });
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
