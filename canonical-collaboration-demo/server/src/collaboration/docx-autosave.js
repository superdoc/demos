import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSuperDocClient } from '@superdoc/sdk';
import { documentIdFromRoomName } from './room-name.js';

const withToken = (token) => token === undefined ? undefined : { collaborationAuth: { type: 'token', token } };

export function createDocxAutosave(options) {
  const marker = { name: 'superdocAutosave', value: randomBytes(24).toString('hex') };
  const dirty = new Set();
  const timers = new Map();
  const queue = [];
  let running = null;
  let client;

  const createClient = options.createClient ?? (() => createSuperDocClient({
    user: { name: 'DOCX autosave', email: 'docx-autosave@demo.local' },
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 300_000,
  }));

  const saveOnce = async (documentId) => {
    client ??= createClient();
    const token = await options.token?.();
    const directory = await mkdtemp(path.join(tmpdir(), 'superdoc-autosave-'));
    try {
      const document = await client.open({
        collaboration: {
          providerType: 'hocuspocus',
          url: options.serverUrl,
          documentId,
          roomMode: 'join',
          params: { [marker.name]: marker.value },
        },
      }, withToken(token));
      try {
        const output = path.join(directory, 'document.docx');
        await document.save({ out: output, force: true });
        await options.docxStore.put(documentId, new Uint8Array(await readFile(output)));
      } finally {
        await document.close({ discard: true });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  const saveWithRetries = async (roomName) => {
    const documentId = documentIdFromRoomName(roomName);
    if (documentId === null) return;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        await saveOnce(documentId);
        options.log?.(`Saved ${documentId}.docx`);
        return;
      } catch (error) {
        await client?.dispose().catch(() => {});
        client = undefined;
        if (attempt === 2) {
          dirty.add(roomName);
          options.log?.(`Could not save ${documentId}.docx: ${error.message}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      }
    }
  };

  const drain = async () => {
    for (let roomName = queue.shift(); roomName; roomName = queue.shift()) {
      dirty.delete(roomName);
      await saveWithRetries(roomName);
    }
  };

  const enqueue = (roomName) => {
    clearTimeout(timers.get(roomName));
    timers.delete(roomName);
    if (!queue.includes(roomName)) queue.push(roomName);
    running ??= drain().finally(() => { running = null; });
  };

  const flush = async () => {
    for (const roomName of dirty) enqueue(roomName);
    while (running) await running;
  };

  return {
    marker,
    roomChanged(roomName) {
      dirty.add(roomName);
      clearTimeout(timers.get(roomName));
      timers.set(roomName, setTimeout(() => enqueue(roomName), options.idleMs ?? 10_000));
    },
    roomEmptied(roomName) {
      if (dirty.has(roomName)) enqueue(roomName);
    },
    async delete(documentId) {
      const roomNames = [...dirty, ...timers.keys(), ...queue]
        .filter((roomName) => documentIdFromRoomName(roomName) === documentId);
      for (const roomName of roomNames) {
        dirty.delete(roomName);
        clearTimeout(timers.get(roomName));
        timers.delete(roomName);
        for (let index = queue.lastIndexOf(roomName); index >= 0; index = queue.lastIndexOf(roomName)) {
          queue.splice(index, 1);
        }
      }
      while (running) await running;
      await options.docxStore.delete(documentId);
    },
    flush,
    async stop() {
      await flush();
      await client?.dispose().catch((error) => {
        options.log?.(`DOCX autosave client shutdown did not complete cleanly: ${error.message}`);
      });
      client = undefined;
    },
  };
}
