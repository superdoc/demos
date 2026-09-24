import zlib from 'node:zlib';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import type { KeyConfig, SignatureEnvelope, SignerRecord, SigningEvent, VerificationResponse } from '../types';
import { CryptoService } from './crypto';

const ENVELOPE_PREFIX = 'SDENV1:';
const SUBJECT = PDFName.of('Subject');
const MAX_ENVELOPE_BYTES = 32 * 1024 * 1024;

export class SigningService {
  #crypto: CryptoService;

  constructor(keyConfig: KeyConfig) {
    this.#crypto = new CryptoService(keyConfig);
  }

  // Returns public metadata identifying the active signing key.
  getPublicKeyInfo() {
    return this.#crypto.getPublicKeyInfo();
  }

  // Adds a signer and cryptographic signature, then embeds the updated envelope and certificate.
  async signDocument(pdfBuffer: Buffer, event: SigningEvent): Promise<Buffer> {
    const existingEnvelope = await this.readDocumentEnvelope(pdfBuffer);
    const preparedPdf = await this.#preparePdf(pdfBuffer, existingEnvelope);
    const signer = this.#createSigner(event);
    const envelope = this.#createOrUpdateEnvelope(preparedPdf, existingEnvelope, signer, event);

    return this.#embedSignedEnvelope(preparedPdf, envelope, event.certificate);
  }

  // Validates every signature in the embedded envelope using the configured private key.
  async verifyDocument(pdfBuffer: Buffer): Promise<VerificationResponse> {
    const envelope = await this.readDocumentEnvelope(pdfBuffer);
    if (!envelope) return { valid: false, reason: 'No signature envelope found' };

    const results = envelope.signers.map(
      (signer, index) =>
        this.#crypto.signPayload(this.#crypto.createPayload(envelope.document.original_hash, signer)) ===
        envelope.signatures[index],
    );
    const valid = results.length > 0 && results.every(Boolean);

    return {
      valid,
      reason: valid ? `All ${results.length} signature(s) verified` : 'One or more signatures are invalid',
      document: valid
        ? {
            id: envelope.id,
            hash: envelope.document.original_hash,
            signature_count: results.length,
          }
        : null,
      signer: valid
        ? {
            email: envelope.signers[0].email,
            name: envelope.signers[0].name,
            signed_at: envelope.signers[0].signed_at,
          }
        : null,
    };
  }

  // Reads the current or legacy signing envelope embedded in a PDF.
  async readDocumentEnvelope(pdfBuffer: Buffer): Promise<SignatureEnvelope | null> {
    try {
      return this.#readEnvelope(await PDFDocument.load(pdfBuffer));
    } catch {
      return null;
    }
  }

