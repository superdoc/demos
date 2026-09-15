import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logEvent } from './logging.js';

const roomIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

export class Room {
  constructor({ roomId, filename, path: documentPath }) {
    this.roomId = roomId;
    this.documentId = roomId;
    this.generation = 1;
    this.filename = filename;
    this.path = documentPath;
    this.lastActivityAt = new Date();
    this.activeJobs = 0;
    this.conversation = [];
  }

  replaceDocument(filename, documentPath) {
    const previousPath = this.path;
    this.path = documentPath;
    this.filename = filename;
    this.generation += 1;
    this.conversation = [];
    this.updateLastActivityAt();
    return previousPath;
  }

  updateLastActivityAt() {
    this.lastActivityAt = new Date();
  }

  startJob() {
    this.activeJobs += 1;
  }

  finishJob() {
    this.activeJobs = Math.max(0, this.activeJobs - 1);
  }
}

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
      const error = new Error('Room IDs may contain letters, numbers, underscores, and hyphens.');
      error.name = 'HttpError';
      error.statusCode = 400;
      throw error;
    }
  }

  find(roomId, updateActivity = true) {
    this.validateId(roomId);
    const room = this.#rooms.get(roomId);
    if (room && updateActivity) this.updateLastActivityAt(room.documentId);
    return room;
  }

  require(roomId, updateActivity = true) {
    const room = this.find(roomId, updateActivity);
    if (!room) {
      const error = new Error('This room does not have a document.');
      error.name = 'HttpError';
      error.statusCode = 404;
      throw error;
    }
    return room;
  }

  async replaceUpload(roomId, filename, content) {
    if (!filename?.toLowerCase().endsWith('.docx')) {
      const error = new Error('Upload a .docx document.');
      error.name = 'HttpError';
      error.statusCode = 400;
      throw error;
    }
    if (!content.length || content.length > config.maximumUploadBytes) {
      const error = new Error(`The document must be between 1 byte and ${config.maximumUploadMegabytes} MB.`);
      error.name = 'HttpError';
      error.statusCode = 400;
      throw error;
    }
    return this.#replace(roomId, filename, content);
  }

  async createBlank(roomId) {
    const content = await fs.readFile(config.blankDocumentPath);
    return this.#replace(roomId, 'Untitled document.docx', content);
  }

  async #replace(roomId, filename, content) {
    this.validateId(roomId);
    const existingRoom = this.#rooms.get(roomId);
    if (existingRoom?.activeJobs) {
      const error = new Error('Wait for the active agent job before replacing the document.');
      error.name = 'HttpError';
      error.statusCode = 409;
      throw error;
    }

    if (existingRoom) {
      const replacementPath = path.join(config.documentRoot, `${roomId}-${randomUUID()}.docx`);
      await fs.writeFile(replacementPath, content);
      try {
        await this.#documentWorker.replaceFile(existingRoom.documentId, replacementPath);
      } catch (error) {
        await fs.rm(replacementPath, { force: true });
        throw error;
      }
      const previousPath = existingRoom.replaceDocument(filename, replacementPath);
      await fs.rm(previousPath, { force: true });
      logEvent('rooms', 'room.replaced', {
        roomId,
        documentId: existingRoom.documentId,
        generation: existingRoom.generation,
        documentBytes: content.length,
        activeRooms: this.#rooms.size,
      });
      this.#events.publish(roomId, this.response(existingRoom));
      return existingRoom;
    }

    const documentId = roomId;
    const documentPath = path.join(config.documentRoot, `${roomId}-${randomUUID()}.docx`);
    await fs.writeFile(documentPath, content);
    try {
      await this.#documentWorker.open(documentId, documentPath, {
        providerType: 'hocuspocus',
        url: `ws://127.0.0.1:${config.port}/collaboration`,
        documentId,
        roomMode: 'create',
        syncTimeoutMs: 90_000,
      });
      const room = new Room({
        roomId,
        filename,
        path: documentPath,
      });
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
    if (room.generation !== generation) {
      const error = new Error('The room document has been replaced.');
      error.name = 'HttpError';
      error.statusCode = 409;
      throw error;
    }
    room.updateLastActivityAt();
    logEvent('rooms', 'room.heartbeat', { roomId, documentId: room.documentId, generation });
  }

  updateLastActivityAt(documentId) {
    const room = this.#rooms.get(documentId);
    room?.updateLastActivityAt();
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
    if (room.activeJobs) {
      const error = new Error('Cancel the active agent job before deleting the document.');
      error.name = 'HttpError';
      error.statusCode = 409;
      throw error;
    }
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
      collaboration_url: config.publicOrigin.replace(/^http/, 'ws') + '/collaboration',
    };
  }
}
