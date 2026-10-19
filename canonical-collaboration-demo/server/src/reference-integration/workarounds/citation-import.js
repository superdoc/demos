import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const bibliographyNS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
const wordNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relationshipsNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const propertiesNS = 'http://schemas.openxmlformats.org/officeDocument/2006/customXml';
const contentTypesNS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const serializer = new XMLSerializer();
const sourceTypes = {
  Book: 'book', BookSection: 'book', JournalArticle: 'journalArticle', ArticleInAPeriodical: 'journalArticle',
  ConferenceProceedings: 'conferenceProceedings', Report: 'report', InternetSite: 'website',
  DocumentFromInternetSite: 'website', ElectronicSource: 'website', Patent: 'patent', Case: 'case',
  Statute: 'statute', Thesis: 'thesis', Film: 'film', Interview: 'interview', Misc: 'misc',
};
const fieldNames = {
  Title: 'title', Year: 'year', Publisher: 'publisher', City: 'city', JournalName: 'journalName',
  Volume: 'volume', Issue: 'issue', Pages: 'pages', URL: 'url', DOI: 'doi', Edition: 'edition',
  Medium: 'medium', ShortTitle: 'shortTitle', StandardNumber: 'standardNumber',
};

function parse(xml) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function children(element, namespace, name) {
  return Array.from(element.childNodes).filter((child) => child.nodeType === 1
    && child.namespaceURI === namespace && child.localName === name);
}

function text(element, name) {
  return children(element, bibliographyNS, name)[0]?.textContent?.trim();
}

function people(source, role) {
  const author = children(source, bibliographyNS, 'Author')[0];
  const container = author && children(author, bibliographyNS, role)[0];
  if (!container) return undefined;
  const corporate = text(container, 'Corporate');
  if (corporate) return [{ last: corporate }];
  return Array.from(container.getElementsByTagNameNS(bibliographyNS, 'Person')).map((person) => ({
    first: text(person, 'First') || undefined,
    middle: text(person, 'Middle') || undefined,
    last: text(person, 'Last') || '',
  })).filter((person) => person.last);
}

async function catalogs(zip) {
  const result = [];
  for (const file of zip.file(/^customXml\/[^/]+\.xml$/)) {
    const xml = await file.async('string');
    if (!xml.includes(bibliographyNS)) continue;
    const document = parse(xml);
    if (document.documentElement.namespaceURI === bibliographyNS && document.documentElement.localName === 'Sources') {
      result.push({ path: file.name, document, root: document.documentElement });
    }
  }
  return result;
}

export async function readCitationImport(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const records = new Map();
  let template;
  let style = 'APA';
  for (const { root } of await catalogs(zip)) {
    template ??= serializer.serializeToString(root);
    const name = root.getAttribute('StyleName') || root.getAttribute('SelectedStyle');
    if (/chicago/i.test(name)) style = 'Chicago';
    else if (/mla|modern.language/i.test(name)) style = 'MLA';
    for (const source of children(root, bibliographyNS, 'Source')) {
      const tag = text(source, 'Tag');
      if (!tag) continue;
      const fields = {};
      for (const [xmlName, name] of Object.entries(fieldNames)) {
        const value = text(source, xmlName);
        if (value) fields[name] = value;
      }
      fields.authors = people(source, 'Author');
      fields.editor = people(source, 'Editor');
      fields.translator = people(source, 'Translator');
      const record = { tag, type: sourceTypes[text(source, 'SourceType')] ?? 'misc', fields,
        xml: serializer.serializeToString(source) };
      if (records.has(tag) && JSON.stringify(records.get(tag).fields) !== JSON.stringify(fields)) {
        throw new Error(`The document contains conflicting reference records for "${tag}".`);
      }
      records.set(tag, record);
    }
  }
  return { records: [...records.values()], template, style };
}

function element(document, namespace, name, attributes = {}) {
  const result = document.createElementNS(namespace, name);
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  return result;
}

