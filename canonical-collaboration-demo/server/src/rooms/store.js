import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logEvent } from '../logging.js';
import { chooseAgentName } from './agent-names.js';

const roomIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

export class Room {
  #conversations = new Map();
  #agentConnections = new Set();
  #agents = new Map();
  #openAgentHandle;
  #closed = false;

  constructor({ roomId, document, openAgentHandle }) {
    this.#openAgentHandle = openAgentHandle;
    this.roomId = roomId;
    this.document = document;
    this.lastActivityAt = new Date();
    this.activeJobs = 0;
  }

  documentReplaced() {
    this.#conversations.clear();
    this.updateLastActivityAt();
  }

  conversationFor(sessionId, create = true) {
    let conversation = this.#conversations.get(sessionId);
    if (!conversation && create) {
      conversation = [];
      this.#conversations.set(sessionId, conversation);
    }
    return conversation ?? [];
  }

  #agentFor(sessionId) {
    let agent = this.#agents.get(sessionId);
    if (!agent) {
      const used = new Set([...this.#agents.values()].map(({ name }) => name));
      agent = { name: chooseAgentName(used), jobs: 0, connections: 0 };
      this.#agents.set(sessionId, agent);
    }
    return agent;
  }

  connectAgentPresence(sessionId, active, send, close) {
    const agent = this.#agentFor(sessionId);
    const connection = { agent, send, close };
    this.#agentConnections.add(connection);
    if (active) agent.connections++;
    this.#publishAgentCount();
    return () => {
      if (!this.#agentConnections.delete(connection)) return;
      if (active) agent.connections--;
      this.#publishAgentCount();
      void this.#releaseAgentHandle(agent);
    };
  }

  #publishAgentCount() {
    const agents = [...this.#agents.values()].filter((agent) => agent.jobs || agent.connections).length;
    for (const connection of this.#agentConnections) connection.send({ agents, name: connection.agent.name });
  }

  async #releaseAgentHandle(agent, force = false) {
    if (!force && (agent.jobs || agent.connections)) return;
    const opened = agent.handle;
    if (!opened) return agent.closing;
    agent.handle = undefined;
    agent.closing = opened.then((handle) => handle.close({ discard: true })).catch((error) => {
      logEvent('rooms', 'agent.handle_cleanup', { roomId: this.roomId, error: error.message });
    });
    await agent.closing;
  }

  async withAgent(sessionId, run) {
    const agent = this.#agentFor(sessionId);
    agent.jobs++;
    this.#publishAgentCount();
    try {
      if (!this.#openAgentHandle) return await run(agent.name);
      await agent.closing;
      if (this.#closed) throw new Error('This room is closed.');
      agent.handle ??= this.#openAgentHandle(agent.name);
      let handle;
      try { handle = await agent.handle; }
      catch (error) { agent.handle = undefined; throw error; }
      return await this.document.withAgentHandle(handle, () => run(agent.name));
    } finally {
      agent.jobs--;
      this.#publishAgentCount();
      await this.#releaseAgentHandle(agent);
    }
  }

  async resetAgentHandles() {
    await Promise.all([...this.#agents.values()].map((agent) => this.#releaseAgentHandle(agent, true)));
  }

  async closeAgentPresence() {
    this.#closed = true;
    const connections = [...this.#agentConnections];
    this.#agentConnections.clear();
    for (const connection of connections) connection.close();
    await this.resetAgentHandles();
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
  #initializations = new Map();
  #collaboration;
  #documents;
  #createServiceToken;
  #documentChanges = new Map();

  constructor(collaboration, documents, { createServiceToken }) {
    this.#collaboration = collaboration;
    this.#documents = documents;
    this.#createServiceToken = createServiceToken;
  }

  subscribeDocumentChanges(roomId, listener) {
    const room = this.require(roomId);
    const id = room.document.id;
    const listeners = this.#documentChanges.get(id) ?? new Set();
    this.#documentChanges.set(id, listeners);
    const notify = () => listener({ document_id: id, generation: room.document.generation });
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
      if (!listeners.size) this.#documentChanges.delete(id);
    };
  }

  notifyDocumentChanged(documentId) {
    for (const listener of this.#documentChanges.get(documentId) ?? []) listener();
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

  async initializeRoom(roomId) {
    this.validateId(roomId);
    const existing = this.#rooms.get(roomId);
    if (existing) return existing;
    if (this.#initializations.has(roomId)) return this.#initializations.get(roomId);
    const pending = (async () => {
      const content = await fs.readFile(config.defaultDocumentPath);
      if (!content.length || content.length > config.maximumUploadBytes) throw new Error('The default document must be a non-empty DOCX within the upload size limit.');
      return this.#replace(roomId, path.basename(config.defaultDocumentPath), content, { recoverExisting: true });
    })();
    this.#initializations.set(roomId, pending);
    try { return await pending; }
    finally { this.#initializations.delete(roomId); }
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
    await this.#initializations.get(roomId);
    return this.#replace(roomId, filename, content);
  }

  async createBlank(roomId) {
    await this.#initializations.get(roomId);
    const content = await fs.readFile(config.blankDocumentPath);
    return this.#replace(roomId, 'Untitled document.docx', content);
  }

  async #replace(roomId, filename, content, { recoverExisting = false } = {}) {
    this.validateId(roomId);
    const existingRoom = this.#rooms.get(roomId);
    if (existingRoom?.activeJobs || existingRoom?.document.referenceBusy) {
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
      await existingRoom.resetAgentHandles();
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
    let document;
    try {
      const open = (roomMode) => this.#documents.open({
        id: documentId,
        filename,
        path: documentPath,
        collaboration: {
          providerType: 'hocuspocus',
          url: `ws://127.0.0.1:${config.port}/collaboration`,
          documentId,
          roomMode,
          syncTimeoutMs: 90_000,
        },
        collaborationAuth: { type: 'token', token: this.#createServiceToken(documentId) },
      });
      try {
        document = await open('create');
      } catch (error) {
        if (!roomAlreadyExists(error)) throw error;
        document = await open('join');
        if (!recoverExisting) {
          const replacementPath = path.join(config.documentRoot, `${roomId}-${randomUUID()}.docx`);
          await fs.writeFile(replacementPath, content);
          try {
            await document.replace(filename, replacementPath);
          } catch (error) {
            await fs.rm(replacementPath, { force: true });
            throw error;
          }
        }
      }
      const room = new Room({
        roomId, document,
        openAgentHandle: config.collaborationAgent === 'on' && config.collaborationAgentPresence === 'on'
          ? (name) => this.#documents.openAgentHandle({
            document,
            name,
            url: `ws://127.0.0.1:${config.port}/collaboration`,
            token: this.#createServiceToken(document.id),
          })
          : undefined,
      });
      this.#rooms.set(roomId, room);
      logEvent('rooms', 'room.created', { roomId, documentId, documentBytes: content.length, activeRooms: this.#rooms.size });
      return room;
    } catch (error) {
      await document?.close().catch(() => {});
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

  async export(roomId, options) {
    const room = this.require(roomId);
    const exportPath = path.join(config.documentRoot, `${room.document.id}-export-${randomUUID()}.docx`);
    try {
      await room.document.save(exportPath, options);
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
    await this.#close(room, { deleteState: true });
    logEvent('rooms', 'room.deleted', { roomId, documentId: room.document.id, activeRooms: this.#rooms.size });
  }

  async expire() {
    const cutoff = Date.now() - config.roomTtlMs;
    const expired = [...this.#rooms.values()].filter((room) => !room.activeJobs && room.lastActivityAt.getTime() < cutoff);
    for (const room of expired) {
      this.#rooms.delete(room.roomId);
      await this.#close(room, { deleteState: false });
    }
    if (expired.length) logEvent('rooms', 'rooms.expired', { roomIds: expired.map((room) => room.roomId), activeRooms: this.#rooms.size });
    return expired.map((room) => room.roomId);
  }

  async closeAll() {
    const rooms = [...this.#rooms.values()];
    this.#rooms.clear();
    await Promise.all(rooms.map((room) => this.#close(room, { deleteState: false })));
  }

  async #close(room, { deleteState }) {
    await room.closeAgentPresence();
    if (deleteState) await this.#collaboration.prepareDelete?.(room.document.id);
    await room.document.close().catch(() => {});
    await this.#collaboration.unload(room.document.id, { deleteState }).catch(() => {});
  }

  response(room) {
    return {
      room_id: room.roomId,
      document_id: room.document.id,
      generation: room.document.generation,
      filename: room.document.filename,
      field_codes: room.document.fieldCodes,
      private_agent_chats: config.collaborationAgent === 'on',
      agent_model: config.collaborationAgent === 'on' ? config.openaiModel : undefined,
      last_activity_at: room.lastActivityAt.toISOString(),
      collaboration_url: config.publicOrigin.replace(/^http/, 'ws') + '/collaboration',
    };
  }
}

function roomAlreadyExists(error) {
  for (let current = error; current; current = current.cause) {
    if (current.code === 'COLLABORATION_ROOM_ALREADY_EXISTS' || current.name === 'RoomExistsError') return true;
  }
  return false;
}