  // Returns the low-level PDF metadata dictionary used to store the envelope.
  #pdfInfo(pdf: PDFDocument): PDFDict {
    return (pdf as unknown as { getInfoDict(): PDFDict }).getInfoDict();
  }

  // Compresses and stores the signature envelope in the PDF Subject metadata field.
  #writeEnvelope(pdf: PDFDocument, envelope: SignatureEnvelope): void {
    const encoded = ENVELOPE_PREFIX + zlib.gzipSync(Buffer.from(JSON.stringify(envelope))).toString('base64');
    this.#pdfInfo(pdf).set(SUBJECT, PDFString.of(encoded));
  }

  // Reads and decompresses current or legacy signature envelopes from PDF metadata.
  #readEnvelope(pdf: PDFDocument): SignatureEnvelope | null {
    try {
      const raw = this.#pdfInfo(pdf).lookup(SUBJECT);
      let subject;

      if (raw instanceof PDFString) subject = raw.asString();
      if (raw instanceof PDFHexString) {
        const bytes = Buffer.from(raw.asString().replace(/[\0\t\n\f\r ]/g, ''), 'hex');
        subject =
          bytes[0] === 0xfe && bytes[1] === 0xff
            ? Buffer.from(bytes.subarray(2)).swap16().toString('utf16le')
            : bytes.toString('latin1');
      }
      if (!subject) return null;

      const json = subject.startsWith(ENVELOPE_PREFIX)
        ? zlib.gunzipSync(Buffer.from(subject.slice(ENVELOPE_PREFIX.length), 'base64'), {
            maxOutputLength: MAX_ENVELOPE_BYTES,
          })
        : Buffer.from(subject, 'base64');
      return JSON.parse(json.toString('utf8')) as SignatureEnvelope;
    } catch {
      return null;
    }
  }

  // Converts signer values to characters supported by the built-in PDF fonts.
  #printable(value: unknown): string {
    return String(value ?? '').replace(/[^\x20-\x7E]/g, '?');
  }

  // Draws the human-readable audit certificate on a new PDF page.
  async #drawCertificatePage(pdf: PDFDocument, envelope: SignatureEnvelope): Promise<void> {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage();
    const { height } = page.getSize();
    let y = height - 48;

    page.drawText('AUDIT TRAIL CERTIFICATE', { x: 40, y, size: 14, font: bold });
    y -= 30;
    page.drawText(`Document ID: ${envelope.id}`, { x: 40, y, size: 10, font });
    page.drawText(`Signatures: ${envelope.signers.length}`, { x: 330, y, size: 10, font });
    y -= 18;
    page.drawText(`Hash: ${envelope.document.original_hash.slice(0, 24)}...`, { x: 40, y, size: 9, font });
    y -= 28;

    for (const signer of envelope.signers) {
      if (y < 80) break;
      page.drawRectangle({ x: 40, y: y - 38, width: 515, height: 48, color: rgb(0.97, 0.97, 0.97) });
      page.drawText(this.#printable(signer.name), { x: 50, y: y - 5, size: 10, font: bold });
      page.drawText(this.#printable(signer.email), { x: 50, y: y - 20, size: 8, font });
      page.drawText(`Signed: ${this.#printable(signer.signed_at)}`, {
        x: 310,
        y: y - 12,
        size: 8,
        font,
      });
      y -= 58;
    }
  }

  // Appends the optional certificate, embeds the signature envelope, and saves the PDF.
  async #embedSignedEnvelope(
    pdfBuffer: Buffer,
    envelope: SignatureEnvelope,
    options: { enabled?: boolean } = {},
  ): Promise<Buffer> {
    const pdf = await PDFDocument.load(pdfBuffer);
    const certificateEnabled = options.enabled !== false;
    if (certificateEnabled) await this.#drawCertificatePage(pdf, envelope);

    const storedEnvelope = { ...envelope, certificate_page_appended: certificateEnabled };
    pdf.setTitle('Signed Document');
    pdf.setKeywords(['digitally-signed', storedEnvelope.id, `signers-${storedEnvelope.signers.length}`]);
    this.#writeEnvelope(pdf, storedEnvelope);
    return Buffer.from(await pdf.save());
  }

  // Removes the previous generated certificate page before another signer is added.
  async #preparePdf(pdfBuffer: Buffer, existingEnvelope: SignatureEnvelope | null): Promise<Buffer> {
    if (!existingEnvelope?.certificate_page_appended) return pdfBuffer;

    const pdf = await PDFDocument.load(pdfBuffer);
    if (pdf.getPageCount() > 1) pdf.removePage(pdf.getPageCount() - 1);
    return Buffer.from(await pdf.save());
  }

  // Converts the request event into the signer record stored in the envelope.
  #createSigner(event: SigningEvent): SignerRecord {
    const submitted = event.auditTrail.find((item) => item.type === 'submit');
    if (!submitted) throw new Error('auditTrail must contain a submit event');

    return {
      email: event.signer.email,
      name: event.signer.name,
      signed_at: submitted.timestamp,
      signature_method: 'electronic_signature',
      ip: event.signer.ip,
      user_agent: event.signer.userAgent,
      audit_trail: { session_id: event.eventId, events: event.auditTrail },
    };
  }

  // Creates the first envelope or appends a new signer and signature to the existing one.
  #createOrUpdateEnvelope(
    pdfBuffer: Buffer,
    existingEnvelope: SignatureEnvelope | null,
    signer: SignerRecord,
    event: SigningEvent,
  ): SignatureEnvelope {
    const documentHash = existingEnvelope?.document.original_hash || this.#crypto.hash(pdfBuffer);
    const keyInfo = this.#crypto.getPublicKeyInfo();
    const envelope = existingEnvelope || {
      version: '1.0',
      id: documentHash.slice(0, 8).toUpperCase(),
      created_at: new Date().toISOString(),
      document: { original_hash: documentHash, filename: event.filename },
      signing_key: {
        version: keyInfo.version,
        algorithm: 'RSA-SHA256',
        fingerprint: keyInfo.fingerprint,
      },
      signers: [],
      signatures: [],
    };

    return {
      ...envelope,
      signers: [...envelope.signers, signer],
      signatures: [
        ...envelope.signatures,
        this.#crypto.signPayload(this.#crypto.createPayload(documentHash, signer)),
      ],
    };
  }
}
