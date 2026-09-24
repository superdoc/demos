import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildApp } from '../src/server';
import { SigningService } from '../src/services/signing';
import type { SignedDocumentResponse } from '../src/types';

const signingService = new SigningService({});

test('signs and verifies a PDF', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const timestamp = new Date().toISOString();
  const signed = await app.inject({
    method: 'POST', url: '/v1/sign',
    payload: {
      eventId: 'test', document: { base64: Buffer.from(await pdf.save()).toString('base64') },
      signer: { name: 'Test Signer', email: 'test@example.com' },
      auditTrail: [{ type: 'ready', timestamp }, { type: 'submit', timestamp }],
    },
  });
  assert.equal(signed.statusCode, 200, signed.body);
  const signedDocument = signed.json<SignedDocumentResponse>();
  const signedEnvelope = await signingService.readDocumentEnvelope(Buffer.from(signedDocument.document.base64, 'base64'));
  assert.ok(signedEnvelope);
  assert.match(signedEnvelope.signing_key.version, /^v\d{4}-dev$/);
  assert.equal('public_key' in signedEnvelope.signing_key, false);
  const verification = await app.inject({
    method: 'POST', url: '/v1/verify',
    payload: { document: { base64: signedDocument.document.base64 } },
  });
  assert.equal(verification.statusCode, 200);
  assert.equal(verification.json().valid, true);
  assert.equal(verification.json().signer.email, 'test@example.com');
});

test('requires a submit audit event', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const response = await app.inject({
    method: 'POST', url: '/v1/sign',
    payload: {
      document: { base64: Buffer.from(await pdf.save()).toString('base64') },
      signer: { name: 'Test Signer', email: 'test@example.com' },
      auditTrail: [{ type: 'ready', timestamp: new Date().toISOString() }],
    },
  });
  assert.equal(response.statusCode, 400);
});

test('reads legacy base64 envelopes stored in PDF metadata', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const envelope = {
    document: { original_hash: 'legacy-hash' },
    signers: [],
    signatures: [],
  };
  pdf.setSubject(Buffer.from(JSON.stringify(envelope)).toString('base64'));

  assert.deepEqual(await signingService.readDocumentEnvelope(Buffer.from(await pdf.save())), envelope);
});
