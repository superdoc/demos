import fs from 'node:fs/promises';
import JSZip from 'jszip';
import CSL from 'citeproc';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { readCitationImport } from './citation-import.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const B = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
const styles = { APA: 'apa.csl', Chicago: 'chicago-author-date.csl', MLA: 'modern-language-association.csl' };
const styleFiles = new Map();
const serializer = new XMLSerializer();
const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
const nodes = (element, name) => Array.from(element.getElementsByTagNameNS(W, name));
const bibliographyValue = (node, name) => node.getElementsByTagNameNS(B, name)[0]?.textContent?.trim();

export async function preserveDocxNamespaces(outputPath, sourcePath) {
  const [output, source] = await Promise.all([
    fs.readFile(outputPath).then((bytes) => JSZip.loadAsync(bytes)),
    fs.readFile(sourcePath).then((bytes) => JSZip.loadAsync(bytes)),
  ]);
  let changed = false;
  // SDK re-exports can retain prefixed children while dropping their root declarations.
  for (const exported of output.file(/^word\/.*\.xml$/)) {
    const original = source.file(exported.name);
    if (!original) continue;
    const root = parse(await original.async('string')).documentElement;
    const xml = await exported.async('string');
    const repairedXml = xml.replace(/<[A-Za-z_][\w.:-]*(?=[\s/>])[^>]*>/, (opening) => {
      let repaired = opening;
      for (const attribute of Array.from(root.attributes)) {
        if (attribute.name !== 'xmlns' && attribute.prefix !== 'xmlns') continue;
        const escapedName = attribute.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\s${escapedName}\\s*=`).test(opening)) continue;
        const value = attribute.value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
        repaired = repaired.replace(/\/?\s*>$/, (ending) => ` ${attribute.name}="${value}"${ending}`);
      }
      return repaired;
    });
    if (repairedXml !== xml) { output.file(exported.name, repairedXml); changed = true; }
  }
  if (changed) {
    await fs.writeFile(outputPath, await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  }
}

function word(document, name, attributes = {}) {
  const result = document.createElementNS(W, `w:${name}`);
  for (const [key, value] of Object.entries(attributes)) result.setAttributeNS(W, `w:${key}`, String(value));
  return result;
}

function paragraphOf(node) {
  while (node && !(node.namespaceURI === W && node.localName === 'p')) node = node.parentNode;
  return node;
}

function sourceItem(source) {
  const f = source.fields;
  const raw = parse(source.xml);
  const corporations = new Set(Array.from(raw.getElementsByTagNameNS(B, 'Corporate')).map((node) => node.textContent));
  const persons = (people) => people?.map((person) => corporations.has(person.last)
    ? { literal: person.last }
    : { family: person.last, given: [person.first, person.middle].filter(Boolean).join(' ') });
  const types = { book: 'book', journalArticle: 'article-journal', conferenceProceedings: 'paper-conference',
    website: 'webpage', report: 'report', patent: 'patent', case: 'legal_case', statute: 'legislation', thesis: 'thesis', film: 'motion_picture', interview: 'interview', misc: 'document' };
  const item = { id: source.tag, type: types[source.type] ?? 'document', title: f.title || source.tag,
    author: persons(f.authors), editor: persons(f.editor), translator: persons(f.translator),
    publisher: f.publisher, 'publisher-place': f.city, 'container-title': f.journalName || bibliographyValue(raw, 'InternetSiteTitle'),
    volume: f.volume, issue: f.issue, page: f.pages, edition: f.edition, DOI: f.doi, URL: f.url, ISBN: f.standardNumber };
  const year = Number(f.year);
  if (year) {
    const monthName = bibliographyValue(raw, 'Month');
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const month = Number(monthName) || (monthName ? months.indexOf(monthName.toLowerCase()) + 1 : 0);
    const day = Number(bibliographyValue(raw, 'Day'));
    item.issued = { 'date-parts': [[year, ...(month ? [month] : []), ...(month && day ? [day] : [])]] };
  }
  return item;
}

function citationItems(instruction, library) {
  const tokens = instruction.match(/"[^"]*"|\S+/g) ?? [];
  const value = (token) => token?.replace(/^"|"$/g, '');
  const ids = [value(tokens[1])];
  let locator;
  for (let index = 2; index < tokens.length; index += 1) {
    if (tokens[index] === '\\m') ids.push(value(tokens[++index]));
    else if (tokens[index] === '\\p') locator = value(tokens[++index]);
  }
  return ids.filter((id) => library.has(id)).map((id, index) => ({ id, ...(index === 0 && locator ? { locator, label: 'page' } : {}) }));
}

// Field caches are replaced in place; native instructions and revision wrappers survive.
function fields(document) {
  const result = [];
  for (const simple of nodes(document, 'fldSimple')) {
    const instruction = simple.getAttributeNS(W, 'instr');
    if (/^\s*(CITATION|BIBLIOGRAPHY)\b/i.test(instruction)) result.push({ instruction, simple });
  }
  const stack = [];
  for (const run of nodes(document, 'r')) {
    const markers = nodes(run, 'fldChar');
    const instructionText = nodes(run, 'instrText');
    if (!markers.length && !instructionText.length) {
      for (const frame of stack) if (frame.separated) frame.runs.push(run);
    }
    for (const marker of markers) {
      const kind = marker.getAttributeNS(W, 'fldCharType');
      if (kind === 'begin') stack.push({ instruction: '', runs: [], startRun: run });
      if (kind === 'separate' && stack.length) Object.assign(stack[stack.length - 1], { separated: true, separator: run });
      if (kind === 'end' && stack.length) {
        const field = stack.pop();
        field.endRun = run;
        if (field.separator && /^\s*(CITATION|BIBLIOGRAPHY)\b/i.test(field.instruction)) result.push(field);
      }
    }
    if (instructionText.length && stack.length && !stack[stack.length - 1].separated) {
      stack[stack.length - 1].instruction += instructionText.map((node) => node.textContent).join('');
    }
  }
  const positions = new Map();
  let index = 0;
  function visit(node) { positions.set(node, index++); for (const child of Array.from(node.childNodes)) visit(child); }
  visit(document);
  return result.sort((a, b) => positions.get(a.simple || a.startRun) - positions.get(b.simple || b.startRun));
}

function htmlRuns(document, html) {
  const wrapper = parse(`<div>${html.replace(/&nbsp;/g, '&#160;')}</div>`).documentElement;
  const result = [];
  function visit(node, formatting = {}) {
    if (node.nodeType === 3) {
      if (!node.nodeValue || /^[\r\n\t]+$/.test(node.nodeValue)) return;
      const run = word(document, 'r');
      const properties = word(document, 'rPr');
      for (const [name, enabled] of Object.entries(formatting)) if (enabled) properties.appendChild(word(document, name));
      if (properties.childNodes.length) run.appendChild(properties);
      const text = word(document, 't');
      text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      text.textContent = node.nodeValue;
      run.appendChild(text); result.push(run);
      return;
    }
    const tag = node.localName?.toLowerCase();
    const style = node.getAttribute?.('style') || '';
    const next = { ...formatting,
      i: formatting.i || tag === 'i' || tag === 'em' || /font-style:\s*italic/.test(style),
      b: formatting.b || tag === 'b' || tag === 'strong' || /font-weight:\s*bold/.test(style),
      smallCaps: formatting.smallCaps || /font-variant:\s*small-caps/.test(style) };
    for (const child of Array.from(node.childNodes)) visit(child, next);
  }
  visit(wrapper);
  return result;
}

function plainHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function bibliographyLayout(paragraph, layout) {
  if (!layout) return;
  const document = paragraph.ownerDocument;
  let properties = Array.from(paragraph.childNodes).find((node) => node.namespaceURI === W && node.localName === 'pPr');
  if (!properties) { properties = word(document, 'pPr'); paragraph.insertBefore(properties, paragraph.firstChild); }
  for (const [name, values] of Object.entries({
    ind: { left: layout.hangingindent ? 720 : 0, hanging: layout.hangingindent ? 720 : 0 },
    spacing: { before: 0, after: Math.max(0, Number(layout.entryspacing) || 0) * 240,
      line: Math.max(1, Number(layout.linespacing) || 1) * 240, lineRule: 'auto' },
  })) {
    let property = Array.from(properties.childNodes).find((node) => node.namespaceURI === W && node.localName === name);
    if (!property) { property = word(document, name); properties.appendChild(property); }
    for (const [key, value] of Object.entries(values)) property.setAttributeNS(W, `w:${key}`, String(value));
  }
}

function replaceCache(field, entries, bibliography, layout) {
  const document = (field.simple || field.separator).ownerDocument;
  if (field.simple) {
    field.simple.setAttributeNS(W, 'w:dirty', 'false');
    if (bibliography && field.simple.parentNode?.namespaceURI === W && field.simple.parentNode.localName === 'p') {
      const paragraph = field.simple.parentNode;
      const markers = {};
      for (const kind of ['begin', 'instruction', 'separate', 'end']) {
        const run = word(document, 'r');
        if (kind === 'instruction') {
          const instruction = word(document, 'instrText');
          instruction.textContent = field.instruction; run.appendChild(instruction);
        } else run.appendChild(word(document, 'fldChar', { fldCharType: kind }));
        paragraph.insertBefore(run, field.simple); markers[kind] = run;
      }
      paragraph.removeChild(field.simple);
      replaceCache({ instruction: field.instruction, runs: [], startRun: markers.begin,
        separator: markers.separate, endRun: markers.end }, entries, true, layout);
      return;
    }
    while (field.simple.firstChild) field.simple.removeChild(field.simple.firstChild);
    for (const [index, entry] of entries.entries()) {
      if (index) { const run = word(document, 'r'); run.appendChild(word(document, 'br')); field.simple.appendChild(run); }
      for (const run of htmlRuns(document, entry)) field.simple.appendChild(run);
    }
    return;
  }
  for (const marker of nodes(field.startRun, 'fldChar')) {
    if (marker.getAttributeNS(W, 'fldCharType') === 'begin') marker.setAttributeNS(W, 'w:dirty', 'false');
  }
  const paragraphs = new Set(field.runs.map(paragraphOf));
  for (const run of field.runs) run.parentNode?.removeChild(run);
  const firstParagraph = paragraphOf(field.separator);
  const endParagraph = paragraphOf(field.endRun);
  const tail = [];
  for (let node = field.endRun; node; node = node.nextSibling) tail.push(node);
  let anchor = field.separator;
  for (const run of htmlRuns(document, entries[0] || '')) {
    anchor.parentNode.insertBefore(run, anchor.nextSibling); anchor = run;
  }
  if (!bibliography || !firstParagraph || firstParagraph.parentNode !== endParagraph?.parentNode) return;
  bibliographyLayout(firstParagraph, layout);
  let paragraph = firstParagraph;
  for (const entry of entries.slice(1)) {
    const next = word(document, 'p');
    const properties = word(document, 'pPr');
    const paragraphStyle = nodes(firstParagraph, 'pPr')[0]?.getElementsByTagNameNS(W, 'pStyle')[0];
    if (paragraphStyle) properties.appendChild(paragraphStyle.cloneNode(true));
    properties.appendChild(word(document, 'ind', { left: 360, hanging: 360 }));
    properties.appendChild(word(document, 'spacing', { after: 120, line: 276, lineRule: 'auto' }));
    next.appendChild(properties);
    bibliographyLayout(next, layout);
    for (const run of htmlRuns(document, entry)) next.appendChild(run);
    paragraph.parentNode.insertBefore(next, paragraph.nextSibling); paragraph = next;
  }
  if (paragraph !== endParagraph) for (const node of tail) paragraph.appendChild(node);
  paragraphs.add(endParagraph);
  for (const old of paragraphs) {
    if (!old || old === firstParagraph || old === paragraph) continue;
    if (!nodes(old, 't').some((node) => node.textContent.trim()) && !nodes(old, 'fldChar').length) old.parentNode?.removeChild(old);
  }
}

export async function renderReferenceFields(outputPath, { style = 'APA', fieldCodes = false } = {}) {
  if (!styles[style]) throw new Error('Choose APA, Chicago, or MLA.');
  const bytes = await fs.readFile(outputPath);
  const imported = await readCitationImport(bytes);
  const library = new Map(imported.records.map((source) => [source.tag, sourceItem(source)]));
  const zip = await JSZip.loadAsync(bytes);
  const parts = [];
  const allFields = [];
  for (const file of zip.file(/^word\/(?!_rels\/).*\.xml$/)) {
    const xml = await file.async('string');
    if (!/CITATION|BIBLIOGRAPHY/.test(xml)) continue;
    const document = parse(xml);
    const found = fields(document);
    parts.push({ path: file.name, document }); allFields.push(...found);
  }
  const citations = allFields.filter((field) => /^\s*CITATION\b/i.test(field.instruction));
  let bibliography = [];
  let layout;
  const rendered = new Map();
  if (!fieldCodes && library.size) {
    if (!styleFiles.has(style)) styleFiles.set(style, await fs.readFile(new URL(`../assets/csl/${styles[style]}`, import.meta.url), 'utf8'));
    if (!styleFiles.has('locale')) styleFiles.set('locale', await fs.readFile(new URL('../assets/csl/locales-en-US.xml', import.meta.url), 'utf8'));
    const processor = new CSL.Engine({ retrieveLocale: () => styleFiles.get('locale'), retrieveItem: (id) => library.get(id) }, styleFiles.get(style), 'en-US');
    processor.setOutputFormat('html');
    const clusters = citations.map((field, index) => ({ citationID: `citation-${index}`, properties: { noteIndex: 0 }, citationItems: citationItems(field.instruction, library) }));
    const ids = [...new Set(clusters.flatMap((cluster) => cluster.citationItems.map((item) => item.id)))];
    processor.updateItems(ids.length ? ids : [...library.keys()]);
    const preceding = [];
    const indexedFields = [];
    for (const [index, cluster] of clusters.entries()) {
      if (!cluster.citationItems.length) continue;
      indexedFields.push(citations[index]);
      const [, updates] = processor.processCitationCluster(cluster, preceding, []);
      for (const [position, html] of updates) rendered.set(indexedFields[position], html);
      preceding.push([cluster.citationID, 0]);
    }
    const bibliographyResult = processor.makeBibliography();
    layout = bibliographyResult?.[0];
    bibliography = bibliographyResult?.[1] || [];
  }
  for (const field of allFields) {
    const isBibliography = /^\s*BIBLIOGRAPHY\b/i.test(field.instruction);
    if (fieldCodes) replaceCache(field, [plainHtml(`{ ${field.instruction.trim()} }`)], isBibliography);
    else if (isBibliography) replaceCache(field, bibliography.length ? bibliography : [''], true, layout);
    else if (rendered.has(field)) replaceCache(field, [rendered.get(field)], false);
  }
  for (const part of parts) zip.file(part.path, serializer.serializeToString(part.document));
  if (!fieldCodes) {
    for (const file of zip.file(/^customXml\/[^/]+\.xml$/)) {
      const xml = await file.async('string');
      if (!xml.includes(B)) continue;
      const document = parse(xml);
      if (document.documentElement.namespaceURI !== B || document.documentElement.localName !== 'Sources') continue;
      document.documentElement.setAttribute('StyleName', style);
      document.documentElement.setAttribute('SelectedStyle', `/${style === 'Chicago' ? 'Chicago' : style === 'MLA' ? 'MLA' : 'APASeventhEdition'}OfficeOnline.xsl`);
      zip.file(file.name, serializer.serializeToString(document));
    }
  }
  await fs.writeFile(outputPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
