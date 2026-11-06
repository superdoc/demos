import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Doc, Text, Map as YMap, encodeStateAsUpdate, encodeStateVector } from 'yjs';
import { createBackend } from './server.mjs';

test('Railway startup refuses ephemeral storage and data outside its persistent volume', () => {
  for (const mountPath of ['', '/different-volume']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
      env: { ...process.env, RAILWAY_ENVIRONMENT_ID: 'test', RAILWAY_VOLUME_MOUNT_PATH: mountPath, DATA_DIRECTORY: '/data' },
      encoding: 'utf8', timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Attach a persistent volume/);
  }
});

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

function changesFixture() {
  const doc = new Doc({ gc: false });
  const text = new Text('Initial text');
  doc.getMap('content').set('body', new YMap([['text', text]]));
  let update;
  doc.on('update', (bytes) => { update = bytes; });
  let sequence = 0;
  const checkpoint = (baseVersionId) => ({ revision: `revision-${sequence}`, cursor: `cursor-${sequence}`, lastChangeId: `change-${sequence}`,
    state: Buffer.from(encodeStateAsUpdate(doc)).toString('base64'), stateVector: Buffer.from(encodeStateVector(doc)).toString('base64'),
    at: new Date().toISOString(), baseVersionId });
  const edit = (name, inserted) => {
    const offset = text.length;
    sequence++;
    doc.transact(() => { text.insert(offset, inserted); doc.getMap('meta').set('stamp', sequence); });
    return { id: `change-${sequence}`, seq: sequence, revision: `revision-${sequence}`, origin: 'local', actor: { id: name, name },
      actorType: 'human', cause: 'user', provenance: 'authored', at: { declared: new Date().toISOString(), observed: new Date().toISOString() },
      session: { id: 'session', clientId: doc.clientID }, update: Buffer.from(update).toString('base64'),
      changes: [{ kind: 'text', story: { kind: 'story', storyType: 'body' }, blockId: 'paragraph', range: { start: offset, end: text.length }, inserted, deleted: '' }] };
  };
  return { doc, edit, checkpoint };
}

test('Changes API versions keep attributed intervals, causal checkpoints, and immutable history after restart', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'changes-api-'));
  let server = await start(directory);
  const fixture = changesFixture();
  t.after(async () => { fixture.doc.destroy(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  let owner = await (await session(server, 'changes', 'Saver')).json();
  await initialize(server, 'changes', owner);
  const bytes = await readFile(new URL('../public/document.docx', import.meta.url));
  const upload = (records) => fetch(`${server.url}/api/rooms/changes/changes`, {
    method: 'POST', headers: { ...authorization(owner), 'Content-Type': 'application/json' }, body: JSON.stringify(records),
  });
  const save = (checkpoint, id = randomUUID()) => {
    const form = new FormData(); form.set('document', new Blob([bytes]), 'document.docx'); form.set('checkpoint', JSON.stringify(checkpoint));
    return fetch(`${server.url}/api/rooms/changes/versions`, { method: 'POST', headers: { ...authorization(owner), 'X-Version-Id': id }, body: form });
  };
  const records = (id) => fetch(`${server.url}/api/rooms/changes/versions/${id}/changes`, { headers: authorization(owner) }).then((response) => response.json());
  const first = fixture.edit('Alice', ' first');
  assert.equal((await upload([first, first])).status, 200);
  const firstCheckpoint = fixture.checkpoint(null);
  const saved = await save(firstCheckpoint);
  assert.equal(saved.status, 201);
  const version1 = await saved.json();
  assert.equal(version1.changeCount, 1);
  assert.equal(version1.createdBy.name, 'Saver');
  assert.deepEqual(await records(version1.id), [first]);

  const second = fixture.edit('Bob', ' second');
  const secondCheckpoint = fixture.checkpoint(version1.id);
  const future = fixture.edit('Alice', ' after snapshot');
  assert.equal((await upload([second, future])).status, 200);
  const savedSecond = await save(secondCheckpoint);
  assert.equal(savedSecond.status, 201);
  const version2 = await savedSecond.json();
  assert.deepEqual(await records(version2.id), [second]);
  assert.equal((await save(firstCheckpoint)).status, 409);
  const version3 = await (await save(fixture.checkpoint(version2.id))).json();
  assert.deepEqual(await records(version3.id), [future]);
  assert.deepEqual(await records(version1.id), [first]);
  const snapshot = await readFile(path.join(directory, 'changes', `${version1.id}.yjs`));
  assert.equal(snapshot.toString('base64'), firstCheckpoint.state);

  await server.close(); server = await start(directory);
  owner = await (await session(server, 'changes', 'Reader')).json();
  assert.deepEqual(await records(version2.id), [second]);
  assert.deepEqual(await records(version3.id), [future]);
});

test('Changes API storage rejects duplicate-ID conflicts and inconsistent checkpoint state', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'changes-invalid-'));
  const server = await start(directory); const fixture = changesFixture();
  t.after(async () => { fixture.doc.destroy(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  const owner = await (await session(server, 'invalid', 'Alice')).json();
  await initialize(server, 'invalid', owner);
  const record = fixture.edit('Alice', ' new');
  const upload = (value) => fetch(`${server.url}/api/rooms/invalid/changes`, {
    method: 'POST', headers: { ...authorization(owner), 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  assert.equal((await upload([record])).status, 200);
  const other = fixture.edit('Bob', ' other');
  assert.equal((await upload([{ ...other, id: record.id }])).status, 409);
  assert.equal((await upload([{ ...record, update: 'invalid' }])).status, 400);
  const form = new FormData();
  form.set('document', new Blob([await readFile(new URL('../public/document.docx', import.meta.url))]), 'document.docx');
  form.set('checkpoint', JSON.stringify({ ...fixture.checkpoint(null), stateVector: 'AA==' }));
  const response = await fetch(`${server.url}/api/rooms/invalid/versions`, {
    method: 'POST', headers: { ...authorization(owner), 'X-Version-Id': randomUUID() }, body: form,
  });
  assert.equal(response.status, 400);
});

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
