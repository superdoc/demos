import { DOCX, type SuperDoc } from 'superdoc';

export type TemplateVariable = {
  id: string;
  name: string;
} & ({
  type: 'text';
  value: string;
} | {
  type: 'boolean';
  value: boolean;
} | {
  type: 'textList';
  value: string[];
} | {
  type: 'tableRows';
  columns: string[];
  value: Array<Record<string, string>>;
});

export type TemplateVariableValue = TemplateVariable['value'];

export type DiscoveredVariable =
  | { name: string; type: 'text' | 'boolean' }
  | { name: string; type: 'tableRows'; columns: string[] };

export type Interpolation = {
  name: string;
  fallback?: string;
  useFallbackForFalsyValues: boolean;
};

const parseInterpolation = (source: string): Interpolation | null => {
  // Matches {{ name }} and {{ name | default('fallback', true) }} as complete expressions.
  const match = source.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|\s*default\(\s*(['"])((?:\\.|(?!\2).)*)\2\s*(?:,\s*(true|false)\s*)?\))?\s*\}\}$/);
  if (!match) return null;
  return {
    name: match[1],
    fallback: match[3]?.replace(/\\(['"\\])/g, '$1'),
    useFallbackForFalsyValues: match[4] === 'true',
  };
};

const renderInterpolation = (interpolation: Interpolation, values: ReadonlyMap<string, string | boolean>) => {
  const exists = values.has(interpolation.name);
  const value = values.get(interpolation.name);
  const shouldUseFallback = !exists || (interpolation.useFallbackForFalsyValues && !value);
  if (shouldUseFallback) return interpolation.fallback ?? '';
  return String(value ?? '');
};

const discoverTemplateVariables = (text: string): DiscoveredVariable[] => {
  // Discovery populates the variable pane without evaluating or changing template content.
  const discovered = new Map<string, 'text' | 'boolean' | 'tableRows'>();
  const tableRows = new Map<string, string[]>();
  // Matches a complete {%tr for row in rows %}...{%tr endfor %} table-row loop.
  const tableLoopPattern = /\{%\s*tr\s+for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*%\}([\s\S]*?)\{%\s*tr\s+endfor\s*%\}/g;
  for (const match of text.matchAll(tableLoopPattern)) {
    const alias = match[1];
    const name = match[2];
    const columns = new Set<string>();
    // Matches dotted placeholders for this loop alias, such as {{ row.fee }}.
    const columnPattern = new RegExp(`\\{\\{\\s*${alias}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}`, 'g');
    for (const columnMatch of match[3].matchAll(columnPattern)) columns.add(columnMatch[1]);
    tableRows.set(name, [...columns]);
    discovered.set(name, 'tableRows');
  }

  // Matches scalar placeholder names in {{ name }} and {{ name | ... }} expressions.
  const interpolationPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=\||\}\})/g;
  for (const match of text.matchAll(interpolationPattern)) discovered.set(match[1], 'text');

  // Matches opening {% if expression %} and {%p if expression %} directives.
  const ifPattern = /\{%\s*(?:p\s+)?if\s+([\s\S]*?)\s*%\}/g;
  for (const ifMatch of text.matchAll(ifPattern)) {
    const expression = ifMatch[1];
    const expressionTokens = tokenize(expression);
    for (const [index, token] of expressionTokens.entries()) {
      if (token.type !== 'name') continue;
      const previous = expressionTokens[index - 1];
      const next = expressionTokens[index + 1];
      const comparisonValue = next?.type === 'operator' && ['==', '!=', '===', '!=='].includes(next.value as string)
        ? expressionTokens[index + 2]
        : previous?.type === 'operator' && ['==', '!=', '===', '!=='].includes(previous.value as string)
          ? expressionTokens[index - 2]
          : undefined;
      const type = comparisonValue?.type === 'value' && typeof comparisonValue.value !== 'boolean' ? 'text' : 'boolean';
      const name = token.value as string;
      if (type === 'text' || !discovered.has(name)) discovered.set(name, type);
    }
  }

  return Array.from(discovered, ([name, type]) => type === 'tableRows'
    ? { name, type, columns: tableRows.get(name) ?? [] }
    : { name, type });
};

type TableRowLoop = {
  alias: string;
  variableName: string;
  tableOrdinal: number;
  openingRowIndex: number;
  closingRowIndex: number;
  prototypeRows: Array<{ rowIndex: number; cells: string[] }>;
};

type ExtractedBlock = {
  text: string;
  tableContext?: { tableOrdinal: number; rowIndex: number; columnIndex: number };
};

const findTableRowLoops = (blocks: ExtractedBlock[]): TableRowLoop[] => {
  // Rebuild logical table rows from the paragraph blocks returned by document extraction.
  const rows = new Map<string, { tableOrdinal: number; rowIndex: number; cells: Map<number, string> }>();
  for (const block of blocks) {
    const context = block.tableContext;
    if (!context) continue;
    const key = `${context.tableOrdinal}:${context.rowIndex}`;
    const row = rows.get(key) ?? { tableOrdinal: context.tableOrdinal, rowIndex: context.rowIndex, cells: new Map() };
    row.cells.set(context.columnIndex, `${row.cells.get(context.columnIndex) ?? ''}${block.text}`);
    rows.set(key, row);
  }

  const orderedRows = [...rows.values()].sort((a, b) => a.tableOrdinal - b.tableOrdinal || a.rowIndex - b.rowIndex);
  const loops: TableRowLoop[] = [];
  const openings = new Map<number, { alias: string; variableName: string; rowIndex: number }>();
  for (const row of orderedRows) {
    const text = [...row.cells.values()].join('').trim();
    // Matches a directive row containing only {%tr for alias in collection %}.
    const opening = text.match(/^\{%\s*tr\s+for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*%\}$/);
    if (opening) {
      openings.set(row.tableOrdinal, { alias: opening[1], variableName: opening[2], rowIndex: row.rowIndex });
      continue;
    }
    // Matches a directive row containing only {%tr endfor %}.
    if (!/^\{%\s*tr\s+endfor\s*%\}$/.test(text)) continue;
    const start = openings.get(row.tableOrdinal);
    if (!start) throw new Error('A table-row loop has an end tag without a matching start tag.');
    const prototypeRows = orderedRows
      .filter(candidate => candidate.tableOrdinal === row.tableOrdinal && candidate.rowIndex > start.rowIndex && candidate.rowIndex < row.rowIndex)
      .map(candidate => ({
        rowIndex: candidate.rowIndex,
        cells: [...candidate.cells.entries()].sort(([a], [b]) => a - b).map(([, value]) => value),
      }));
    if (!prototypeRows.length) throw new Error(`Table-row loop "${start.variableName}" has no prototype row.`);
    loops.push({
      alias: start.alias,
      variableName: start.variableName,
      tableOrdinal: row.tableOrdinal,
      openingRowIndex: start.rowIndex,
      closingRowIndex: row.rowIndex,
      prototypeRows,
    });
    openings.delete(row.tableOrdinal);
  }
  if (openings.size) throw new Error('A table-row loop is missing its end tag.');
  return loops;
};

type Value = string | number | boolean;
type Token = { type: 'value' | 'name' | 'operator'; value: Value | string };

const tokenize = (source: string): Token[] => {
  // Tokenization accepts only this boolean-expression grammar; arbitrary JavaScript is rejected.
  const tokens: Token[] = [];
  let rest = source;
  while (rest) {
    // Matches leading whitespace between expression tokens.
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) { rest = rest.slice(whitespace.length); continue; }
    // Matches supported symbolic comparison, boolean, negation, and grouping operators.
    const operator = rest.match(/^(===|!==|==|!=|&&|\|\||!|\(|\))/)?.[0];
    if (operator) { tokens.push({ type: 'operator', value: operator }); rest = rest.slice(operator.length); continue; }
    // Matches the word operators and, or, and not at a token boundary.
    const keyword = rest.match(/^(and|or|not)\b/)?.[0];
    if (keyword) { tokens.push({ type: 'operator', value: keyword === 'and' ? '&&' : keyword === 'or' ? '||' : '!' }); rest = rest.slice(keyword.length); continue; }
    // Matches a single- or double-quoted string, including escaped characters.
    const quoted = rest.match(/^(['"])((?:\\.|(?!\1).)*)\1/);
    if (quoted) { tokens.push({ type: 'value', value: quoted[2].replace(/\\(['"\\])/g, '$1') }); rest = rest.slice(quoted[0].length); continue; }
    // Matches boolean literals at a token boundary.
    const boolean = rest.match(/^(true|false)\b/)?.[0];
    if (boolean) { tokens.push({ type: 'value', value: boolean === 'true' }); rest = rest.slice(boolean.length); continue; }
    // Matches signed integers and decimal numbers.
    const number = rest.match(/^-?(?:\d+\.?\d*|\.\d+)/)?.[0];
    if (number) { tokens.push({ type: 'value', value: Number(number) }); rest = rest.slice(number.length); continue; }
    // Matches a template variable identifier.
    const name = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (name) { tokens.push({ type: 'name', value: name }); rest = rest.slice(name.length); continue; }
    throw new Error(`Unsupported token near "${rest.slice(0, 12)}".`);
  }
  return tokens;
};

const evaluateBooleanExpression = (source: string, variables: ReadonlyMap<string, Value>): boolean => {
  // This recursive-descent parser evaluates the restricted tokens without eval or Function.
  const tokens = tokenize(source);
  let cursor = 0;
  const take = (expected?: string) => {
    const token = tokens[cursor];
    if (!token || (expected && token.value !== expected)) throw new Error(expected ? `Expected "${expected}".` : 'Unexpected end of expression.');
    cursor += 1;
    return token;
  };
  const is = (value: string) => tokens[cursor]?.value === value;
  const bool = (value: Value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 0;
    return value !== 0;
  };
  let parseOr: () => Value;
  const primary = (): Value => {
    if (is('(')) { take('('); const value = parseOr(); take(')'); return value; }
    const token = take();
    if (token.type === 'value') return token.value as Value;
    if (token.type === 'name') { const name = token.value as string; return variables.get(name) ?? false; }
    throw new Error(`Unexpected operator "${token.value}".`);
  };
  const not = (): Value => is('!') ? (take('!'), !bool(not())) : primary();
  const equality = (): Value => { const left = not(); const op = tokens[cursor]?.value; if (!['==', '!=', '===', '!=='].includes(op as string)) return left; take(); const equal = Object.is(left, not()); return op === '!=' || op === '!==' ? !equal : equal; };
  const and = (): Value => { let value = equality(); while (is('&&')) { take('&&'); const right = equality(); value = bool(value) && bool(right); } return value; };
  parseOr = () => { let value = and(); while (is('||')) { take('||'); const right = and(); value = bool(value) || bool(right); } return value; };
  const result = parseOr();
  if (cursor !== tokens.length) throw new Error(`Unexpected token "${tokens[cursor].value}".`);
  return bool(result);
};

const findInnermostConditional = (text: string) => {
  // Matches inline/paragraph if, else, and endif tags so nested blocks can be paired.
  const tags = /\{%\s*(?:(p)\s+)?(if\s+([\s\S]*?)|else|endif)\s*%\}/g;
  const stack: Array<{ start: number; contentStart: number; expression: string; paragraphScoped: boolean; elseStart?: number; elseEnd?: number }> = [];
  for (const match of text.matchAll(tags)) {
    const tag = match[2].trim(); const start = match.index; const end = start + match[0].length;
    if (tag.startsWith('if ')) { stack.push({ start, contentStart: end, expression: (match[3] ?? '').trim(), paragraphScoped: match[1] === 'p' }); continue; }
    if (tag === 'else') { const block = stack[stack.length - 1]; if (!block || block.elseStart !== undefined) throw new Error('Unexpected template else tag.'); block.elseStart = start; block.elseEnd = end; continue; }
    const block = stack.pop(); if (!block) throw new Error('Unexpected template endif tag.');
    return { source: text.slice(block.start, end), expression: block.expression, paragraphScoped: block.paragraphScoped, truthyContent: text.slice(block.contentStart, block.elseStart ?? start), falsyContent: block.elseEnd === undefined ? '' : text.slice(block.elseEnd, start) };
  }
  if (stack.length) throw new Error('Template if tag is missing an endif tag.');
  return null;
};

// Escapes user-defined aliases before embedding them in generated regular expressions.
const escapeRegularExpression = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type DocumentMode = 'suggesting' | 'editing' | 'viewing';

export type TemplateVariableSnapshot = {
  variables: readonly TemplateVariable[];
  rendered: boolean;
  rendering: boolean;
};

type TemplateVariableListener = (snapshot: TemplateVariableSnapshot) => void;

/** Owns template-variable state, parsing, rendering, and restoration. */
export class TemplateVariableController {
  private variableState: TemplateVariable[] = [];
  private rendered = false;
  private rendering = false;
  private renderSnapshot: Blob | null = null;
  private modeBeforeRender: DocumentMode = 'editing';
  private readonly listeners = new Set<TemplateVariableListener>();

  constructor(
    private readonly superdoc: SuperDoc,
    private readonly getDocumentName: () => string,
    private readonly onDocumentRestored?: () => Promise<void>,
  ) {}

  get variables(): readonly TemplateVariable[] {
    return this.variableState;
  }

  get isRendered(): boolean {
    return this.rendered;
  }

  subscribe(listener: TemplateVariableListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  add(type: TemplateVariable['type']): void {
    if (type === 'boolean') this.variableState.push({ id: crypto.randomUUID(), type, name: '', value: false });
    else if (type === 'textList') this.variableState.push({ id: crypto.randomUUID(), type, name: '', value: [''] });
    else if (type === 'tableRows') this.variableState.push({ id: crypto.randomUUID(), type, name: '', columns: ['column'], value: [{ column: '' }] });
    else this.variableState.push({ id: crypto.randomUUID(), type, name: '', value: '' });
    this.emit();
  }

  async load(): Promise<void> {
    const text = await this.superdoc.activeEditor?.doc?.getText?.({});
    if (text === undefined) throw new Error('Document text is unavailable.');
    const existingNames = new Set(this.variableState.map(variable => variable.name.trim()).filter(Boolean));
    for (const discovered of discoverTemplateVariables(text)) {
      if (existingNames.has(discovered.name)) continue;
      if (discovered.type === 'boolean') {
        this.variableState.push({ id: crypto.randomUUID(), type: 'boolean', name: discovered.name, value: false });
      } else if (discovered.type === 'tableRows') {
        const emptyRow = Object.fromEntries(discovered.columns.map(column => [column, '']));
        this.variableState.push({ id: crypto.randomUUID(), type: 'tableRows', name: discovered.name, columns: discovered.columns, value: [emptyRow] });
      } else {
        this.variableState.push({ id: crypto.randomUUID(), type: 'text', name: discovered.name, value: '' });
      }
      existingNames.add(discovered.name);
    }
    this.emit();
  }

  remove(id: string): void {
    this.variableState = this.variableState.filter(variable => variable.id !== id);
    this.emit();
  }

  update(id: string, field: 'name' | 'value' | 'columns', value: TemplateVariableValue | string[]): void {
    const variable = this.variableState.find(candidate => candidate.id === id);
    if (!variable) return;
    if (field === 'name' && typeof value === 'string') variable.name = value;
    if (field === 'value' && variable.type === 'text' && typeof value === 'string') variable.value = value;
    if (field === 'value' && variable.type === 'boolean' && typeof value === 'boolean') variable.value = value;
    if (field === 'value' && variable.type === 'textList' && Array.isArray(value)) variable.value = value as string[];
    if (field === 'value' && variable.type === 'tableRows' && Array.isArray(value)) variable.value = value as Array<Record<string, string>>;
    if (field === 'columns' && variable.type === 'tableRows' && Array.isArray(value)) {
      variable.columns = value as string[];
      variable.value = variable.value.map(row => Object.fromEntries(variable.columns.map(column => [column, row[column] ?? ''])));
    }
    this.emit();
  }

  async toggle(currentMode: DocumentMode): Promise<DocumentMode> {
    if (this.rendered) {
      await this.hide(currentMode === 'viewing' ? this.modeBeforeRender : currentMode);
      return currentMode === 'viewing' ? this.modeBeforeRender : currentMode;
    }
    await this.render(currentMode);
    return 'viewing';
  }

  async hide(nextMode = this.modeBeforeRender): Promise<DocumentMode> {
    if (!this.rendered) return nextMode;
    this.setRendering(true);
    this.superdoc.setDocumentMode('editing');
    try {
      if (!this.renderSnapshot) throw new Error('The original document snapshot is unavailable.');
      const originalDocument = new File([this.renderSnapshot], this.getDocumentName(), { type: DOCX });
      this.renderSnapshot = null;
      await this.superdoc.replaceFile(originalDocument);
      await this.onDocumentRestored?.();
      this.rendered = false;
      this.superdoc.setDocumentMode(nextMode);
    } finally {
      this.setRendering(false);
    }
    return nextMode;
  }

  destroy(): void {
    this.listeners.clear();
    this.renderSnapshot = null;
  }

  private async render(currentMode: DocumentMode): Promise<void> {
    if (this.rendered) return;
    const values = new Map(this.variableState
      .filter(variable => variable.type === 'text' || variable.type === 'boolean')
      .map(variable => [variable.name.trim(), variable.value] as const)
      .filter(([name]) => name.length > 0));
    this.setRendering(true);
    this.modeBeforeRender = currentMode;
    this.renderSnapshot = await this.superdoc.ui.document.export({
      exportType: ['docx'],
      triggerDownload: false,
    }) ?? null;
    if (!this.renderSnapshot) {
      this.setRendering(false);
      throw new Error('The document could not be captured before rendering.');
    }
    this.superdoc.setDocumentMode('editing');

    try {
      // Render structural row loops first, nested conditions next, and scalar values last.
      await this.renderTableRowLoops();
      for (let pass = 0; pass < 1000; pass += 1) {
        const text = await this.superdoc.activeEditor?.doc?.getText?.({});
        if (text === undefined) throw new Error('Document text is unavailable.');
        const block = findInnermostConditional(text);
        if (!block) break;
        const replacement = evaluateBooleanExpression(block.expression, values) ? block.truthyContent : block.falsyContent;
        const count = await this.replaceConditionalBlock(block.source, replacement, block.paragraphScoped);
        if (!count) throw new Error(`Conditional block could not be replaced: ${block.expression}`);
        const updatedText = await this.superdoc.activeEditor?.doc?.getText?.({});
        if (updatedText === text) throw new Error(`Conditional block did not change the document: ${block.expression}`);
      }
      await this.renderInterpolations(values);
      this.rendered = true;
      this.superdoc.setDocumentMode('viewing');
    } catch (error) {
      if (this.renderSnapshot) {
        const originalDocument = new File([this.renderSnapshot], this.getDocumentName(), { type: DOCX });
        this.renderSnapshot = null;
        await this.superdoc.replaceFile(originalDocument);
        await this.onDocumentRestored?.();
      }
      this.superdoc.setDocumentMode(this.modeBeforeRender);
      console.error('Failed to render variables', error);
      throw error;
    } finally {
      this.setRendering(false);
    }
  }

  private async renderTableRowLoops(): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) throw new Error('Document API is unavailable.');
    const loops = findTableRowLoops((await documentApi.extract({})).blocks);
    if (!loops.length) return;
    const tableMatches = await documentApi.query.match({ select: { type: 'node', nodeType: 'table' }, limit: 1000 });
    // Work bottom-up so deleting or inserting rows does not invalidate later loop coordinates.
    for (const loop of [...loops].sort((a, b) => b.tableOrdinal - a.tableOrdinal || b.openingRowIndex - a.openingRowIndex)) {
      const tableMatch = tableMatches.items[loop.tableOrdinal];
      if (!tableMatch || tableMatch.matchKind !== 'node' || tableMatch.address.nodeType !== 'table') {
        throw new Error(`Table for row loop "${loop.variableName}" could not be found.`);
      }
      const variable = this.variableState.find(candidate => candidate.name.trim() === loop.variableName);
      const rows = variable?.type === 'tableRows' ? variable.value : [];
      const tableTarget = { kind: 'block' as const, nodeType: 'table' as const, nodeId: tableMatch.address.nodeId };
      if (!rows.length) {
        await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: loop.closingRowIndex });
        for (const prototype of [...loop.prototypeRows].reverse()) {
          await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: prototype.rowIndex });
        }
        await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: loop.openingRowIndex });
        continue;
      }
      const insertedRowCount = rows.length * loop.prototypeRows.length - loop.prototypeRows.length;
      const lastPrototypeRow = loop.prototypeRows[loop.prototypeRows.length - 1]?.rowIndex;
      if (lastPrototypeRow === undefined) throw new Error(`Table-row loop "${loop.variableName}" has no prototype row.`);
      if (insertedRowCount > 0) {
        await documentApi.tables.insertRow({ target: tableTarget, rowIndex: lastPrototypeRow, position: 'below', count: insertedRowCount });
      }
      for (const [itemIndex, item] of rows.entries()) {
        for (const [prototypeOffset, prototype] of loop.prototypeRows.entries()) {
          const rowIndex = loop.prototypeRows[0].rowIndex + itemIndex * loop.prototypeRows.length + prototypeOffset;
          for (const [columnIndex, template] of prototype.cells.entries()) {
            // Matches {{ alias.column }} placeholders inside a prototype table cell.
            const pattern = new RegExp(`\\{\\{\\s*${escapeRegularExpression(loop.alias)}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}`, 'g');
            const text = template.replace(pattern, (_, column: string) => item[column] ?? '');
            await documentApi.tables.setCellText({ target: tableTarget, rowIndex, columnIndex, text });
          }
        }
      }
      await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: loop.closingRowIndex + insertedRowCount });
      await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: loop.openingRowIndex });
    }
  }

  private async replaceConditionalBlock(source: string, replacement: string, paragraphScoped: boolean): Promise<number> {
    const documentApi = this.superdoc.activeEditor?.doc;
    const matches = await documentApi?.query?.match?.({
      // Matches every conditional directive; the stack below selects one matched if/endif pair.
      select: { type: 'text', pattern: '\\{%\\s*(?:p\\s+)?(?:if\\s+[^%]*|else|endif)\\s*%\\}', mode: 'regex', caseSensitive: true },
      limit: 1000,
    });
    if (!matches || !documentApi) throw new Error('Document query is unavailable.');
    const stack: Array<{ opening: typeof matches.items[number]; alternate?: typeof matches.items[number] }> = [];
    let opening: typeof matches.items[number] | undefined;
    let closing: typeof matches.items[number] | undefined;
    for (const match of matches.items) {
      if (match.matchKind !== 'text') continue;
      const tag = match.blocks.map(block => block.text).join('').replace(/^\{%\s*(?:p\s+)?/, '').replace(/\s*%\}$/, '').trim();
      if (tag.startsWith('if ')) stack.push({ opening: match });
      else if (tag === 'else') {
        const current = stack[stack.length - 1];
        if (current) current.alternate = match;
      } else if (tag === 'endif') {
        const current = stack.pop();
        if (current) { opening = current.opening; closing = match; break; }
      }
    }
    if (!opening || !closing || opening.matchKind !== 'text' || closing.matchKind !== 'text') {
      console.error('[Template render] Conditional query matched no document ranges', { paragraphScoped, source, replacement });
      return 0;
    }
    await documentApi.replace({ target: { ...opening.target, end: closing.target.end }, text: paragraphScoped ? replacement.trim() : replacement });
    return 1;
  }

  private async renderInterpolations(values: ReadonlyMap<string, string | boolean>): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    const matches = await documentApi?.query?.match?.({
      // Matches interpolation candidates; parseInterpolation rejects unsupported contents.
      select: { type: 'text', pattern: '\\{\\{[^{}]+\\}\\}', mode: 'regex', caseSensitive: true },
      limit: 1000,
    });
    if (!matches || !documentApi) throw new Error('Document query is unavailable.');
    // Replace from the end of the document so earlier match targets remain stable.
    for (const match of [...matches.items].reverse()) {
      if (match.matchKind !== 'text') continue;
      const interpolation = parseInterpolation(match.blocks.map(block => block.text).join(''));
      if (!interpolation) continue;
      await documentApi.replace({ target: match.target, text: renderInterpolation(interpolation, values) });
    }
  }

  private snapshot(): TemplateVariableSnapshot {
    return { variables: this.variableState, rendered: this.rendered, rendering: this.rendering };
  }

  private setRendering(rendering: boolean): void {
    this.rendering = rendering;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
