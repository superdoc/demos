import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ReferenceDocument, prepareReferenceDocument } from '../server/src/reference-integration/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function files(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else result.push(child);
  }
  return result;
}

test('portable server and browser imports stay within their own module boundaries', async () => {
  for (const area of ['server', 'client']) {
    const base = path.join(root, area, 'src/reference-integration');
    for (const file of await files(base)) {
      if (!/\.(?:js|ts|tsx)$/.test(file)) continue;
      const source = await fs.readFile(file, 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s*\(|new URL\(\s*)['"](\.[^'"]+)['"]/g)) {
        const target = path.resolve(path.dirname(file), match[1]);
        assert.ok(target.startsWith(base + path.sep), `${file} escapes to ${target}`);
        if (target.includes('${')) continue;
        const candidates = [target, target + '.ts', target + '.tsx', target + '.js'];
        assert.ok((await Promise.all(candidates.map((p) => fs.access(p).then(() => true, () => false)))).some(Boolean), `Missing ${target}`);
      }
      assert.doesNotMatch(source, /from ['"](?:.*\/)?(?:config|logging|api|Topbar|ChatPanel)(?:\.[jt]sx?)?['"]/);
      assert.doesNotMatch(source, /localhost:|\.document-pane|\.editor-shell/);
    }
  }
});

test('the document lifecycle exposes the native handle and forwards only SDK tools', async () => {
  let dispatched;
  const handle = {};
  const toolkit = { dispatch: (...args) => { dispatched = args; return 'native-result'; } };
  const document = new ReferenceDocument({ id: 'test', filename: 'test.docx', path: 'unused', handle, toolkit,
    importedCitations: { records: [], style: 'APA' } });
  assert.equal(document.handle, handle);
  assert.equal(await document.dispatch('superdoc_api_call', { operationId: 'doc.info' }), 'native-result');
  assert.deepEqual(dispatched, [handle, 'superdoc_api_call', { operationId: 'doc.info' }]);
});

test('portable source mutations serialize and stale queued requests cannot replace a newer revision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-reference-test-'));
  const input = path.join(directory, 'working.docx');
  await fs.copyFile(path.join(root, 'server/assets/blank.docx'), input);
  let current = await fs.readFile(input);
  let revision = 1;
  let applied = 0;
  const importedCitations = await prepareReferenceDocument(input);
  const handle = {
    citations: { sources: { list: async () => ({ evaluatedRevision: String(revision) }) } },
    save: async ({ out }) => fs.writeFile(out, current),
    replaceFile: async (bytes) => { current = bytes; applied++; revision++; },
    close: async () => {},
  };
  const document = new ReferenceDocument({ id: 'synthetic', filename: 'working.docx', path: input, handle,
    toolkit: { dispatch: () => { throw new Error('Custom tools must not use native dispatch.'); } }, importedCitations });
  const create = (title, expectedRevision) => document.manageReferences({
    action: 'create', type: 'report', fields: { title, year: '2026', corporateAuthor: 'Synthetic Organization' }, expectedRevision,
  });
  try {
    const first = create('First report', '1');
    const stale = create('Stale report', '1');
    assert.equal(document.referenceBusy, true);
    const [a, b] = await Promise.allSettled([first, stale]);
    assert.equal(a.status, 'fulfilled');
    assert.equal(a.value.success, true);
    assert.equal(b.status, 'rejected');
    assert.match(b.reason.message, /document changed/i);
    assert.equal(applied, 1);
    assert.equal(document.referenceBusy, false);
    await create('Second report', '2');
    const catalog = await document.citationSources();
    assert.deepEqual(catalog.items.map((source) => source.fields.title), ['First report', 'Second report']);
    assert.equal(catalog.evaluatedRevision, '3');
  } finally {
    await document.waitForReferences();
    await document.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
