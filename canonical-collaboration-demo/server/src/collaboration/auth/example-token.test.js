import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollaborationAuthorize, signCollaborationToken, verifyCollaborationToken } from './example-token.js';

const secret = 'a-secure-test-secret-with-32-characters';

test('signs document-scoped collaboration tokens', async () => {
  const token = signCollaborationToken(secret, {
    sub: 'alice',
    documents: ['contract-42'],
    exp: Math.floor(Date.now() / 1000) + 60,
  });
  assert.equal(verifyCollaborationToken(secret, token)?.sub, 'alice');
  const authorize = createCollaborationAuthorize(secret);
  assert.deepEqual(await authorize({ token, documentId: 'contract-42' }), { userId: 'alice', readOnly: false });
  assert.equal(await authorize({ token, documentId: 'other-document' }), null);
});

test('rejects expired and modified tokens', () => {
  const token = signCollaborationToken(secret, { sub: 'alice', documents: '*', exp: 1 });
  assert.equal(verifyCollaborationToken(secret, token, 2_000), null);
  assert.equal(verifyCollaborationToken(secret, `${token.slice(0, -1)}x`, 0), null);
});

test('preserves read-only access and wildcard document scope', async () => {
  const token = signCollaborationToken(secret, {
    sub: 'reviewer', documents: '*', readOnly: true, exp: Math.floor(Date.now() / 1000) + 60,
  });
  const authorize = createCollaborationAuthorize(secret);
  assert.deepEqual(await authorize({ token, documentId: 'any-document' }), {
    userId: 'reviewer', readOnly: true,
  });
  assert.equal(await authorize({ token, documentId: null }), null);
});
