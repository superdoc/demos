import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { fileType, loadDocument } from '../helpers';
import { SigningService } from '../services/signing';
import type { PublicKeyResponse, VerifyRequestBody } from '../types';

export async function handleVerifyRequest(
  request: FastifyRequest<{ Body: VerifyRequestBody }>,
  reply: FastifyReply,
) {
  try {
    const input = await loadDocument(request.body.document);
    if (fileType(input) !== 'pdf') {
      return reply.code(422).send({ code: 'INVALID_FILE', message: 'Document must be PDF' });
    }
    const signingService = new SigningService(config);
    return signingService.verifyDocument(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify document';
    return reply.code(400).send({ code: 'VERIFY_FAILED', message });
  }
}

export function handleGetPublicKeyRequest(): PublicKeyResponse {
  const signingService = new SigningService(config);
  const { publicKey, fingerprint, version, ephemeral } = signingService.getPublicKeyInfo();
  const year = new Date().getFullYear();
  return {
    version,
    algorithm: 'RSA-SHA256',
    publicKey,
    fingerprint,
    validFrom: `${year}-01-01`,
    validTo: `${year}-12-31`,
    issuer: 'E-Sign Standalone',
    ephemeral,
  };
}
