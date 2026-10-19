import { readBibliographies } from './workarounds/bibliography-read.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readCitationImport, preserveCitationImport, mutateReferenceSnapshot } from './workarounds/citation-import.js';
import { preserveDocxNamespaces, renderReferenceFields } from './workarounds/reference-rendering.js';
import { insertFootnoteInSnapshot, normalizeFootnoteParts } from './workarounds/footnote-insert.js';
import { footnoteTool, footnoteInstructions, footnoteInput } from './tools/footnote-tool.js';
import { citationTool, citationInstructions, citationInput, referenceLibraryContext } from './tools/citation-tool.js';
import { referenceTool, referenceInstructions, referenceInput } from './tools/reference-tool.js';
import { bibliographyTool, bibliographyInstructions, bibliographyInput } from './tools/bibliography-tool.js';
import { removeBibliographyInSnapshot } from './workarounds/bibliography-remove.js';
import { insertBibliographyInSnapshot } from './workarounds/bibliography-insert.js';
import { removeCitationInSnapshot } from './workarounds/citation-remove.js';
import { insertCitationInSnapshot } from './workarounds/citation-insert.js';
import { resolveReferenceAnchor, verifyInsertedReference } from './workarounds/reference-anchors.js';
import { referenceAnchorInstructions } from './tools/reference-anchor-contract.js';

export class ReferenceDocument {
  #handle;
  #logEvent;
  #toolkit;
  #onClose;
  #closed = false;
  #importedCitations;
  #referenceQueue = Promise.resolve();
  #referencePending = 0;
  #bibliographyStyle;
  #fieldCodes = false;

