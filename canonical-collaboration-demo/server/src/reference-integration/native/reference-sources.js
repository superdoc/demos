import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { preserveCitationImport, preserveSourceAliases, referenceSourceRecord } from '../workarounds/citation-import.js';

const scalarFields = ['title', 'year', 'publisher', 'city', 'journalName', 'volume', 'issue', 'pages', 'url', 'doi', 'edition', 'medium', 'shortTitle', 'standardNumber'];
const peopleFields = ['authors', 'editor', 'translator'];
const stable = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, normalize(value[key])]));
}
export function nativeSourceFields(fields = {}) {
  const { corporateAuthor, ...native } = fields;
  if (corporateAuthor !== undefined) native.authors = corporateAuthor ? [{ last: corporateAuthor }] : [];
  return normalize(native);
}
export function requireSourceSuccess(result) {
  if (result?.success === false || result?.ok === false) {
    const error = new Error(result.failure?.message ?? result.error ?? 'Native reference operation failed.');
    error.code = result.failure?.code ?? result.code;
    throw error;
  }
  return result;
}

// The SDK owns live source records. This class retains only Word tags/opaque XML
// needed for importing older documents and for lossless export.
export class NativeReferenceSources {
  #handle;
  #imported;
  #metadata = new Map();
  #ready;

  constructor(handle, imported) {
    this.#handle = handle;
    this.#imported = imported;
  }

  ready() {
    return this.#ready ??= this.#initialize();
  }

  async #read() {
    const items = [];
    let evaluatedRevision;
    for (let offset = 0; ;) {
      const page = await this.#handle.citations.sources.list({ limit: 100, offset });
      if (evaluatedRevision !== undefined && evaluatedRevision !== page.evaluatedRevision) throw new Error('The document changed while reading sources. Read the reference library again.');
      evaluatedRevision = page.evaluatedRevision;
      items.push(...page.items);
      offset += page.items.length;
      if (!page.items.length || offset >= page.total) break;
    }
    return { items, evaluatedRevision };
  }

  async #initialize() {
    if (!this.#imported.records.length) return;
    const native = await this.#read();
    const byId = new Map(native.items.map(item => [item.sourceId, item]));
    const aliases = new Map(Object.entries(this.#imported.aliases ?? {}));
    const preserved = new Map(Object.entries(this.#imported.preservedSources ?? {}));
    const originalTags = new Map([...aliases].map(([tag, id]) => [id, tag]));
    const assigned = new Set();
    const matches = new Map();
    // Resolve persisted identities before considering metadata matches.
    for (const record of this.#imported.records) {
      const source = byId.get(aliases.get(record.tag) ?? record.tag);
      if (source) {
        if (assigned.has(source.sourceId)) throw new Error('Conflicting imported source identities. Each Word reference must map to one native source.');
        matches.set(record, source); assigned.add(source.sourceId);
      }
    }
    for (const record of this.#imported.records) {
      if (matches.has(record)) continue;
      const candidates = native.items.filter(item => !assigned.has(item.sourceId) && item.type === record.type
        && stable(nativeSourceFields(item.fields)) === stable(nativeSourceFields(record.fields)));
      if (candidates.length > 1) throw new Error(`Multiple native sources match imported reference "${record.tag}". Reconcile their identities before opening this document.`);
      if (candidates[0]) { matches.set(record, candidates[0]); assigned.add(candidates[0].sourceId); }
    }
    for (const record of this.#imported.records) {
      let source = matches.get(record);
      if (!source) {
        const result = requireSourceSuccess(await this.#handle.citations.sources.insert({ type: record.type, fields: nativeSourceFields(record.fields) }));
        if (!result.source?.sourceId) throw new Error('Native source insertion did not return a sourceId.');
        source = result.source;
      }
      const tag = originalTags.get(record.tag) ?? record.tag;
      this.#metadata.set(source.sourceId, referenceSourceRecord({ tag }, preserved.get(source.sourceId) ?? record));
    }
    // Existing Word fields refer to original tags. Register the sources through
    // the native API, then remap only their instructions, preserving displayed
    // text, pending revisions, and the SDK's persisted native source state.
    let remapped = [...this.#metadata].some(([id, record]) => aliases.get(record.tag) !== id);
    if (!remapped && [...this.#metadata].some(([id, record]) => id !== record.tag)) {
      for (let offset = 0; ;) {
        const page = await this.#handle.citations.list({ limit: 100, offset });
        remapped ||= page.items.some(citation => citation.sourceIds.some(id => aliases.has(id) && aliases.get(id) !== id));
        offset += page.items.length;
        if (remapped || !page.items.length || offset >= page.total) break;
      }
    }
    if (remapped) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superdoc-source-import-'));
      try {
        const snapshot = path.join(directory, 'document.docx');
        await this.#handle.save({ out: snapshot, force: true });
        await this.#preserve(snapshot, false);
        await this.#handle.replaceFile(await fs.readFile(snapshot), { timeoutMs: 150_000 });
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    }
  }

  async list() {
    await this.ready();
    return this.#read();
  }

  remember(sourceId, type, fields) {
    const previous = this.#metadata.get(sourceId);
    const record = referenceSourceRecord({ tag: previous?.tag ?? sourceId, type, fields }, previous);
    record.fields = { ...record.fields, ...nativeSourceFields(fields) };
    this.#metadata.set(sourceId, record);
  }

  async preserve(outputPath, { wordTags = false } = {}) {
    await this.ready();
    await this.#preserve(outputPath, wordTags);
  }

  async #preserve(outputPath, wordTags) {
    const { items } = await this.#read();
    const records = [];
    const instructionAliases = new Map();
    const persistedAliases = new Map();
    const active = new Set(items.map(source => source.sourceId));
    for (const id of this.#metadata.keys()) if (!active.has(id)) this.#metadata.delete(id);
    for (const source of items) {
      const previous = this.#metadata.get(source.sourceId);
      const wordTag = previous?.tag ?? source.sourceId;
      const fields = {};
      for (const name of scalarFields) fields[name] = source.fields[name] ?? '';
      // Leave unchanged people XML intact, including corporate author structure.
      for (const name of peopleFields) {
        if (stable(previous?.fields?.[name] ?? []) !== stable(source.fields[name] ?? [])) fields[name] = source.fields[name] ?? [];
      }
      const record = referenceSourceRecord({ tag: wordTag, type: source.type, fields }, previous);
      record.fields = { ...source.fields };
      this.#metadata.set(source.sourceId, record);
      records.push(referenceSourceRecord({ tag: wordTags ? wordTag : source.sourceId }, record));
      instructionAliases.set(wordTags ? source.sourceId : wordTag, wordTags ? wordTag : source.sourceId);
      persistedAliases.set(wordTag, source.sourceId);
    }
    await preserveCitationImport(outputPath, { ...this.#imported, records }, instructionAliases, { canonical: true });
    await preserveSourceAliases(outputPath, persistedAliases, this.#metadata);
  }
}
