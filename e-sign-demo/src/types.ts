export type DocumentInput = {
  base64?: string;
  url?: string;
  filename?: string;
};

export type AuditEvent = {
  type: 'ready' | 'scroll' | 'field_change' | 'submit';
  timestamp: string;
  field?: string;
  value?: string | boolean;
};

export type SignerInput = {
  name: string;
  email: string;
  ip?: string;
  userAgent?: string;
};

export type SignRequestBody = {
  eventId?: string;
  document: DocumentInput;
  signer: SignerInput;
  auditTrail: AuditEvent[];
  certificate?: { enabled?: boolean };
};

export type SigningEvent = SignRequestBody & {
  filename?: string;
};

export type VerifyRequestBody = {
  document: DocumentInput;
};

export type SignedDocumentResponse = {
  document: {
    base64: string;
    contentType: 'application/pdf';
  };
};

export type VerificationResponse = {
  valid: boolean;
  reason: string;
  document?: {
    id: string;
    hash: string;
    signature_count: number;
  } | null;
  signer?: {
    email: string;
    name: string;
    signed_at: string;
  } | null;
};

export type KeyConfig = {
  privateKey?: string;
  publicKey?: string;
};

export type PublicKeyInfo = {
  publicKey: string;
  fingerprint: string;
  version: string;
  ephemeral: boolean;
};

export type PublicKeyResponse = PublicKeyInfo & {
  algorithm: 'RSA-SHA256';
  validFrom: string;
  validTo: string;
  issuer: string;
};

export type SignerRecord = {
  email: string;
  name: string;
  signed_at: string;
  signature_method: 'electronic_signature';
  ip?: string;
  user_agent?: string;
  audit_trail: {
    session_id?: string;
    events: AuditEvent[];
  };
};

export type SignatureEnvelope = {
  version: string;
  id: string;
  created_at: string;
  document: {
    original_hash: string;
    filename?: string;
  };
  signing_key: {
    version: string;
    algorithm: 'RSA-SHA256';
    fingerprint: string;
  };
  signers: SignerRecord[];
  signatures: string[];
  certificate_page_appended?: boolean;
};
