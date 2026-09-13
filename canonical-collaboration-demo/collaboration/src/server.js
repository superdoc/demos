import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { Hocuspocus } from '@hocuspocus/server';
import Fastify from 'fastify';

const port = Number(process.env.PORT ?? 8081);

const collaboration = new Hocuspocus({
  quiet: false,
  async onConnect({ documentName }) {
    app.log.info({ event: 'collaboration.connected', documentName });
  },
  async onDisconnect({ documentName }) {
    app.log.info({ event: 'collaboration.disconnected', documentName });
  },
});

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(websocket);

app.get('/health', async () => ({
  status: 'ok',
  documents: collaboration.getDocumentsCount(),
  connections: collaboration.getConnectionsCount(),
}));

app.get('/*', { websocket: true }, (socket, request) => {
  collaboration.handleConnection(socket, request.raw);
});

await app.listen({ host: '0.0.0.0', port });
app.log.info({ event: 'collaboration.ready', port });

const stop = async () => {
  await app.close();
  for (const document of [...collaboration.documents.values()]) {
    await collaboration.unloadDocument(document);
  }
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
