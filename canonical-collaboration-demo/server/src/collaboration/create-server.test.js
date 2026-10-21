import assert from 'node:assert/strict';
import test from 'node:test';
import { Doc, encodeStateAsUpdate } from 'yjs';
import { createCollaborationServer } from './create-server.js';

function fixture(authorize) {
  const stored = [];
  const server = createCollaborationServer({
    authorize,
    roomStore: {
      async load() { return null; },
      async store(roomName, state) { stored.push({ roomName, state }); },
    },
  });
  return { server, stored };
}

test('enforces authorization and applies read-only access at the WebSocket gate', async () => {
  const accepted = fixture(async ({ token, documentId }) => token === 'valid' && documentId === 'contract-42'
    ? { userId: 'alice', readOnly: true }
    : null);
  const connection = {};
  assert.deepEqual(await accepted.server.configuration.onAuthenticate({
    token: 'valid', documentName: 'sd2/v1/contract-42', connection,
  }), { userId: 'alice' });
  assert.equal(connection.readOnly, true);
  await assert.rejects(accepted.server.configuration.onAuthenticate({
    token: 'invalid', documentName: 'sd2/v1/contract-42', connection: {},
  }), /Access denied/);
});

test('loads and stores Yjs state through the configured adapter', async () => {
  const source = new Doc();
  source.getText('body').insert(0, 'persisted');
  const update = encodeStateAsUpdate(source);
  const stored = [];
  const server = createCollaborationServer({
    authorize: null,
    roomStore: {
      async load(roomName) { return roomName === 'sd2/v1/contract-42' ? update : null; },
      async store(roomName, state) { stored.push({ roomName, state }); },
    },
  });
  const target = new Doc();
  await server.configuration.onLoadDocument({ documentName: 'sd2/v1/contract-42', document: target });
  assert.equal(target.getText('body').toString(), 'persisted');
  await server.configuration.onStoreDocument({ documentName: 'sd2/v1/contract-42', document: target });
  assert.equal(stored[0].roomName, 'sd2/v1/contract-42');
  assert.ok(stored[0].state instanceof Uint8Array);
});
