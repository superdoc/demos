import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryRoomStore } from './memory-room-store.js';

test('does not persist room state outside the live Hocuspocus document', async () => {
  const store = createMemoryRoomStore();
  await store.store('room-a', new Uint8Array([1, 2]));
  assert.equal(await store.load('room-a'), null);
  await store.delete('room-a');
  assert.equal(await store.load('room-a'), null);
});
