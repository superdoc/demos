import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collabAssets, verifyCollabAssets } from './verify-collab-assets.mjs';

const assets = [{ pathname: '/collab/assets/engine-buildhash.js', bytes: Buffer.from('self.postMessage("hello")') }];
const options = { assets, attempts: 1, wait: async () => {}, log: () => {} };
const javascript = (bytes = assets[0].bytes) => new Response(bytes, { headers: { 'content-type': 'application/javascript; charset=utf-8' } });

async function fixture(t) {
  const output = await mkdtemp(path.join(os.tmpdir(), 'collab-assets-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const directory = path.join(output, 'collab');
  await mkdir(path.join(directory, '.vite'), { recursive: true });
  await mkdir(path.join(directory, 'assets'));
  const manifest = {
    'index.html': { file: 'assets/app-hash.js', isEntry: true, dynamicImports: ['engine.js'] },
    'engine.js': { file: 'assets/engine-hash.js', assets: ['assets/docx-zip-hash.js', 'assets/fonts.woff2'] },
  };
  const writeManifest = () => writeFile(path.join(directory, '.vite/manifest.json'), JSON.stringify(manifest));
  await writeManifest();
  for (const file of ['app-hash.js', 'engine-hash.js', 'docx-zip-hash.js']) {
    await writeFile(path.join(directory, 'assets', file), file);
  }
  return { output, directory, manifest, writeManifest };
}

test('discovers entry, lazy runtime chunks, and worker assets without requiring old worker filenames', async (t) => {
  const { output } = await fixture(t);
  const result = await collabAssets(output);
  assert.deepEqual(result.map((asset) => asset.pathname), [
    '/collab/assets/app-hash.js', '/collab/assets/docx-zip-hash.js', '/collab/assets/engine-hash.js',
  ]);
  assert.equal(result[2].bytes.toString(), 'engine-hash.js');
});

test('rejects missing manifests, missing runtime files, and manifests without a JavaScript entry', async (t) => {
  const { output, directory, manifest, writeManifest } = await fixture(t);
  await rm(path.join(directory, 'assets/engine-hash.js'));
  await assert.rejects(collabAssets(output), /ENOENT/);
  manifest['index.html'].isEntry = false;
  await writeManifest();
  await assert.rejects(collabAssets(output), /no collaboration JavaScript entry/);
  await rm(path.join(directory, '.vite/manifest.json'));
  await assert.rejects(collabAssets(output), /ENOENT/);
});

test('checks exact browser URLs, MIME type, and complete release bytes on production or staging', async () => {
  for (const origin of ['https://demos.superdoc.dev', 'https://build.superdoc-demos.pages.dev']) {
    assert.deepEqual(await verifyCollabAssets({ ...options, origin, fetchImpl: async (url, request) => {
      assert.equal(url.href, origin + assets[0].pathname);
      assert.equal(request.redirect, 'error');
      assert.ok(request.signal instanceof AbortSignal);
      return javascript();
    } }), [assets[0].pathname]);
  }
});

test('rejects missing files, HTML fallbacks, truncated files, and stale bytes', async () => {
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }),
    javascript(assets[0].bytes.subarray(0, 4)),
    javascript(Buffer.alloc(assets[0].bytes.length)),
  ]) {
    await assert.rejects(verifyCollabAssets({ ...options, fetchImpl: async () => response }), /asset verification failed/);
  }
});

test('retries temporary delivery failures but fails persistent timeouts', async () => {
  let calls = 0;
  await verifyCollabAssets({ ...options, attempts: 2, fetchImpl: async () => {
    if (++calls === 1) throw new Error('Delivery timed out');
    return javascript();
  } });
  assert.equal(calls, 2);
  await assert.rejects(verifyCollabAssets({ ...options, attempts: 2, timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      const timer = setTimeout(() => {}, 50);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    }),
  }), /asset verification failed/);
});

test('reports all failed asset URLs and refuses an empty check', async () => {
  await assert.rejects(verifyCollabAssets({ ...options, assets: [...assets, { ...assets[0], pathname: '/collab/assets/app-other.js' }],
    fetchImpl: async () => new Response('missing', { status: 404 }),
  }), (error) => error.errors.length === 2 && error.message.includes('engine-buildhash') && error.message.includes('app-other'));
  await assert.rejects(verifyCollabAssets({ ...options, assets: [] }), /No collaboration JavaScript assets/);
});
