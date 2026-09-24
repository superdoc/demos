import crypto from 'node:crypto';
import type { KeyConfig, PublicKeyInfo, SignerRecord } from '../types';

export class CryptoService {
  static #generatedKeys: { privateKey: string; publicKey: string } | undefined;

  #keys: { privateKey: string; publicKey: string; ephemeral: boolean };

  constructor({ privateKey, publicKey }: KeyConfig) {
    if (privateKey && publicKey) {
      this.#keys = { privateKey, publicKey, ephemeral: false };
      return;
    }

    if (!CryptoService.#generatedKeys) {
      CryptoService.#generatedKeys = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      console.warn('Using an ephemeral RSA key. Set ESIGN_PRIVATE_KEY and ESIGN_PUBLIC_KEY before production use.');
    }

    this.#keys = { ...CryptoService.#generatedKeys, ephemeral: true };
  }

  // Returns public metadata identifying the active signing key.
  getPublicKeyInfo(): PublicKeyInfo {
    return {
      publicKey: this.#keys.publicKey,
      fingerprint: this.#fingerprint(this.#keys.publicKey),
      version: this.#keyVersion(),
      ephemeral: this.#keys.ephemeral,
    };
  }

  // Produces a hexadecimal SHA-256 digest for documents and audit data.
  hash(value: string | Buffer): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  // Creates the canonical payload containing the document, signer, and audit data.
  createPayload(documentHash: string, signer: SignerRecord): string {
    return JSON.stringify({
      document_hash: documentHash,
      signer: {
        email: signer.email,
        name: signer.name,
        signed_at: signer.signed_at,
        signature_method: signer.signature_method,
      },
      audit_trail_hash: this.hash(JSON.stringify(signer.audit_trail)).slice(0, 16),
    });
  }

  // Signs the canonical payload with the active RSA private key and returns base64.
  signPayload(payload: string): string {
    return crypto.sign('sha256', Buffer.from(payload), this.#keys.privateKey).toString('base64');
  }

  // Returns the annual signing-key version used in envelope metadata.
  #keyVersion(): string {
    const suffix = process.env.NODE_ENV === 'production' ? '' : '-dev';
    return `v${new Date().getFullYear()}${suffix}`;
  }

  // Creates a short human-readable fingerprint for identifying a public key.
  #fingerprint(publicKey: string): string {
    return this.hash(publicKey).toUpperCase().match(/.{2}/g)!.slice(0, 16).join(':');
  }
}
