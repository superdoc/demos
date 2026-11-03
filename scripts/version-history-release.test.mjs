import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createVersionHistoryProxy } from './version-history-proxy.mjs';
import { assembleVersionHistory } from './version-history-release.mjs';

const backend = 'https://version-history.example';

test('the Pages proxy preserves authenticated API uploads, queries, and upstream responses', async () => {
  const bytes = Uint8Array.of(0x50, 0x4b, 0, 255);
  const upstreamResponse = new Response(bytes, { status: 201, headers: { 'Content-Type': 'application/octet-stream' } });
  const proxy = createVersionHistoryProxy(backend, async (request) => {
    assert.equal(request.url, `${backend}/api/rooms/shared/versions?limit=5`);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('authorization'), 'Bearer room-token');
    assert.equal(request.headers.get('x-version-id'), 'snapshot-id');
    assert.equal(request.headers.get('host'), null);
    assert.equal(request.redirect, 'manual');
    assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
    return upstreamResponse;
  });
  const response = await proxy.fetch(new Request('https://demos.superdoc.dev/version-history/api/rooms/shared/versions?limit=5', {
    method: 'POST', headers: { Authorization: 'Bearer room-token', 'X-Version-Id': 'snapshot-id', Host: 'demos.superdoc.dev' }, body: bytes,
  }), {});
  assert.equal(response, upstreamResponse);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('the Pages proxy returns WebSocket upgrades untouched and retains authentication parameters', async () => {
  const upgrade = { status: 101, webSocket: {} };
  const proxy = createVersionHistoryProxy(backend, async (request) => {
    assert.equal(request.url, `${backend}/collaboration?token=room-token`);
    assert.equal(request.headers.get('upgrade'), 'websocket');
    assert.equal(request.headers.get('sec-websocket-protocol'), 'test-protocol');
    return upgrade;
  });
  const response = await proxy.fetch(new Request('https://demos.superdoc.dev/version-history/collaboration?token=room-token', {
    headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': 'test-protocol' },
  }), {});
  assert.equal(response, upgrade);
});

test('the proxy leaves the homepage, other demos, and version-history assets on Pages', async () => {
  const proxy = createVersionHistoryProxy(backend, () => { throw new Error('Unexpected backend request'); });
  for (const route of ['/', '/revisions/', '/version-history/', '/version-history/document.docx', '/version-history/assets/app.js', '/version-history/collaboration-other']) {
    const request = new Request(`https://demos.superdoc.dev${route}`);
    const asset = new Response(route);
    assert.equal(await proxy.fetch(request, { ASSETS: { fetch: (forwarded) => { assert.equal(forwarded, request); return asset; } } }), asset);
  }
});

test('release assembly publishes the unlisted route and scopes Worker invocation to its API and WebSocket', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'version-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'dist');
  await mkdir(path.join(root, 'version-history/dist/assets'), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(output, 'index.html'), '<main>Existing gallery</main>');
  await writeFile(path.join(root, 'version-history/dist/index.html'), '<main>Version history</main>');
  await writeFile(path.join(root, 'version-history/dist/assets/app.js'), 'application');
  await assembleVersionHistory({ root, output, backendUrl: backend });
  assert.equal(await readFile(path.join(output, 'index.html'), 'utf8'), '<main>Existing gallery</main>');
  assert.equal(await readFile(path.join(output, 'version-history/index.html'), 'utf8'), '<main>Version history</main>');
  assert.equal(await readFile(path.join(output, 'version-history/assets/app.js'), 'utf8'), 'application');
  assert.deepEqual(JSON.parse(await readFile(path.join(output, '_routes.json'), 'utf8')), {
    version: 1, include: ['/version-history/api/*', '/version-history/collaboration'], exclude: [],
  });
  const source = await readFile(path.join(output, '_worker.js'), 'utf8');
  const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.equal(typeof worker.default.fetch, 'function');
});

test('release configuration rejects missing or unsafe backend targets before publishing', async () => {
  await assert.rejects(assembleVersionHistory({ root: '/unused', output: '/unused' }), /VERSION_HISTORY_BACKEND_URL/);
  for (const target of ['http://remote.example', 'https://user:password@example.com', 'https://example.com/api', 'https://example.com?token=secret', 'https://example.com/#fragment']) {
    assert.throws(() => createVersionHistoryProxy(target), /HTTPS origin/);
  }
});