function remapInstruction(instruction, aliases) {
  if (!/^\s*CITATION\s/i.test(instruction)) return instruction;
  return instruction.replace(/"[^"]*"|\S+/g, (token) => {
    const quoted = token.startsWith('"');
    const id = quoted ? token.slice(1, -1) : token;
    const tag = aliases.get(id);
    return tag ? (quoted ? `"${tag}"` : tag) : token;
  });
}

// Keep original Word tags and full source XML when exporting SDK-hydrated references.
export async function preserveCitationImport(outputPath, imported, aliases, { removedTags = new Set(), canonical = false } = {}) {
  if (!imported.records.length && !removedTags.size && !canonical) return;
  const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const existing = await catalogs(zip);
  let primary = existing[0];
  if (!primary) {
    if (!imported.records.length) return;
    const document = parse(imported.template || `<b:Sources xmlns:b="${bibliographyNS}" StyleName="${imported.style || 'APA'}"/>`);
    primary = { document, root: document.documentElement };
    for (const source of children(primary.root, bibliographyNS, 'Source')) primary.root.removeChild(source);
    let index = 1;
    while (zip.file(`customXml/item${index}.xml`) || zip.file(`customXml/itemProps${index}.xml`)) index += 1;
    primary.path = `customXml/item${index}.xml`;

    const relsPath = 'word/_rels/document.xml.rels';
    const rels = parse(await zip.file(relsPath).async('string'));
    rels.documentElement.appendChild(element(rels, relationshipsNS, 'Relationship', {
      Id: `rIdCitation${randomUUID().replaceAll('-', '')}`, Type: `${officeRelationships}customXml`, Target: `../${primary.path}`,
    }));
    zip.file(relsPath, serializer.serializeToString(rels));
    const props = parse(`<ds:datastoreItem xmlns:ds="${propertiesNS}" ds:itemID="{${randomUUID().toUpperCase()}}"><ds:schemaRefs><ds:schemaRef ds:uri="${bibliographyNS}"/></ds:schemaRefs></ds:datastoreItem>`);
    zip.file(`customXml/itemProps${index}.xml`, serializer.serializeToString(props));
    const sourceRels = parse(`<Relationships xmlns="${relationshipsNS}"/>`);
    sourceRels.documentElement.appendChild(element(sourceRels, relationshipsNS, 'Relationship', {
      Id: 'rId1', Type: `${officeRelationships}customXmlProps`, Target: `itemProps${index}.xml`,
    }));
    zip.file(`customXml/_rels/item${index}.xml.rels`, serializer.serializeToString(sourceRels));
    const types = parse(await zip.file('[Content_Types].xml').async('string'));
    types.documentElement.appendChild(element(types, contentTypesNS, 'Override', {
      PartName: `/customXml/itemProps${index}.xml`, ContentType: 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml',
    }));
    zip.file('[Content_Types].xml', serializer.serializeToString(types));
  }

  const originalTags = new Set(imported.records.map((source) => source.tag));
  for (const catalog of existing) {
    for (const source of children(catalog.root, bibliographyNS, 'Source')) {
      const tag = text(source, 'Tag');
      if (canonical || aliases.has(tag) || originalTags.has(tag) || removedTags.has(tag)) catalog.root.removeChild(source);
    }
    if (catalog !== primary) zip.file(catalog.path, serializer.serializeToString(catalog.document));
  }
  for (const record of imported.records) {
    primary.root.appendChild(primary.document.importNode(parse(record.xml).documentElement, true));
  }
  zip.file(primary.path, serializer.serializeToString(primary.document));

  for (const file of zip.file(/^word\/(?!_rels\/).*\.xml$/)) {
    const xml = await file.async('string');
    if (!xml.includes('CITATION')) continue;
    const document = parse(xml);
    for (const field of Array.from(document.getElementsByTagNameNS(wordNS, 'fldSimple'))) {
      const instruction = field.getAttributeNS(wordNS, 'instr');
      field.setAttributeNS(wordNS, 'w:instr', remapInstruction(instruction, aliases));
    }
    for (const instruction of Array.from(document.getElementsByTagNameNS(wordNS, 'instrText'))) {
      instruction.textContent = remapInstruction(instruction.textContent, aliases);
    }
    zip.file(file.name, serializer.serializeToString(document));
  }
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function sourceIsCited(document, tag) {
  const instructions = Array.from(document.getElementsByTagNameNS(wordNS, 'fldSimple')).map((field) => field.getAttributeNS(wordNS, 'instr'));
  const stack = [];
  for (const node of Array.from(document.getElementsByTagNameNS(wordNS, '*'))) {
    if (node.localName === 'fldChar') {
      const type = node.getAttributeNS(wordNS, 'fldCharType');
      if (type === 'begin') stack.push('');
      else if (type === 'end' && stack.length) instructions.push(stack.pop());
    } else if (node.localName === 'instrText' && stack.length) stack[stack.length - 1] += node.textContent;
  }
  return instructions.some((instruction) => {
    const tokens = instruction.match(/"[^"]*"|\S+/g) ?? [];
    return /^CITATION$/i.test(tokens[0] ?? '') && tokens.some((token, index) =>
      (index === 1 || tokens[index - 1] === '\\m') && token.replace(/^"|"$/g, '') === tag);
  });
}

export async function mutateReferenceSnapshot(outputPath, { action, sourceId, type, fields = {} }) {
  const imported = await readCitationImport(await fs.readFile(outputPath));
  const previous = imported.records.find((record) => record.tag === sourceId);
  if (action !== 'create' && !previous) throw new Error('Reference not found. Read the current reference library.');
  if (action === 'delete') {
    const zip = await JSZip.loadAsync(await fs.readFile(outputPath));
    for (const file of zip.file(/^word\/(?!_rels\/).*\.xml$/)) {
      const xml = await file.async('string');
      if (/CITATION/i.test(xml) && sourceIsCited(parse(xml), sourceId)) throw new Error('This reference is still cited in the document. Remove its citation fields before deleting the saved source.');
    }
    imported.records = imported.records.filter((record) => record.tag !== sourceId);
    await preserveCitationImport(outputPath, imported, new Map(), { removedTags: new Set([sourceId]) });
    return { sourceId };
  }

  const tag = previous?.tag ?? `ref_${randomUUID().replaceAll('-', '')}`;
  const document = parse(previous?.xml || `<b:Source xmlns:b="${bibliographyNS}"/>`);
  const root = document.documentElement;
  function set(parent, name, value) {
    for (const old of children(parent, bibliographyNS, name)) parent.removeChild(old);
    if (value === undefined || value === '') return;
    const child = element(document, bibliographyNS, `b:${name}`);
    if (typeof value === 'string') child.textContent = value;
    parent.appendChild(child);
    return child;
  }
  set(root, 'Tag', tag);
  if (type || !previous) {
    const wordType = Object.entries(sourceTypes).find(([, value]) => value === type)?.[0];
    set(root, 'SourceType', wordType || 'Misc');
  }
  if (!previous) set(root, 'Guid', `{${randomUUID().toUpperCase()}}`);
  for (const [xmlName, fieldName] of Object.entries(fieldNames)) {
    if (fieldName in fields) set(root, xmlName, fields[fieldName]);
  }
  for (const [fieldName, role] of [['authors', 'Author'], ['editor', 'Editor'], ['translator', 'Translator']]) {
    if (!(fieldName in fields) && !(fieldName === 'authors' && 'corporateAuthor' in fields)) continue;
    const author = children(root, bibliographyNS, 'Author')[0] || set(root, 'Author', true);
    const container = set(author, role, true);
    if (fieldName === 'authors' && fields.corporateAuthor) set(container, 'Corporate', fields.corporateAuthor);
    else {
      const list = set(container, 'NameList', true);
      for (const person of fields[fieldName] ?? []) {
        const node = element(document, bibliographyNS, 'b:Person');
        for (const name of ['first', 'middle', 'last']) if (person[name]) set(node, name[0].toUpperCase() + name.slice(1), person[name]);
        list.appendChild(node);
      }
    }
  }
  const record = { tag, xml: serializer.serializeToString(root) };
  if (previous) imported.records = imported.records.map((item) => item.tag === tag ? record : item);
  else imported.records.push(record);
  await preserveCitationImport(outputPath, imported, new Map());
  return { sourceId: tag };
}
