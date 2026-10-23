import { createHmac, timingSafeEqual } from 'node:crypto';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
const signature = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');

export function signCollaborationToken(secret, claims) {
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${data}.${signature(secret, data)}`;
}
export function verifyCollaborationToken(secret, token, now = Date.now()) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signed] = parts;
  const expected = Buffer.from(signature(secret, `${header}.${body}`));
  const actual = Buffer.from(signed);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    if (decode(header)?.alg !== 'HS256') return null;
    const claims = decode(body);
    if (typeof claims?.sub !== 'string' || typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return null;
    if (claims.documents !== '*' && !(Array.isArray(claims.documents) && claims.documents.every((id) => typeof id === 'string'))) return null;
    return {
      sub: claims.sub,
      documents: claims.documents,
      readOnly: claims.readOnly === true,
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}

export function createCollaborationAuthorize(secret) {
  return ({ token, documentId }) => {
    const claims = verifyCollaborationToken(secret, token);
    if (!claims || documentId === null) return null;
    if (claims.documents !== '*' && !claims.documents.includes(documentId)) return null;
    return { userId: claims.sub, readOnly: claims.readOnly };
  };
}
