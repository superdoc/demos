import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config';
import { handleSignRequest } from './route-handlers/sign';
import { handleGetPublicKeyRequest, handleVerifyRequest } from './route-handlers/verify';

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (!config.apiKey || request.url === '/health' || request.url.startsWith('/v1/verify')) return;

  if (request.headers.authorization !== `Bearer ${config.apiKey}`) {
    return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid or missing bearer token' });
  }
}

export function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: Math.ceil(config.maxFileSize * 1.4),
  });

  app.register(fastifyStatic, {
    root: fileURLToPath(new URL('../public', import.meta.url)),
  });

  app.addHook('onRequest', authenticate);

  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/v1/sign', handleSignRequest);
  app.post('/v1/verify', handleVerifyRequest);
  app.get('/v1/verify/key', handleGetPublicKeyRequest);

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = buildApp();

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
