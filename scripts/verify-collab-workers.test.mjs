import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collabWorkers, verifyCollabWorkers } from './verify-collab-workers.mjs';

const workers = [{ pathname: '/collab/assets/dom-worker-entry-buildhash.js', bytes: Buffer.from('self.postMessage("hello")') }];
const options = { workers, attempts: 1, wait: async () => {}, log: () => {} };
const javascript = (bytes = workers[0].bytes) => new Response(bytes, { headers: { 'content-type': 'application/javascript; charset=utf-8' } });

test('discovers the emitted editor workers and requires them in the release bundle', async (t) => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'collab-workers-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const directory = path.join(output, 'collab/assets');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'app.js'), 'application');
  await assert.rejects(collabWorkers(output), /no collaboration editor workers/);
  await writeFile(path.join(directory, 'dom-worker-entry-buildhash.js'), workers[0].bytes);
  await writeFile(path.join(directory, 'browser-worker-entry-buildhash.js'), 'browser');
  assert.deepEqual((await collabWorkers(output)).map((worker) => worker.pathname), [
    '/collab/assets/browser-worker-entry-buildhash.js', workers[0].pathname,
  ]);
});

test('checks exact browser URLs, MIME type, and complete release bytes on production or staging', async () => {
  for (const origin of ['https://demos.superdoc.dev', 'https://build.superdoc-demos.pages.dev']) {
    assert.deepEqual(await verifyCollabWorkers({ ...options, origin, fetchImpl: async (url, request) => {
      assert.equal(url.href, origin + workers[0].pathname);
      assert.equal(request.redirect, 'error');
      assert.ok(request.signal instanceof AbortSignal);
      return javascript();
    } }), [workers[0].pathname]);
  }
});

test('rejects missing files, HTML fallbacks, truncated files, and stale bytes', async () => {
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }),
    javascript(workers[0].bytes.subarray(0, 4)),
    javascript(Buffer.alloc(workers[0].bytes.length)),
  ]) {
    await assert.rejects(verifyCollabWorkers({ ...options, fetchImpl: async () => response }), /worker verification failed/);
  }
});

test('retries temporary delivery failures but fails persistent timeouts', async () => {
  let calls = 0;
  await verifyCollabWorkers({ ...options, attempts: 2, fetchImpl: async () => {
    if (++calls === 1) throw new Error('Delivery timed out');
    return javascript();
  } });
  assert.equal(calls, 2);
  await assert.rejects(verifyCollabWorkers({ ...options, attempts: 2, timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => {}, 50);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }),
  }), /worker verification failed/);
});

test('reports all failed worker URLs and refuses an empty check', async () => {
  await assert.rejects(verifyCollabWorkers({ ...options, workers: [...workers, { ...workers[0], pathname: '/collab/assets/browser-worker-entry-other.js' }],
    fetchImpl: async () => new Response('missing', { status: 404 }),
  }), (error) => error.errors.length === 2 && error.message.includes('dom-worker-entry') && error.message.includes('browser-worker-entry'));
  await assert.rejects(verifyCollabWorkers({ ...options, workers: [] }), /No collaboration editor workers/);
});
