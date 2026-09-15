import { config } from './config.js';

export async function registerRoutes(app, { rooms, jobs, agent, roomEvents }) {
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
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw app.httpErrors.badRequest('arguments must be an object.');
    const result = await agent.dispatch(room.documentId, tool, args);
    room.lastActivityAt = new Date();
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
    return reply.code(202).header('Location', `/api/rooms/${encodeURIComponent(request.params.roomId)}/jobs/${record.id}`).send(record);
  });

  app.get('/api/rooms/:roomId/jobs/:jobId', async (request) => jobs.get(request.params.roomId, request.params.jobId));

  app.delete('/api/rooms/:roomId/jobs/:jobId', async (request) => jobs.cancel(request.params.roomId, request.params.jobId));
}
