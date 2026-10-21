import assert from 'node:assert/strict';
import test from 'node:test';

process.env.COLLABORATION_AUTH = 'none';
const { authMode, componentMode, docxMode, storageMode } = await import('./config.js');

test('validates component selections instead of coercing arbitrary strings', () => {
  assert.equal(componentMode('COLLABORATION_API', undefined), 'on');
  assert.equal(componentMode('COLLABORATION_API', 'off'), 'off');
  assert.throws(() => componentMode('COLLABORATION_API', 'false'), /must be "on" or "off"/);
});

test('validates authentication and persistence modes', () => {
  assert.deepEqual(authMode({ COLLABORATION_AUTH: 'none' }), { mode: 'none' });
  assert.deepEqual(authMode({
    COLLABORATION_AUTH: 'example-token',
    COLLABORATION_AUTH_SECRET: 'a-secure-test-secret-with-32-characters',
  }), {
    mode: 'example-token', secret: 'a-secure-test-secret-with-32-characters',
  });
  assert.throws(() => authMode({ COLLABORATION_AUTH: 'example-token' }), /at least 32 characters/);
  assert.equal(storageMode('memory'), 'memory');
  assert.equal(storageMode(undefined), 'file');
  assert.throws(() => storageMode('database'), /must be "file" or "memory"/);
  assert.deepEqual(docxMode({ COLLABORATION_DOCX: 'off' }), { mode: 'off' });
  assert.deepEqual(docxMode({ COLLABORATION_DOCX_IDLE_MS: '25' }), { mode: 'autosave', idleMs: 25 });
  assert.throws(() => docxMode({ COLLABORATION_DOCX_IDLE_MS: '-1' }), /non-negative whole number/);
});
