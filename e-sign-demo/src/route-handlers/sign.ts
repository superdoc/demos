import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { fileType, loadDocument } from '../helpers';
import { SigningService } from '../services/signing';
import type { SignRequestBody, SignedDocumentResponse } from '../types';

async function docxToPdf(buffer: Buffer, filename = 'document.docx'): Promise<Buffer> {
  const form = new FormData();
  form.append(
    'files',
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    filename,
  );

  const response = await fetch(`${config.gotenbergUrl}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(config.requestTimeout),
  });

  if (!response.ok) throw new Error(`Gotenberg returned HTTP ${response.status}: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

function signedDocumentResponse(buffer: Buffer): SignedDocumentResponse {
  return {
    document: {
      base64: buffer.toString('base64'),
      contentType: 'application/pdf',
    },
  };
}

export async function handleSignRequest(
  request: FastifyRequest<{ Body: SignRequestBody }>,
  reply: FastifyReply,
) {
  try {
    let input = await loadDocument(request.body.document);
    const type = fileType(input);

    if (type === 'docx') {
      input = await docxToPdf(input, request.body.document.filename);
    } else if (type !== 'pdf') {
      return reply.code(422).send({ code: 'INVALID_FILE', message: 'Document must be PDF or DOCX' });
    }

    const signingService = new SigningService(config);
    const signed = await signingService.signDocument(input, {
      ...request.body,
      filename: request.body.document.filename,
      signer: {
        ...request.body.signer,
        ip: request.body.signer.ip || request.ip,
        userAgent: request.body.signer.userAgent || request.headers['user-agent'],
      },
    });

    return signedDocumentResponse(signed);
  } catch (error) {
    request.log.error(error);
    const message = error instanceof Error ? error.message : 'Unable to sign document';
    return reply.code(400).send({ code: 'SIGN_FAILED', message });
  }
}
