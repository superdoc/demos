import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileRoomStore } from './file-room-store.js';

test('stores, loads, and deletes binary room state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-room-store-'));
  try {
    const store = createFileRoomStore(directory);
    assert.equal(await store.load('../unsafe-room'), null);
    await store.store('../unsafe-room', new Uint8Array([1, 2, 3]));
    assert.deepEqual(await store.load('../unsafe-room'), new Uint8Array([1, 2, 3]));
    await store.delete('../unsafe-room');
    assert.equal(await store.load('../unsafe-room'), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
