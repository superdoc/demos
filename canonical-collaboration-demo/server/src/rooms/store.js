import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logEvent } from '../logging.js';

const roomIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

export class Room {
  constructor({ roomId, document }) {
    this.roomId = roomId;
    this.document = document;
    this.lastActivityAt = new Date();
    this.activeJobs = 0;
    this.conversation = [];
  }

  documentReplaced() {
    this.conversation = [];
    this.updateLastActivityAt();
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
  #documents;

  constructor(collaboration, documents) {
    this.#collaboration = collaboration;
    this.#documents = documents;
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
    if (room && updateActivity) this.updateLastActivityAt(room.document.id);
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
        await existingRoom.document.replace(filename, replacementPath);
      } catch (error) {
        await fs.rm(replacementPath, { force: true });
        throw error;
      }
      existingRoom.documentReplaced();
      logEvent('rooms', 'room.replaced', {
        roomId,
        documentId: existingRoom.document.id,
        generation: existingRoom.document.generation,
        documentBytes: content.length,
        activeRooms: this.#rooms.size,
      });
      return existingRoom;
    }

    const documentId = roomId;
    const documentPath = path.join(config.documentRoot, `${roomId}-${randomUUID()}.docx`);
    await fs.writeFile(documentPath, content);
    try {
      const document = await this.#documents.open({
        id: documentId,
        filename,
        path: documentPath,
        collaboration: {
          providerType: 'hocuspocus',
          url: `ws://127.0.0.1:${config.port}/collaboration`,
          documentId,
          roomMode: 'create',
          syncTimeoutMs: 90_000,
        },
      });
      const room = new Room({ roomId, document });
      this.#rooms.set(roomId, room);
      logEvent('rooms', 'room.created', { roomId, documentId, documentBytes: content.length, activeRooms: this.#rooms.size });
      return room;
    } catch (error) {
      await fs.rm(documentPath, { force: true });
      throw error;
    }
  }

  status(roomId, generation) {
    this.validateId(roomId);
    const room = this.#rooms.get(roomId);
    const stale = generation !== undefined && room?.document.generation !== generation;
    if (room) room.updateLastActivityAt();
    logEvent('rooms', 'room.status', { roomId, documentId: room?.document.id, generation, stale });
    return { document: room ? this.response(room) : null, stale };
  }

  updateLastActivityAt(documentId) {
    const room = this.#rooms.get(documentId);
    room?.updateLastActivityAt();
  }

  async export(roomId) {
    const room = this.require(roomId);
    const exportPath = path.join(config.documentRoot, `${room.document.id}-export-${randomUUID()}.docx`);
    try {
      await room.document.save(exportPath);
      const content = await fs.readFile(exportPath);
      logEvent('rooms', 'document.exported', { roomId, documentId: room.document.id, documentBytes: content.length });
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
    logEvent('rooms', 'room.deleted', { roomId, documentId: room.document.id, activeRooms: this.#rooms.size });
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
    await room.document.close().catch(() => {});
    await this.#collaboration.unload(room.document.id).catch(() => {});
  }

  response(room) {
    return {
      room_id: room.roomId,
      document_id: room.document.id,
      generation: room.document.generation,
      filename: room.document.filename,
      last_activity_at: room.lastActivityAt.toISOString(),
      collaboration_url: config.publicOrigin.replace(/^http/, 'ws') + '/collaboration',
    };
  }
}
