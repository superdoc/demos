import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgentToolkit, SuperDocClient } from '@superdoc/sdk';
import { logEvent } from './logging.js';
import { readCitationImport, preserveCitationImport, mutateReferenceSnapshot } from './citation-import.js';
import { preserveDocxNamespaces, renderReferenceFields } from './reference-rendering.js';
import { insertFootnoteInSnapshot, normalizeFootnoteParts } from './footnote-insert.js';
import { footnoteTool, footnoteInstructions, footnoteInput } from './footnote-tool.js';
import { citationTool, citationInstructions, citationInput, referenceLibraryContext } from './citation-tool.js';
import { referenceTool, referenceInstructions, referenceInput } from './reference-tool.js';
import { bibliographyTool, bibliographyInstructions, bibliographyInput } from './bibliography-tool.js';
import { removeBibliographyInSnapshot } from './bibliography-remove.js';

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
  #fieldCodes = false;

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
  get fieldCodes() { return this.#fieldCodes; }

  waitForReferences() { return this.#referenceQueue; }

  #referenceMutation(action) {
    this.#referencePending += 1;
    const result = this.#referenceQueue.then(action).finally(() => { this.#referencePending -= 1; });
    this.#referenceQueue = result.catch(() => {});
    return result;
  }

  async initializeCitationSources() {
    // A reload can retain SDK source metadata whose IDs no longer resolve in V2.
    this.#citationAliases.clear();
    for (const source of this.#importedCitations.records) {
      const result = await this.#handle.citations.sources.insert({ type: source.type, fields: source.fields });
      if (!result.success) throw new Error(`Could not import reference "${source.tag}": ${result.failure.message}`);
      this.#citationAliases.set(result.source.sourceId, source.tag);
    }
  }

  async replace(filename, documentPath) {
    this.#requireOpen();
    await normalizeFootnoteParts(documentPath);
    const importedCitations = await readCitationImport(await fs.readFile(documentPath));
    await this.#handle.replaceFile(documentPath, { timeoutMs: 150_000 });
    this.#importedCitations = importedCitations;
    this.#bibliographyStyle = importedCitations.style;
    this.#fieldCodes = false;
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
    if (tool === footnoteTool.function.name) return this.insertFootnote(footnoteInput(args));
    if (tool === citationTool.function.name) return this.insertCitation(citationInput(args));
    if (tool === referenceTool.function.name) return this.manageReferences(referenceInput(args));
    if (tool === bibliographyTool.function.name) return this.manageBibliographies(bibliographyInput(args));
    return this.#toolkit.dispatch(this.#handle, tool, args);
  }

  async citationSources() {
    this.#requireOpen();
    const { evaluatedRevision } = await this.#handle.citations.sources.list({ limit: 1 });
    return {
      items: this.#importedCitations.records.map((source) => ({
        id: source.tag, sourceId: source.tag, tag: source.tag, type: source.type, fields: source.fields,
        address: { kind: 'entity', entityType: 'citationSource', sourceId: source.tag },
      })),
      evaluatedRevision, bibliographyStyle: this.#bibliographyStyle, fieldCodes: this.#fieldCodes,
    };
  }

  async createCitationSource(input) {
    const result = await this.manageReferences(referenceInput({ action: 'create', type: input.type, fields: input.fields, expectedRevision: input.expectedRevision }));
    return { ...result, source: { ...result.source, kind: 'entity', entityType: 'citationSource' } };
  }

  async #readBibliographies() {
    const items = [];
    let offset = 0;
    let evaluatedRevision;
    do {
      // SDK 2.15 fields.list does not forward a type filter to the runtime.
      const page = await this.#handle.fields.list({ limit: 100, offset });
      if (evaluatedRevision && evaluatedRevision !== page.evaluatedRevision) throw new Error('The document changed while reading bibliographies. Read list again.');
      evaluatedRevision = page.evaluatedRevision;
      for (const field of page.items) {
        if (!/^\s*BIBLIOGRAPHY\b/i.test(field.instruction)) continue;
        const bibliographyId = field.address.blockId;
        if (items.some((item) => item.bibliographyId === bibliographyId)) throw new Error('Multiple bibliography fields share a paragraph and cannot be addressed separately.');
        const target = { kind: 'block', nodeType: 'bibliography', nodeId: bibliographyId };
        const info = await this.#handle.citations.bibliography.get({ target });
        items.push({ ...info, bibliographyId, style: this.#bibliographyStyle, text: field.resolvedText });
      }
      offset += page.items.length;
      if (offset >= page.total || !page.items.length) break;
    } while (true);
    const current = await this.citationSources();
    if (current.evaluatedRevision !== evaluatedRevision) throw new Error('The document changed while reading bibliographies. Read list again.');
    return { items, evaluatedRevision, bibliographyStyle: this.#bibliographyStyle, fieldCodes: this.#fieldCodes };
  }

  async manageBibliographies(input) {
    this.#requireOpen();
    if (['list', 'get'].includes(input.action)) {
      await this.#referenceQueue;
      const catalog = await this.#readBibliographies();
      const bibliography = catalog.items.find((item) => item.bibliographyId === input.bibliographyId);
      if (input.action === 'get' && !bibliography) throw new Error('Bibliography not found. Read list for current bibliography IDs.');
      return { success: true, action: input.action, ...catalog, ...(bibliography ? { bibliography } : {}) };
    }
    return this.#referenceMutation(async () => {
      if (input.changeMode !== 'direct') {
        const error = new Error('Native bibliography mutations currently require Editing mode. No changes were made.');
        error.code = 'BIBLIOGRAPHY_REQUIRES_DIRECT';
        throw error;
      }
      const catalog = await this.#readBibliographies();
      if (catalog.evaluatedRevision !== input.expectedRevision) throw new Error('The document changed. Read list again before editing bibliographies.');
      const target = catalog.items.find((item) => item.bibliographyId === input.bibliographyId)?.address;
      if (input.action !== 'create' && !target) throw new Error('Bibliography not found. Read list for current bibliography IDs.');
      if (input.action === 'delete') {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-bibliography-'));
        try {
          const snapshot = path.join(directory, 'document.docx');
          await this.#writeSnapshot(snapshot);
          await removeBibliographyInSnapshot(snapshot, input.bibliographyId);
          const current = await this.citationSources();
          if (current.evaluatedRevision !== input.expectedRevision) throw new Error('The document changed during bibliography deletion. Read list and try again.');
          const bytes = await fs.readFile(snapshot);
          const imported = await readCitationImport(bytes);
          await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
          this.#importedCitations = imported;
          await this.initializeCitationSources();
          return { success: true, action: input.action, deletedBibliographyId: input.bibliographyId, ...await this.#readBibliographies() };
        } finally {
          await fs.rm(directory, { recursive: true, force: true });
        }
      }
      const style = input.style ?? this.#bibliographyStyle;
      if (input.action === 'update') {
        await this.#applyReferenceStyle(style, input.expectedRevision);
        const current = await this.citationSources();
        return { success: true, action: input.action, bibliography: target, bibliographyId: target.nodeId,
          evaluatedRevision: current.evaluatedRevision, bibliographyStyle: this.#bibliographyStyle };
      }
      const options = { expectedRevision: input.expectedRevision, changeMode: input.changeMode };
      const at = ['before', 'after'].includes(input.position)
        ? { kind: input.position, target: { kind: 'block', nodeType: 'paragraph', nodeId: input.blockId } }
        : { kind: input.position };
      // Native style writes fail in collaboration after inserting the field. The renderer owns style application below.
      const result = await this.#handle.citations.bibliography.insert({ ...options, at });
      if (!result.success) return result;
      let formattingWarning;
      try {
        await this.#applyReferenceStyle(style);
      } catch (error) {
        formattingWarning = `Bibliography ${input.action} succeeded. Rendering could not finish: ${error.message}`;
      }
      const current = await this.citationSources();
      return { ...result, action: input.action, bibliographyId: result.bibliography.nodeId,
        evaluatedRevision: current.evaluatedRevision, bibliographyStyle: this.#bibliographyStyle,
        ...(formattingWarning ? { formattingWarning } : {}) };
    });
  }

  async manageReferences(input) {
    this.#requireOpen();
    const libraryResult = async (sourceId) => {
      const library = JSON.parse(referenceLibraryContext(await this.citationSources()));
      const source = library.references.find((item) => item.sourceId === sourceId);
      return { success: true, action: input.action, ...library, ...(source ? { source } : {}) };
    };
    if (input.action === 'list' || input.action === 'get') {
      await this.#referenceQueue;
      const result = await libraryResult(input.sourceId);
      if (input.action === 'get' && !result.source) throw new Error('Reference not found. Read the current reference library.');
      return result;
    }
    return this.#referenceMutation(async () => {
      const start = await this.citationSources();
      if (start.evaluatedRevision !== input.expectedRevision) throw new Error('The document changed. Read the current reference library before editing it.');
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-reference-library-'));
      try {
        const snapshot = path.join(directory, 'document.docx');
        await this.#writeSnapshot(snapshot);
        const { sourceId } = await mutateReferenceSnapshot(snapshot, input);
        if (input.action !== 'create') await renderReferenceFields(snapshot, { style: this.#bibliographyStyle, fieldCodes: this.#fieldCodes });
        const current = await this.citationSources();
        if (current.evaluatedRevision !== start.evaluatedRevision) throw new Error('The document changed during the reference update. Try again.');
        const bytes = await fs.readFile(snapshot);
        const imported = await readCitationImport(bytes);
        await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
        this.#importedCitations = imported;
        await this.initializeCitationSources();
        return { ...await libraryResult(sourceId), ...(input.action === 'delete' ? { deletedSourceId: sourceId } : {}) };
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }

  insertCitation(input) {
    this.#requireOpen();
    return this.#referenceMutation(async () => {
      const catalog = await this.citationSources();
      if (input.expectedRevision && catalog.evaluatedRevision !== input.expectedRevision) {
        throw new Error('The document changed. Inspect it again before inserting the citation.');
      }
      const available = new Set(catalog.items.map((source) => source.sourceId));
      if (input.sourceIds.some((id) => !available.has(id))) {
        throw new Error('A citation source is not in the document reference library. Use a sourceId from the available references.');
      }
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

  setReferenceDisplay(fieldCodes, expectedRevision) {
    if (typeof fieldCodes !== 'boolean') throw new Error('fieldCodes must be a boolean.');
    return this.#referenceMutation(() => this.#applyReferenceStyle(this.#bibliographyStyle, expectedRevision, { fieldCodes }));
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
    await normalizeFootnoteParts(outputPath);
    await preserveCitationImport(outputPath, this.#importedCitations, this.#citationAliases, { canonical: true });
    return result;
  }

  async #applyReferenceStyle(style, expectedRevision, { fieldCodes = this.#fieldCodes } = {}) {
    this.#requireOpen();
    if (!['APA', 'Chicago', 'MLA'].includes(style)) throw new Error('Choose APA, Chicago, or MLA.');
    const start = await this.#handle.citations.sources.list({ limit: 1 });
    if (expectedRevision && start.evaluatedRevision !== expectedRevision) throw new Error('The document revision changed. Try updating references again.');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-references-'));
    try {
      const snapshot = path.join(directory, 'document.docx');
      await this.#writeSnapshot(snapshot);
      await renderReferenceFields(snapshot, { style, fieldCodes });
      const current = await this.#handle.citations.sources.list({ limit: 1 });
      if (current.evaluatedRevision !== start.evaluatedRevision) throw new Error('The document revision changed during the reference update. Try again.');
      const bytes = await fs.readFile(snapshot);
      const imported = await readCitationImport(bytes);
      await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
      this.#importedCitations = imported;
      this.#bibliographyStyle = style;
      this.#fieldCodes = fieldCodes;
      await this.initializeCitationSources();
      return { success: true, bibliographyStyle: style, fieldCodes };
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async save(outputPath, { fieldCodes = false } = {}) {
    this.#requireOpen();
    await this.#referenceQueue;
    const result = await this.#writeSnapshot(outputPath);
    if (fieldCodes || this.#fieldCodes) await renderReferenceFields(outputPath, { style: this.#bibliographyStyle, fieldCodes });
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
    return {
      tools: [...this.#toolkit.tools, footnoteTool, citationTool, referenceTool, bibliographyTool],
      systemPrompt: `${this.#toolkit.systemPrompt}\n\n${footnoteInstructions}\n\n${citationInstructions}\n\n${referenceInstructions}\n\n${bibliographyInstructions}`,
    };
  }

  async open({ id, filename, path, collaboration }) {
    if (this.#documents.has(id)) throw new Error(`Document is already open: ${id}`);
    await normalizeFootnoteParts(path);
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
