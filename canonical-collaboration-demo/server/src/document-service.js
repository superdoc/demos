import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentToolkit, SuperDocClient } from '@superdoc/sdk';
import { logEvent } from './logging.js';
import { readCitationImport, preserveCitationImport } from './citation-import.js';
import { preserveDocxNamespaces, renderReferenceFields } from './reference-rendering.js';
import { insertFootnoteInSnapshot } from './footnote-insert.js';

export class Document {
  #handle;
  #toolkit;
  #onClose;
  #closed = false;
  #importedCitations;
  #citationAliases = new Map();
  #referenceQueue = Promise.resolve();
  #referencePending = 0;
  #bibliographyStyle;

  constructor({ id, filename, path, handle, toolkit, onClose, importedCitations }) {
    this.id = id;
    this.filename = filename;
    this.path = path;
    this.generation = 1;
    this.#handle = handle;
    this.#toolkit = toolkit;
    this.#onClose = onClose;
    this.#importedCitations = importedCitations;
    this.#bibliographyStyle = importedCitations.style;
  }

  get referenceBusy() { return this.#referencePending > 0; }

  waitForReferences() { return this.#referenceQueue; }

  #referenceMutation(action) {
    this.#referencePending += 1;
    const result = this.#referenceQueue.then(action).finally(() => { this.#referencePending -= 1; });
    this.#referenceQueue = result.catch(() => {});
    return result;
  }

  async initializeCitationSources() {
    const current = await this.citationSources();
    for (const source of this.#importedCitations.records) {
      if (current.items.some((item) => item.sourceId === source.tag)) continue;
      const result = await this.#handle.citations.sources.insert({ type: source.type, fields: source.fields });
      if (!result.success) throw new Error(`Could not import reference "${source.tag}": ${result.failure.message}`);
      this.#citationAliases.set(result.source.sourceId, source.tag);
    }
  }

  async replace(filename, documentPath) {
    this.#requireOpen();
    const importedCitations = await readCitationImport(await fs.readFile(documentPath));
    await this.#handle.replaceFile(documentPath, { timeoutMs: 150_000 });
    this.#importedCitations = importedCitations;
    this.#bibliographyStyle = importedCitations.style;
    this.#citationAliases.clear();
    await this.initializeCitationSources();
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

  async citationSources() {
    this.#requireOpen();
    const items = [];
    let page;
    do {
      page = await this.#handle.citations.sources.list({ limit: 100, offset: items.length });
      items.push(...page.items);
    } while (page.items.length && items.length < page.total);
    return { items: items.map((item) => {
      const tag = this.#citationAliases.get(item.sourceId);
      if (!tag) return item;
      const source = this.#importedCitations.records.find((record) => record.tag === tag);
      return { ...item, id: tag, sourceId: tag, address: { ...item.address, sourceId: tag }, tag, fields: source.fields };
    }), evaluatedRevision: page.evaluatedRevision, bibliographyStyle: this.#bibliographyStyle };
  }

  createCitationSource(input) {
    this.#requireOpen();
    return this.#handle.citations.sources.insert(input);
  }

  insertCitation(input) {
    this.#requireOpen();
    return this.#referenceMutation(async () => {
      const sourceIds = input.sourceIds.map((id) => [...this.#citationAliases].find(([, tag]) => tag === id)?.[0] ?? id);
      const result = await this.#handle.citations.insert({ ...input, sourceIds });
      if (!result.success) return result;
      try {
        await this.#applyReferenceStyle(this.#bibliographyStyle);
      } catch (error) {
        return { ...result, formattingWarning: `Citation inserted. Formatting could not finish: ${error.message}` };
      }
      return result;
    });
  }

  setBibliographyStyle(style, expectedRevision) {
    return this.#referenceMutation(() => this.#applyReferenceStyle(style, expectedRevision));
  }

  insertFootnote(input) {
    return this.#referenceMutation(async () => {
      this.#requireOpen();
      const start = await this.#handle.citations.sources.list({ limit: 1 });
      if (start.evaluatedRevision !== input.expectedRevision) throw new Error('The document changed. Try inserting the footnote again.');
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-footnote-'));
      try {
        const snapshot = path.join(directory, 'document.docx');
        await this.#writeSnapshot(snapshot);
        const result = await insertFootnoteInSnapshot(snapshot, input);
        const current = await this.#handle.citations.sources.list({ limit: 1 });
        if (current.evaluatedRevision !== start.evaluatedRevision) throw new Error('The document changed during insertion. Try again.');
        const bytes = await fs.readFile(snapshot);
        const imported = await readCitationImport(bytes);
        await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
        this.#importedCitations = imported;
        this.#citationAliases.clear();
        await this.initializeCitationSources();
        return result;
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }

  async #writeSnapshot(outputPath) {
    const result = await this.#handle.save({ out: outputPath, force: true });
    await preserveDocxNamespaces(outputPath, this.path);
    await preserveCitationImport(outputPath, this.#importedCitations, this.#citationAliases);
    return result;
  }

  async #applyReferenceStyle(style, expectedRevision) {
    this.#requireOpen();
    if (!['APA', 'Chicago', 'MLA'].includes(style)) throw new Error('Choose APA, Chicago, or MLA.');
    const start = await this.#handle.citations.sources.list({ limit: 1 });
    if (expectedRevision && start.evaluatedRevision !== expectedRevision) throw new Error('The document revision changed. Try choosing the style again.');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-references-'));
    try {
      const snapshot = path.join(directory, 'document.docx');
      await this.#writeSnapshot(snapshot);
      await renderReferenceFields(snapshot, { style });
      const current = await this.#handle.citations.sources.list({ limit: 1 });
      if (current.evaluatedRevision !== start.evaluatedRevision) throw new Error('The document revision changed during formatting. Try again.');
      const bytes = await fs.readFile(snapshot);
      const imported = await readCitationImport(bytes);
      await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
      this.#importedCitations = imported;
      this.#citationAliases.clear();
      this.#bibliographyStyle = style;
      await this.initializeCitationSources();
      return { success: true, bibliographyStyle: style };
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async save(outputPath, { fieldCodes = false } = {}) {
    this.#requireOpen();
    await this.#referenceQueue;
    const result = await this.#writeSnapshot(outputPath);
    if (fieldCodes) await renderReferenceFields(outputPath, { style: this.#bibliographyStyle, fieldCodes: true });
    return result;
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
    const importedCitations = await readCitationImport(await fs.readFile(path));
    const handle = await this.#client.open({ doc: path, collaboration }, { timeoutMs: 150_000 });
    const document = new Document({
      id,
      filename,
      path,
      handle,
      toolkit: this.#toolkit,
      importedCitations,
      onClose: (documentId) => this.#documents.delete(documentId),
    });
    try {
      await document.initializeCitationSources();
    } catch (error) {
      await handle.close({ discard: true });
      throw error;
    }
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
