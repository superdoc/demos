import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFileDocxStore } from './file-docx-store.js';

test('stores and deletes a document snapshot without allowing path traversal', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'collaboration-docx-store-'));
  try {
    const store = createFileDocxStore(directory);
    await store.put('../contract', new Uint8Array([5, 6, 7]));
    assert.deepEqual(await readFile(path.join(directory, '..%2Fcontract.docx')), Buffer.from([5, 6, 7]));
    await store.delete('../contract');
    await assert.rejects(readFile(path.join(directory, '..%2Fcontract.docx')), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
