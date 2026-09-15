import fs from 'node:fs/promises';
import { createAgentToolkit, SuperDocClient } from '@superdoc/sdk';
import { logEvent } from './logging.js';

export class Document {
  #handle;
  #toolkit;
  #onClose;
  #closed = false;

  constructor({ id, filename, path, handle, toolkit, onClose }) {
    this.id = id;
    this.filename = filename;
    this.path = path;
    this.generation = 1;
    this.#handle = handle;
    this.#toolkit = toolkit;
    this.#onClose = onClose;
  }

  async replace(filename, documentPath) {
    this.#requireOpen();
    await this.#handle.replaceFile(documentPath, { timeoutMs: 150_000 });
    const previousPath = this.path;
    this.filename = filename;
    this.path = documentPath;
    this.generation += 1;
    await fs.rm(previousPath, { force: true }).catch(() => {});
    logEvent('document-service', 'document.replaced', { documentId: this.id, generation: this.generation });
  }

  dispatch(tool, args) {
    this.#requireOpen();
    return this.#toolkit.dispatch(this.#handle, tool, args);
  }

  save(outputPath) {
    this.#requireOpen();
    return this.#handle.save({ out: outputPath, force: true });
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#handle.close({ discard: true });
    } finally {
      this.#onClose(this.id);
      await fs.rm(this.path, { force: true });
      logEvent('document-service', 'document.closed', { documentId: this.id });
    }
  }

  #requireOpen() {
    if (this.#closed) throw new Error(`Document is closed: ${this.id}`);
  }
}

export class DocumentService {
  #client;
  #toolkit;
  #documents = new Map();

  async initialize() {
    this.#client = new SuperDocClient({
      runtime: 'v2',
      startupTimeoutMs: 20_000,
      watchdogTimeoutMs: 180_000,
      defaultChangeMode: 'direct',
      user: { name: 'Document service', email: 'document-service@demo.local' },
    });
    await this.#client.connect();
    this.#toolkit = await createAgentToolkit({ provider: 'openai', preset: 'core' });
    logEvent('document-service', 'service.ready');
  }

  getToolkit() {
    return { tools: this.#toolkit.tools, systemPrompt: this.#toolkit.systemPrompt };
  }

  async open({ id, filename, path, collaboration }) {
    if (this.#documents.has(id)) throw new Error(`Document is already open: ${id}`);
    const handle = await this.#client.open({ doc: path, collaboration }, { timeoutMs: 150_000 });
    const document = new Document({
      id,
      filename,
      path,
      handle,
      toolkit: this.#toolkit,
      onClose: (documentId) => this.#documents.delete(documentId),
    });
    this.#documents.set(id, document);
    logEvent('document-service', 'document.opened', { documentId: id, documents: this.#documents.size });
    return document;
  }

  async close() {
    await Promise.all([...this.#documents.values()].map((document) => document.close().catch(() => {})));
    await this.#client?.dispose().catch(() => {});
    logEvent('document-service', 'service.stopped');
  }
}
