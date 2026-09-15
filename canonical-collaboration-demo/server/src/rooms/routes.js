// The route registration table is at the end of this file.
import { config } from '../config.js';

export const roomPath = '/api/rooms/:roomId';

export function registerRoomRoutes(app, { rooms, jobService }) {
  async function getRoom(request) {
    const room = rooms.find(request.params.roomId);
    return { room_id: request.params.roomId, document: room ? rooms.response(room) : null };
  }

  async function uploadDocument(request, reply) {
    const upload = await request.file({ limits: { fileSize: config.maximumUploadBytes } });
    if (!upload) throw app.httpErrors.badRequest('Upload a .docx document.');
    const room = await rooms.replaceUpload(request.params.roomId, upload.filename, await upload.toBuffer());
    return reply.send(rooms.response(room));
  }

  async function createBlankDocument(request, reply) {
    const room = await rooms.createBlank(request.params.roomId);
    return reply.code(201).send(rooms.response(room));
  }

  async function getDocumentInfo(request) {
    return rooms.response(rooms.require(request.params.roomId));
  }

  async function downloadDocument(request, reply) {
    const { room, content } = await rooms.export(request.params.roomId);
    const filename = room.document.filename.replace(/["\r\n]/g, '_');
    return reply
      .type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(content);
  }

  async function dispatchDocumentTool(request) {
    const room = rooms.require(request.params.roomId);
    const { tool, arguments: args = {} } = request.body ?? {};
    if (typeof tool !== 'string' || !tool) throw app.httpErrors.badRequest('tool is required.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw app.httpErrors.badRequest('arguments must be an object.');
    }
    const result = await room.document.dispatch(tool, args);
    room.updateLastActivityAt();
    return { ok: true, result };
  }

  async function deleteDocument(request, reply) {
    await rooms.delete(request.params.roomId);
    return reply.code(204).send();
  }

  async function getRoomStatus(request) {
    return rooms.status(request.params.roomId, request.body?.generation);
  }

  async function getChat(request) {
    return { messages: rooms.require(request.params.roomId).conversation };
  }

  async function createJob(request, reply) {
    const record = jobService.create(request.params.roomId, request.body);
    return reply
      .code(202)
      .header('Location', `/api/rooms/${encodeURIComponent(request.params.roomId)}/jobs/${record.id}`)
      .send(record);
  }

  async function getJob(request) {
    return jobService.get(request.params.roomId, request.params.jobId);
  }

  async function cancelJob(request) {
    return jobService.cancel(request.params.roomId, request.params.jobId);
  }

  const routes = [
    // Read the room's current document metadata, if a document exists.
    { url: roomPath, method: 'GET', handler: getRoom },
    // Upload or replace the room's document with a DOCX file.
    { url: `${roomPath}/document`, method: 'PUT', handler: uploadDocument },
    // Create a blank document in the room.
    { url: `${roomPath}/document`, method: 'POST', handler: createBlankDocument },
    // Read metadata for the room's current document.
    { url: `${roomPath}/document/info`, method: 'GET', handler: getDocumentInfo },
    // Download the room's current document as a DOCX file.
    { url: `${roomPath}/document`, method: 'GET', handler: downloadDocument },
    // Apply one SuperDoc tool operation to the current document.
    { url: `${roomPath}/document`, method: 'PATCH', handler: dispatchDocumentTool },
    // Delete the room's document and associated ephemeral state.
    { url: `${roomPath}/document`, method: 'DELETE', handler: deleteDocument },
    // Refresh room activity and reconcile document generation metadata.
    { url: `${roomPath}/status`, method: 'POST', handler: getRoomStatus },
    // Read the current document's completed agent conversation.
    { url: `${roomPath}/chat`, method: 'GET', handler: getChat },
    // Enqueue an agent job for the room's current document.
    { url: `${roomPath}/jobs`, method: 'POST', handler: createJob },
    // Read the current status and result of an agent job.
    { url: `${roomPath}/jobs/:jobId`, method: 'GET', handler: getJob },
    // Cancel an active agent job.
    { url: `${roomPath}/jobs/:jobId`, method: 'DELETE', handler: cancelJob },
  ];

  for (const route of routes) app.route(route);
}
