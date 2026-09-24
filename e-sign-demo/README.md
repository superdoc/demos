# E-Sign Standalone

A small TypeScript and Fastify service that converts DOCX documents to PDF, records signing events, adds an optional audit certificate, and verifies documents produced by the service.

## Requirements

- Node.js 20+
- pnpm
- Gotenberg for DOCX conversion; PDF signing does not require it

## Setup

```bash
pnpm install
cp .env.example .env
```

Load the local environment and start the server:

```bash
set -a
source .env
set +a
pnpm start
```

The API and browser client are available at `http://localhost:3000` by default. The browser client can sign a document, download the result, preview the signed PDF, and verify a signed PDF.

For DOCX conversion, start Gotenberg:

```bash
docker run --rm -p 3001:3000 gotenberg/gotenberg:8
```

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `HOST` | HTTP host | `0.0.0.0` |
| `API_KEY` | Optional bearer token protecting `/v1/sign` | Disabled |
| `MAX_FILE_SIZE` | Maximum decoded document size in bytes | 24 MB |
| `REQUEST_TIMEOUT` | URL fetch and conversion timeout in milliseconds | `30000` |
| `GOTENBERG_URL` | Gotenberg base URL | `http://localhost:3001` |
| `ESIGN_PRIVATE_KEY` | PEM RSA private key used to sign and verify | Ephemeral |
| `ESIGN_PUBLIC_KEY` | Matching PEM RSA public key used for identification | Ephemeral |

Never commit real keys or `.env` files. When configured keys are absent, the service generates an in-memory key pair. Documents signed with an ephemeral key cannot be verified after the process restarts.

## Development

```bash
pnpm dev         # Start the TypeScript server in watch mode
pnpm type-check  # Run strict TypeScript checks
pnpm test        # Run the API and legacy-envelope tests
```

The browser client remains plain HTML, CSS, and JavaScript under `public/`. Fastify serves those files with `@fastify/static`.

## Project structure

```text
src/
├── route-handlers/
│   ├── sign.ts          # POST /v1/sign
│   └── verify.ts        # Verification and public-key routes
├── services/
│   ├── crypto.ts        # Key management, hashing, and RSA signing
│   └── signing.ts       # PDF envelopes, certificates, signing, and verification
├── config.ts            # Environment configuration
├── helpers.ts           # Shared document loading and file detection
├── server.ts            # Fastify setup and route registration
└── types.ts             # Shared request, response, key, and envelope types
```

`SigningService` accepts the key configuration and owns an internal `CryptoService`. Its public methods are `signDocument()`, `verifyDocument()`, `readDocumentEnvelope()`, and `getPublicKeyInfo()`.

## Routes

### `GET /health`

Returns service status:

```json
{ "status": "ok" }
```

### `POST /v1/sign`

Accepts a PDF or DOCX as base64 or by URL. DOCX files are converted through Gotenberg. The response contains a base64 PDF with an embedded signing record and, by default, an audit certificate page.

If `API_KEY` is configured, include it in the request header:

```http
Authorization: Bearer <API_KEY>
```

Example body:

```json
{
  "eventId": "example-session-001",
  "document": {
    "filename": "example.docx",
    "base64": "<BASE64_DOCUMENT>"
  },
  "signer": {
    "name": "Example Signer",
    "email": "signer@example.invalid"
  },
  "auditTrail": [
    {
      "type": "ready",
      "timestamp": "2026-01-01T12:00:00.000Z"
    },
    {
      "type": "submit",
      "timestamp": "2026-01-01T12:01:00.000Z"
    }
  ],
  "certificate": {
    "enabled": true
  }
}
```

The audit trail must contain a `submit` event.

The client is responsible for placing visible signature or initials images into the source document before calling this route.

Example response:

```json
{
  "document": {
    "base64": "<BASE64_SIGNED_PDF>",
    "contentType": "application/pdf"
  }
}
```

### `POST /v1/verify`

Verifies the embedded signing record using the configured private key. The service rebuilds and re-signs each canonical signer payload, then compares it with the signature stored in the PDF. This route is public even when `API_KEY` is configured.

```json
{
  "document": {
    "base64": "<BASE64_SIGNED_PDF>"
  }
}
```

Example response:

```json
{
  "valid": true,
  "reason": "All 1 signature(s) verified",
  "document": {
    "id": "A1B2C3D4",
    "hash": "<DOCUMENT_HASH>",
    "signature_count": 1
  },
  "signer": {
    "name": "Example Signer",
    "email": "signer@example.invalid",
    "signed_at": "2026-01-01T12:01:00.000Z"
  }
}
```

### `GET /v1/verify/key`

Returns information about the currently configured signing key:

```json
{
  "version": "v2026-dev",
  "algorithm": "RSA-SHA256",
  "publicKey": "<PEM_PUBLIC_KEY>",
  "fingerprint": "AA:BB:CC:DD:...",
  "validFrom": "2026-01-01",
  "validTo": "2026-12-31",
  "issuer": "E-Sign Standalone",
  "ephemeral": false
}
```

## Notes

- Visible signature images must already be placed in the source document.
- The service records the signer information supplied by the caller; it does not independently authenticate that person.
- The embedded signing record is a custom format, not a standard Adobe/PAdES signature.
- Changing the private key causes documents signed with the previous key to fail verification.
- Verification validates the embedded signing record but does not currently recalculate the visible PDF content hash.
- Legacy base64 envelopes remain readable alongside the current compressed envelope format.
