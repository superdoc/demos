import { createAgentToolkit, SuperDocClient } from '@superdoc/sdk';
import { logEvent } from './logging.js';
import { ReferenceDocument as Document, openReferenceDocument } from './reference-integration/index.js';

export { Document };

export class DocumentService {
  #client;
  #toolkits = new Map();
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
    for (const changeMode of ['direct', 'tracked']) {
      this.#toolkits.set(changeMode, await createAgentToolkit({ provider: 'openai', preset: 'full',
        ...(changeMode === 'tracked' ? { enforceChangeMode: 'tracked' } : {}) }));
    }
    logEvent('document-service', 'service.ready');
  }

  getToolkit(changeMode = 'direct') {
    const toolkit = this.#toolkits.get(changeMode);
    if (!toolkit) throw new Error(`Unknown document change mode: ${changeMode}`);
    return toolkit;
  }

  async open({ id, filename, path, collaboration, collaborationAuth }) {
    if (this.#documents.has(id)) throw new Error(`Document is already open: ${id}`);
    const document = await openReferenceDocument({
      client: this.#client, toolkit: this.getToolkit(), id, filename, path, collaboration, collaborationAuth, logEvent,
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
