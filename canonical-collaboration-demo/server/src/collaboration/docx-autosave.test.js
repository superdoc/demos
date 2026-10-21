import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { createDocxAutosave } from './docx-autosave.js';

function fixture(idleMs = 0) {
  const puts = [];
  const deletes = [];
  let opens = 0;
  const autosave = createDocxAutosave({
    serverUrl: 'ws://collaboration.test',
    idleMs,
    token: async () => 'fresh-token',
    docxStore: {
      async put(documentId, bytes) { puts.push({ documentId, bytes: [...bytes] }); },
      async delete(documentId) { deletes.push(documentId); },
    },
    createClient: () => ({
      async open(_input, options) {
        opens += 1;
        assert.equal(options.collaborationAuth.token, 'fresh-token');
        return {
          async save({ out }) { await writeFile(out, new Uint8Array([8, 9])); },
          async close() {},
        };
      },
      async dispose() {},
    }),
  });
  return { autosave, puts, deletes, get opens() { return opens; } };
}

test('debounces changes and flushes the latest DOCX snapshot', async () => {
  const state = fixture(5);
  state.autosave.roomChanged('sd2/v1/contract-42');
  state.autosave.roomChanged('sd2/v1/contract-42');
  await new Promise((resolve) => setTimeout(resolve, 15));
  await state.autosave.flush();
  assert.equal(state.opens, 1);
  assert.deepEqual(state.puts, [{ documentId: 'contract-42', bytes: [8, 9] }]);
  await state.autosave.stop();
});

test('deleting a document cancels pending autosave and removes its snapshot', async () => {
  const state = fixture(60_000);
  state.autosave.roomChanged('sd2/v1/deleted-room');
  await state.autosave.delete('deleted-room');
  assert.equal(state.opens, 0);
  assert.deepEqual(state.puts, []);
  assert.deepEqual(state.deletes, ['deleted-room']);
  await state.autosave.stop();
});
