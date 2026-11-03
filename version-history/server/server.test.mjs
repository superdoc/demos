import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Map as YMap } from 'yjs';
import { createBackend } from './server.mjs';

async function start(directory) {
  const backend = createBackend({ dataDirectory: directory });
  await new Promise((resolve) => backend.server.listen(0, '127.0.0.1', resolve));
  return { ...backend, url: `http://127.0.0.1:${backend.server.address().port}` };
}

async function session(server, room, name, clientId = randomUUID()) {
  return fetch(`${server.url}/api/rooms/${room}/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, clientId }),
  });
}

const authorization = (session) => ({ Authorization: `Bearer ${session.token}` });

async function initialize(server, room, owner) {
  const connection = await server.collaboration.openDirectConnection(`sd2/v1/${owner.documentId}`);
  await connection.transact((document) => document.getMap('content').set('body', new YMap([['test', 'persisted']])));
  const response = await fetch(`${server.url}/api/rooms/${room}/ready`, { method: 'POST', headers: authorization(owner) });
  assert.equal(response.status, 200);
  await connection.disconnect();
}

test('one initializer owns a room; other users join only after initialization', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'version-collab-'));
  const server = await start(directory);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const alice = await (await session(server, 'shared', 'Alice')).json();
  assert.equal(alice.mode, 'create');
  const waiting = await session(server, 'shared', 'Bob');
  assert.equal(waiting.status, 202);
  const earlySave = await fetch(`${server.url}/api/rooms/shared/versions`, { method: 'POST', headers: authorization(alice) });
  assert.equal(earlySave.status, 409);
  await initialize(server, 'shared', alice);
  const bob = await (await session(server, 'shared', 'Bob')).json();
  assert.equal(bob.mode, 'join');
  assert.equal(bob.documentId, alice.documentId);
});

test('concurrent saves have immutable files, server ordering, authors and idempotent IDs', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'version-api-'));
  const server = await start(directory);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const alice = await (await session(server, 'shared', 'Alice')).json();
  await initialize(server, 'shared', alice);
  const bob = await (await session(server, 'shared', 'Bob')).json();
  const bytes = await readFile(new URL('../public/document.docx', import.meta.url));
  const aliceId = randomUUID();
  const save = (user, id) => fetch(`${server.url}/api/rooms/shared/versions`, {
    method: 'POST', headers: { ...authorization(user), 'X-Version-Id': id }, body: bytes,
  });
  const responses = await Promise.all([save(alice, aliceId), save(bob, randomUUID())]);
  for (const response of responses) assert.equal(response.status, 201);
  const original = await responses[0].json();
  const retry = await (await save(alice, aliceId)).json();
  assert.deepEqual(retry, original);
  assert.equal((await save(bob, aliceId)).status, 409);
  const list = await (await fetch(`${server.url}/api/rooms/shared/versions`, { headers: authorization(bob) })).json();
  assert.deepEqual(list.map((entry) => entry.number), [2, 1]);
  assert.deepEqual(list.map((entry) => entry.createdBy.name).sort(), ['Alice', 'Bob']);
  const file = await fetch(`${server.url}/api/rooms/shared/versions/${aliceId}/file`, { headers: authorization(bob) });
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  assert.equal((await fetch(`${server.url}/api/rooms/another/versions`, { headers: authorization(alice) })).status, 401);
  assert.equal((await fetch(`${server.url}/api/rooms/shared/versions`)).status, 401);
});

test('room state and version history survive restarting the backend', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'version-restart-'));
  let server = await start(directory);
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const owner = await (await session(server, 'persisted', 'Alice')).json();
  await initialize(server, 'persisted', owner);
  const id = randomUUID();
  const bytes = await readFile(new URL('../public/document.docx', import.meta.url));
  assert.equal((await fetch(`${server.url}/api/rooms/persisted/versions`, {
    method: 'POST', headers: { ...authorization(owner), 'X-Version-Id': id }, body: bytes,
  })).status, 201);
  await server.close();
  server = await start(directory);
  const user = await (await session(server, 'persisted', 'Bob')).json();
  assert.equal(user.mode, 'join');
  const list = await (await fetch(`${server.url}/api/rooms/persisted/versions`, { headers: authorization(user) })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, id);
  const connection = await server.collaboration.openDirectConnection(`sd2/v1/${user.documentId}`);
  assert.equal(connection.document.getMap('content').get('body').get('test'), 'persisted');
  await connection.disconnect();
});
