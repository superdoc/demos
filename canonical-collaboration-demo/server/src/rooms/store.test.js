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

function fixture({ beforeOpen = async () => {} } = {}) {
  const opened = [];
  const unloads = [];
  const store = new RoomStore({ unload: async (...args) => { unloads.push(args); } }, {
    async open(input) {
      opened.push(input);
      await beforeOpen();
      return { id: input.id, filename: input.filename, path: input.path, generation: 1,
        async replace(filename, newPath) { this.filename = filename; this.path = newPath; this.generation++; },
        async close() {},
      };
    },
  }, { createServiceToken: (documentId) => `service-token:${documentId}` });
  return { store, opened, unloads };
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

test('deleting a room requests removal of its persisted collaboration state', async () => {
  const { store, unloads } = fixture();
  await store.createBlank('delete-me');
  await store.delete('delete-me');
  assert.deepEqual(unloads, [['delete-me', { deleteState: true }]]);
});

test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
