import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { collaborationUrl, config } from './config.js';
import { logEvent } from './diagnostics.js';
import { HttpError } from './http-error.js';

const roomIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

export class RoomStore {
  #rooms = new Map();
  #collaboration;
  #events;
  #documentWorker;

  constructor(collaboration, events, documentWorker) {
    this.#collaboration = collaboration;
    this.#events = events;
    this.#documentWorker = documentWorker;
  }

  async initialize() {
    await fs.mkdir(config.documentRoot, { recursive: true });
  }

  validateId(roomId) {
    if (!roomIdPattern.test(roomId)) {
      throw new HttpError(400, 'Room IDs may contain letters, numbers, underscores, and hyphens.');
    }
  }

  find(roomId, touch = true) {
    this.validateId(roomId);
    const room = this.#rooms.get(roomId);
    if (room && touch) this.touchDocument(room.documentId);
    return room;
  }

  require(roomId, touch = true) {
    const room = this.find(roomId, touch);
    if (!room) throw new HttpError(404, 'This room does not have a document.');
    return room;
  }

  async replaceUpload(roomId, filename, content) {
    if (!filename?.toLowerCase().endsWith('.docx')) throw new HttpError(400, 'Upload a .docx document.');
    if (!content.length || content.length > config.maximumUploadBytes) {
      throw new HttpError(400, 'The document must be between 1 byte and 25 MB.');
    }
    return this.#replace(roomId, filename, content);
  }

  async createBlank(roomId) {
    const content = await fs.readFile(config.blankDocumentPath);
    return this.#replace(roomId, 'Untitled document.docx', content);
  }

  async #replace(roomId, filename, content) {
    this.validateId(roomId);
    const existing = this.#rooms.get(roomId);
    if (existing?.activeJobs) throw new HttpError(409, 'Wait for the active agent job before replacing the document.');

    if (existing) {
      const replacementPath = path.join(config.documentRoot, `${roomId}-${randomUUID()}.docx`);
      await fs.writeFile(replacementPath, content);
      try {
        await this.#documentWorker.replaceFile(existing.documentId, replacementPath);
      } catch (error) {
        await fs.rm(replacementPath, { force: true });
        throw error;
      }
      const previousPath = existing.path;
      existing.path = replacementPath;
      await fs.rm(previousPath, { force: true });
      existing.filename = filename;
      existing.generation += 1;
      existing.lastActivityAt = new Date();
      existing.conversation = [];
      logEvent('rooms', 'room.replaced', {
        roomId,
        documentId: existing.documentId,
        generation: existing.generation,
        documentBytes: content.length,
        activeRooms: this.#rooms.size,
      });
      this.#events.publish(roomId, this.response(existing));
      return existing;
    }

    const documentId = roomId;
    const documentPath = path.join(config.documentRoot, `${roomId}-${randomUUID()}.docx`);
    await fs.writeFile(documentPath, content);
    try {
      await this.#documentWorker.open(documentId, documentPath, {
        providerType: 'hocuspocus',
        url: collaborationUrl(`http://127.0.0.1:${config.port}`),
        documentId,
        roomMode: 'create',
        syncTimeoutMs: 90_000,
      });
      const room = {
        roomId,
        documentId,
        generation: 1,
        filename,
        path: documentPath,
        lastActivityAt: new Date(),
        activeJobs: 0,
        conversation: [],
      };
      this.#rooms.set(roomId, room);
      logEvent('rooms', 'room.created', { roomId, documentId, documentBytes: content.length, activeRooms: this.#rooms.size });
      this.#events.publish(roomId, this.response(room));
      return room;
    } catch (error) {
      await fs.rm(documentPath, { force: true });
      throw error;
    }
  }

  heartbeat(roomId, generation) {
    const room = this.require(roomId, false);
    if (room.generation !== generation) throw new HttpError(409, 'The room document has been replaced.');
    room.lastActivityAt = new Date();
    logEvent('rooms', 'room.heartbeat', { roomId, documentId: room.documentId, generation });
  }

  touchDocument(documentId) {
    const room = this.#rooms.get(documentId);
    if (room) room.lastActivityAt = new Date();
  }

  async export(roomId) {
    const room = this.require(roomId);
    const exportPath = path.join(config.documentRoot, `${room.documentId}-export-${randomUUID()}.docx`);
    try {
      await this.#documentWorker.save(room.documentId, exportPath);
      const content = await fs.readFile(exportPath);
      logEvent('rooms', 'document.exported', { roomId, documentId: room.documentId, documentBytes: content.length });
      return { room, content };
    } finally {
      await fs.rm(exportPath, { force: true });
    }
  }

  async delete(roomId) {
    const room = this.require(roomId, false);
    if (room.activeJobs) throw new HttpError(409, 'Cancel the active agent job before deleting the document.');
    this.#rooms.delete(roomId);
    await this.#close(room);
    this.#events.publish(roomId, null);
    logEvent('rooms', 'room.deleted', { roomId, documentId: room.documentId, activeRooms: this.#rooms.size });
  }

  async expire() {
    const cutoff = Date.now() - config.roomTtlMs;
    const expired = [...this.#rooms.values()].filter((room) => !room.activeJobs && room.lastActivityAt.getTime() < cutoff);
    for (const room of expired) await this.delete(room.roomId);
    if (expired.length) logEvent('rooms', 'rooms.expired', { roomIds: expired.map((room) => room.roomId), activeRooms: this.#rooms.size });
    return expired.map((room) => room.roomId);
  }

  async closeAll() {
    const rooms = [...this.#rooms.values()];
    this.#rooms.clear();
    await Promise.all(rooms.map((room) => this.#close(room)));
  }

  async #close(room) {
    await this.#documentWorker.close(room.documentId).catch(() => {});
    await this.#collaboration.unload(room.documentId).catch(() => {});
    await fs.rm(room.path, { force: true });
  }

  response(room) {
    return {
      room_id: room.roomId,
      document_id: room.documentId,
      generation: room.generation,
      filename: room.filename,
      last_activity_at: room.lastActivityAt.toISOString(),
      collaboration_url: collaborationUrl(),
    };
  }
}
