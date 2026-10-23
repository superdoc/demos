import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeletableRoomStore } from './deletable-room-store.js';

function recordingStore() {
  const states = new Map();
  let releaseWrite = null;
  return {
    states,
    holdNextWrite() {
      return new Promise((started) => {
        releaseWrite = started;
      });
    },
    async load(roomName) {
      return states.get(roomName) ?? null;
    },
    async store(roomName, state) {
      if (releaseWrite) {
        const finishWrite = new Promise((resolve) => releaseWrite(resolve));
        releaseWrite = null;
        await finishWrite;
      }
      states.set(roomName, state);
    },
    async delete(roomName) {
      states.delete(roomName);
    },
  };
}

test('deletion waits for an in-flight write before removing the room', async () => {
  const inner = recordingStore();
  const store = createDeletableRoomStore(inner);
  const writeStarted = inner.holdNextWrite();
  const write = store.store('room-a', new Uint8Array([1]));
  const finishWrite = await writeStarted;
  const deletion = store.delete('room-a');
  finishWrite();
  await Promise.all([write, deletion]);
  assert.equal(await store.load('room-a'), null);
});

test('a write that arrives after deletion does not restore the room', async () => {
  const inner = recordingStore();
  const store = createDeletableRoomStore(inner);
  await store.store('room-a', new Uint8Array([1]));
  await store.delete('room-a');
  await store.store('room-a', new Uint8Array([2]));
  assert.equal(inner.states.has('room-a'), false);
});

test('a room created again after deletion stores new state', async () => {
  const inner = recordingStore();
  const store = createDeletableRoomStore(inner);
  await store.store('room-a', new Uint8Array([1]));
  await store.delete('room-a');
  assert.equal(await store.load('room-a'), null);
  await store.store('room-a', new Uint8Array([3]));
  assert.deepEqual(await store.load('room-a'), new Uint8Array([3]));
});
