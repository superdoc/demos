import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'default-room-test-'));
process.env.DOCUMENT_ROOT = directory;
process.env.COLLABORATION_AUTH = 'none';
const { RoomStore } = await import('./store.js');
const { config } = await import('../config.js');

function fixture({ beforeOpen = async () => {}, openDocument } = {}) {
  const opened = [];
  const unloads = [];
  const lifecycle = [];
  const store = new RoomStore({
    async prepareDelete(documentId) { lifecycle.push(['prepareDelete', documentId]); },
    async unload(...args) { unloads.push(args); lifecycle.push(['unload', ...args]); },
  }, {
    async open(input) {
      opened.push(input);
      await beforeOpen();
      if (openDocument) return openDocument(input, opened.length);
      return { id: input.id, filename: input.filename, path: input.path, generation: 1,
        async replace(filename, newPath) { this.filename = filename; this.path = newPath; this.generation++; },
        async close() { lifecycle.push(['close', this.id]); },
      };
    },
  }, { createServiceToken: (documentId) => `service-token:${documentId}` });
  return { store, opened, unloads, lifecycle };
}

test('new rooms receive an independent copy of the bundled contract', async () => {
  const { store, opened } = fixture();
  const original = await fs.readFile(config.defaultDocumentPath);
  const first = await store.initializeRoom('default-one');
  const second = await store.initializeRoom('default-two');
  assert.equal(opened.length, 2);
  assert.equal(first.document.filename, 'contract.docx');
  assert.notEqual(first.document.path, config.defaultDocumentPath);
  assert.notEqual(first.document.path, second.document.path);
  assert.deepEqual(await fs.readFile(first.document.path), original);
  assert.deepEqual(await fs.readFile(second.document.path), original);
});

test('simultaneous room initializations open one native document session', async () => {
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const { store, opened } = fixture({ beforeOpen: () => { entered(); return gate; } });
  const first = store.initializeRoom('shared-default');
  const second = store.initializeRoom('shared-default');
  await started;
  assert.equal(opened.length, 1);
  release();
  const rooms = await Promise.all([first, second]);
  assert.equal(rooms[0], rooms[1]);
  assert.equal(rooms[0].document.generation, 1);
});

test('initialization preserves an uploaded document or an explicitly created blank', async () => {
  const { store, opened } = fixture();
  const content = await fs.readFile(config.blankDocumentPath);
  const uploaded = await store.replaceUpload('existing-upload', 'My document.docx', content);
  assert.equal(await store.initializeRoom('existing-upload'), uploaded);
  assert.equal(uploaded.document.filename, 'My document.docx');
  const blank = await store.createBlank('existing-blank');
  assert.equal(await store.initializeRoom('existing-blank'), blank);
  assert.equal(blank.document.filename, 'Untitled document.docx');
  assert.equal(opened.length, 2);
  await assert.rejects(store.initializeRoom('../invalid'), /Room IDs/);
});

test('deleting a room cancels autosave before disconnecting and removes persisted state', async () => {
  const { store, unloads, lifecycle } = fixture();
  await store.createBlank('delete-me');
  await store.delete('delete-me');
  assert.deepEqual(unloads, [['delete-me', { deleteState: true }]]);
  assert.deepEqual(lifecycle, [
    ['prepareDelete', 'delete-me'],
    ['close', 'delete-me'],
    ['unload', 'delete-me', { deleteState: true }],
  ]);
});

test('initialization rejoins persisted collaboration state after a restart', async () => {
  const document = { id: 'persisted', filename: 'contract.docx', generation: 1, async close() {} };
  const { store, opened } = fixture({
    openDocument(input, attempt) {
      if (attempt === 1) {
        const error = new Error('Room exists.');
        error.code = 'COLLABORATION_ROOM_ALREADY_EXISTS';
        throw error;
      }
      return document;
    },
  });
  const room = await store.initializeRoom('persisted');
  assert.equal(room.document, document);
  assert.deepEqual(opened.map((input) => input.collaboration.roomMode), ['create', 'join']);
});

test('explicit replacement updates a persisted room after joining it', async () => {
  let replacements = 0;
  const document = {
    id: 'persisted-upload', filename: 'old.docx', generation: 1,
    async replace(filename) { this.filename = filename; this.generation += 1; replacements += 1; },
    async close() {},
  };
  const { store, opened } = fixture({
    openDocument(_input, attempt) {
      if (attempt === 1) {
        const error = new Error('Room exists.');
        error.name = 'RoomExistsError';
        throw error;
      }
      return document;
    },
  });
  const content = await fs.readFile(config.blankDocumentPath);
  const room = await store.replaceUpload('persisted-upload', 'replacement.docx', content);
  assert.equal(room.document.filename, 'replacement.docx');
  assert.equal(replacements, 1);
  assert.deepEqual(opened.map((input) => input.collaboration.roomMode), ['create', 'join']);
});

test('expiry unloads inactive rooms without deleting persisted collaboration state', async () => {
  const { store, unloads } = fixture();
  const room = await store.createBlank('idle-room');
  room.lastActivityAt = new Date(0);
  assert.deepEqual(await store.expire(), ['idle-room']);
  assert.deepEqual(unloads, [['idle-room', { deleteState: false }]]);
  assert.equal(store.find('idle-room'), undefined);
});

test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