  constructor({ id, filename, path, handle, toolkit, onClose = () => {}, importedCitations, logEvent = () => {} }) {
    this.#logEvent = logEvent;
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

  async replace(filename, documentPath) {
    this.#requireOpen();
    await normalizeFootnoteParts(documentPath);
    const importedCitations = await readCitationImport(await fs.readFile(documentPath));
    await this.#handle.replaceFile(documentPath, { timeoutMs: 150_000 });
    this.#importedCitations = importedCitations;
    this.#bibliographyStyle = importedCitations.style;
    this.#fieldCodes = false;
    const previousPath = this.path;
    this.filename = filename;
    this.path = documentPath;
    this.generation += 1;
    await fs.rm(previousPath, { force: true }).catch(() => {});
    this.#logEvent('document-service', 'document.replaced', { documentId: this.id, generation: this.generation });
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

  #readBibliographies() {
    return readBibliographies(this.#handle, { style: this.#bibliographyStyle, fieldCodes: this.#fieldCodes,
      readSources: () => this.citationSources() });
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
      if (input.action === 'delete' && input.onlyIfEmpty && !target) return { success: true, removed: false };
      if (input.action !== 'create' && !target) throw new Error('Bibliography not found. Read list for current bibliography IDs.');
      if (input.action === 'delete') {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-bibliography-'));
        try {
          const snapshot = path.join(directory, 'document.docx');
          await this.#writeSnapshot(snapshot);
          const removal = await removeBibliographyInSnapshot(snapshot, input.bibliographyId, { onlyIfEmpty: input.onlyIfEmpty });
          if (!removal.removed) return { success: true, removed: false };
          const current = await this.citationSources();
          if (current.evaluatedRevision !== input.expectedRevision) throw new Error('The document changed during bibliography deletion. Read list and try again.');
          const bytes = await fs.readFile(snapshot);
          const imported = await readCitationImport(bytes);
          await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
          this.#importedCitations = imported;
          return { success: true, action: input.action, ...removal, deletedBibliographyId: input.bibliographyId, ...await this.#readBibliographies() };
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
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-bibliography-insert-'));
      try {
        const snapshot = path.join(directory, 'document.docx');
        await this.#writeSnapshot(snapshot);
        const bibliography = await insertBibliographyInSnapshot(snapshot, input);
        await renderReferenceFields(snapshot, { style, fieldCodes: this.#fieldCodes });
        const current = await this.citationSources();
        if (current.evaluatedRevision !== input.expectedRevision) throw new Error('The document changed during bibliography insertion. Read list and try again.');
        const bytes = await fs.readFile(snapshot);
        const imported = await readCitationImport(bytes);
        await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
        this.#importedCitations = imported;
        this.#bibliographyStyle = style;
        const result = { success: true, action: input.action, bibliography, bibliographyId: bibliography.nodeId,
          bibliographyStyle: style };
        try {
          return { ...result, evaluatedRevision: (await this.citationSources()).evaluatedRevision };
        } catch {
          return { ...result, formattingWarning: 'Bibliography inserted. Re-inspect the document before editing again.' };
        }
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
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
      if (typeof input.expectedRevision !== 'string' || catalog.evaluatedRevision !== input.expectedRevision) {
        throw new Error('The document changed. Inspect it again before inserting the citation.');
      }
      const available = new Set(catalog.items.map((source) => source.sourceId));
      if (!Array.isArray(input.sourceIds) || !input.sourceIds.length || input.sourceIds.some((id) => !available.has(id))) {
        throw new Error('A citation source is not in the document reference library. Use a sourceId from the available references.');
      }
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-citation-insert-'));
      try {
        const snapshot = path.join(directory, 'document.docx');
        await this.#writeSnapshot(snapshot);
        const resolved = input.anchor ? await resolveReferenceAnchor(snapshot, input.anchor) : { at: input.at };
        const inserted = await insertCitationInSnapshot(snapshot, { ...input, at: resolved.at });
        await renderReferenceFields(snapshot, { style: this.#bibliographyStyle, fieldCodes: this.#fieldCodes });
        await verifyInsertedReference(snapshot, { kind: 'citation', ...inserted });
        const placement = resolved.resolvedAnchor ? { resolvedAnchor: { ...resolved.resolvedAnchor, verified: true } } : {};
        const current = await this.citationSources();
        if (current.evaluatedRevision !== catalog.evaluatedRevision) throw new Error('The document changed during citation insertion. Try again.');
        const bytes = await fs.readFile(snapshot);
        const imported = await readCitationImport(bytes);
        await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
        this.#importedCitations = imported;
        // A post-insertion lookup failure must not invite a duplicate insertion.
        try {
          let offset = 0;
          let page;
          do {
            page = await this.#handle.citations.list({ limit: 100, offset });
            const citation = page.items.find((item) => item.instruction.trim() === inserted.instruction
              && item.address.story?.storyType === 'body'
              && item.address.anchor.start.blockId === inserted.blockId
              && item.address.anchor.start.offset === inserted.offset);
            if (citation) return { success: true, citation: citation.address, evaluatedRevision: page.evaluatedRevision, ...placement };
            offset += page.items.length;
          } while (page.items.length && offset < page.total);
          return { success: true, ...placement, formattingWarning: 'Citation inserted. Its address could not be refreshed; inspect the document before editing again.' };
        } catch {
          return { success: true, ...placement, formattingWarning: 'Citation inserted. Re-inspect the document before editing again.' };
        }
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }

  setBibliographyStyle(style, expectedRevision) {
    return this.#referenceMutation(() => this.#applyReferenceStyle(style, expectedRevision));
  }

  removeCitation(input) {
    this.#requireOpen();
    return this.#referenceMutation(async () => {
      const start = await this.citationSources();
      if (start.evaluatedRevision !== input.expectedRevision) throw new Error('The document changed. Try deleting the citation again.');
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-citation-delete-'));
      try {
        const snapshot = path.join(directory, 'document.docx');
        await this.#writeSnapshot(snapshot);
        const result = await removeCitationInSnapshot(snapshot, input);
        const current = await this.citationSources();
        if (current.evaluatedRevision !== start.evaluatedRevision) throw new Error('The document changed during citation deletion. Try again.');
        const bytes = await fs.readFile(snapshot);
        const imported = await readCitationImport(bytes);
        await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
        this.#importedCitations = imported;
        return result;
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
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
        const resolved = input.anchor ? await resolveReferenceAnchor(snapshot, input.anchor) : { at: input.at };
        const result = await insertFootnoteInSnapshot(snapshot, { ...input, at: resolved.at });
        const segment = resolved.at.segments[0];
        await verifyInsertedReference(snapshot, { kind: 'footnote', blockId: segment.blockId, offset: segment.range.start, noteId: result.footnote.noteId });
        const current = await this.#handle.citations.sources.list({ limit: 1 });
        if (current.evaluatedRevision !== start.evaluatedRevision) throw new Error('The document changed during insertion. Try again.');
        const bytes = await fs.readFile(snapshot);
        const imported = await readCitationImport(bytes);
        await this.#handle.replaceFile(bytes, { timeoutMs: 150_000 });
        this.#importedCitations = imported;
        return { ...result, ...(resolved.resolvedAnchor ? { resolvedAnchor: { ...resolved.resolvedAnchor, verified: true } } : {}) };
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }

  async #writeSnapshot(outputPath) {
    const result = await this.#handle.save({ out: outputPath, force: true });
    await preserveDocxNamespaces(outputPath, this.path);
    await normalizeFootnoteParts(outputPath);
    await preserveCitationImport(outputPath, this.#importedCitations, new Map(), { canonical: true });
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
      this.#logEvent('document-service', 'document.closed', { documentId: this.id });
    }
  }

  #requireOpen() {
    if (this.#closed) throw new Error(`Document is closed: ${this.id}`);
  }
}

export function createReferenceToolkit(coreToolkit) {
  return {
    tools: [...coreToolkit.tools, footnoteTool, citationTool, referenceTool, bibliographyTool],
    systemPrompt: `${coreToolkit.systemPrompt}\n\n${footnoteInstructions}\n\n${citationInstructions}\n\n${referenceAnchorInstructions}\n\n${referenceInstructions}\n\n${bibliographyInstructions}`,
  };
}

export async function prepareReferenceDocument(documentPath) {
  await normalizeFootnoteParts(documentPath);
  return readCitationImport(await fs.readFile(documentPath));
}
