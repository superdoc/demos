export type DiscoveredVariable =
  | { name: string; type: 'text' | 'boolean' }
  | { name: string; type: 'tableRows'; columns: string[] };

export type Interpolation = {
  name: string;
  fallback?: string;
  useFallbackForFalsyValues: boolean;
};

export type TableRowLoop = {
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

type Value = string | number | boolean;
type Token = { type: 'value' | 'name' | 'operator'; value: Value | string };

// Matches {{ name }} and {{ name | default('fallback', true) }} as complete expressions.
const INTERPOLATION_PATTERN = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|\s*default\(\s*(['"])((?:\\.|(?!\2).)*)\2\s*(?:,\s*(true|false)\s*)?\))?\s*\}\}$/;
// Matches a complete {%tr for row in rows %}...{%tr endfor %} table-row loop.
const TABLE_LOOP_PATTERN = /\{%\s*tr\s+for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*%\}([\s\S]*?)\{%\s*tr\s+endfor\s*%\}/g;
// Matches scalar placeholder names in {{ name }} and {{ name | ... }} expressions.
const SCALAR_INTERPOLATION_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=\||\}\})/g;
// Matches opening {% if expression %} and {%p if expression %} directives.
const IF_PATTERN = /\{%\s*(?:p\s+)?if\s+([\s\S]*?)\s*%\}/g;
// Matches a directive row containing only {%tr for alias in collection %}.
const TABLE_LOOP_START_PATTERN = /^\{%\s*tr\s+for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)\s*%\}$/;
// Matches a directive row containing only {%tr endfor %}.
const TABLE_LOOP_END_PATTERN = /^\{%\s*tr\s+endfor\s*%\}$/;
// Matches inline/paragraph if, else, and endif tags so nested blocks can be paired.
const CONDITIONAL_TAG_PATTERN = /\{%\s*(?:(p)\s+)?(if\s+([\s\S]*?)|else|endif)\s*%\}/g;
// Matches one complete conditional directive and captures its contents without delimiters.
const CONDITIONAL_DIRECTIVE_PATTERN = /^\{%\s*(?:p\s+)?([\s\S]*?)\s*%\}$/;
// Unescapes quotes and slashes accepted inside string literals.
const ESCAPED_STRING_CHARACTER_PATTERN = /\\(['"\\])/g;
// Escapes characters that have special meaning when an alias is placed in a regex.
const REGULAR_EXPRESSION_CHARACTER_PATTERN = /[.*+?^${}()|[\]\\]/g;

// These strings are passed to SuperDoc's regex query API to locate document ranges.
export const CONDITIONAL_QUERY_PATTERN = '\\{%\\s*(?:p\\s+)?(?:if\\s+[^%]*|else|endif)\\s*%\\}';
export const INTERPOLATION_QUERY_PATTERN = '\\{\\{[^{}]+\\}\\}';

// Each tokenizer pattern is anchored so it can only consume the next expression token.
const WHITESPACE_TOKEN_PATTERN = /^\s+/;
const SYMBOLIC_OPERATOR_TOKEN_PATTERN = /^(===|!==|==|!=|&&|\|\||!|\(|\))/;
const WORD_OPERATOR_TOKEN_PATTERN = /^(and|or|not)\b/;
const QUOTED_STRING_TOKEN_PATTERN = /^(['"])((?:\\.|(?!\1).)*)\1/;
const BOOLEAN_TOKEN_PATTERN = /^(true|false)\b/;
const NUMBER_TOKEN_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)/;
const IDENTIFIER_TOKEN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/;

export const parseInterpolation = (source: string): Interpolation | null => {
  const match = source.match(INTERPOLATION_PATTERN);
  if (!match) return null;

  return {
    name: match[1],
    fallback: match[3]?.replace(ESCAPED_STRING_CHARACTER_PATTERN, '$1'),
    useFallbackForFalsyValues: match[4] === 'true',
  };
};

export const renderInterpolation = (
  interpolation: Interpolation,
  values: ReadonlyMap<string, string | boolean>,
): string => {
  const exists = values.has(interpolation.name);
  const value = values.get(interpolation.name);
  const shouldUseFallback = !exists || (interpolation.useFallbackForFalsyValues && !value);
  if (shouldUseFallback) return interpolation.fallback ?? '';
  return String(value ?? '');
};

export const discoverTemplateVariables = (text: string): DiscoveredVariable[] => {
  const discovered = new Map<string, 'text' | 'boolean' | 'tableRows'>();
  const tableRows = new Map<string, string[]>();

  for (const match of text.matchAll(TABLE_LOOP_PATTERN)) {
    const alias = match[1];
    const name = match[2];
    const columns = new Set<string>();
    // Matches dotted placeholders for this loop alias, such as {{ row.fee }}.
    const columnPattern = new RegExp(`\\{\\{\\s*${alias}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}`, 'g');
    for (const columnMatch of match[3].matchAll(columnPattern)) columns.add(columnMatch[1]);
    tableRows.set(name, [...columns]);
    discovered.set(name, 'tableRows');
  }

  for (const match of text.matchAll(SCALAR_INTERPOLATION_PATTERN)) discovered.set(match[1], 'text');

  for (const ifMatch of text.matchAll(IF_PATTERN)) {
    const expressionTokens = tokenize(ifMatch[1]);
    for (const [index, token] of expressionTokens.entries()) {
      if (token.type !== 'name') continue;

      const previous = expressionTokens[index - 1];
      const next = expressionTokens[index + 1];
      const comparisonValue = next?.type === 'operator' && isEqualityOperator(next.value)
        ? expressionTokens[index + 2]
        : previous?.type === 'operator' && isEqualityOperator(previous.value)
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

export const findTableRowLoops = (blocks: ExtractedBlock[]): TableRowLoop[] => {
  const rows = collectTableRows(blocks);
  const orderedRows = [...rows.values()].sort(
    (a, b) => a.tableOrdinal - b.tableOrdinal || a.rowIndex - b.rowIndex,
  );
  const loops: TableRowLoop[] = [];
  const openings = new Map<number, { alias: string; variableName: string; rowIndex: number }>();

  for (const row of orderedRows) {
    const text = [...row.cells.values()].join('').trim();
    const opening = text.match(TABLE_LOOP_START_PATTERN);
    if (opening) {
      openings.set(row.tableOrdinal, {
        alias: opening[1],
        variableName: opening[2],
        rowIndex: row.rowIndex,
      });
      continue;
    }
    if (!TABLE_LOOP_END_PATTERN.test(text)) continue;

    const start = openings.get(row.tableOrdinal);
    if (!start) throw new Error('A table-row loop has an end tag without a matching start tag.');
    const prototypeRows = orderedRows
      .filter(candidate => (
        candidate.tableOrdinal === row.tableOrdinal
        && candidate.rowIndex > start.rowIndex
        && candidate.rowIndex < row.rowIndex
      ))
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

export const evaluateBooleanExpression = (
  source: string,
  variables: ReadonlyMap<string, Value>,
): boolean => {
  const tokens = tokenize(source);
  let cursor = 0;
  const take = (expected?: string) => {
    const token = tokens[cursor];
    if (!token || (expected && token.value !== expected)) {
      throw new Error(expected ? `Expected "${expected}".` : 'Unexpected end of expression.');
    }
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
    if (is('(')) {
      take('(');
      const value = parseOr();
      take(')');
      return value;
    }
    const token = take();
    if (token.type === 'value') return token.value as Value;
    if (token.type === 'name') return variables.get(token.value as string) ?? false;
    throw new Error(`Unexpected operator "${token.value}".`);
  };
  const not = (): Value => is('!') ? (take('!'), !bool(not())) : primary();
  const equality = (): Value => {
    const left = not();
    const operator = tokens[cursor]?.value;
    if (!isEqualityOperator(operator)) return left;
    take();
    const equal = Object.is(left, not());
    return operator === '!=' || operator === '!==' ? !equal : equal;
  };
  const and = (): Value => {
    let value = equality();
    while (is('&&')) {
      take('&&');
      value = bool(value) && bool(equality());
    }
    return value;
  };
  parseOr = () => {
    let value = and();
    while (is('||')) {
      take('||');
      value = bool(value) || bool(and());
    }
    return value;
  };

  const result = parseOr();
  if (cursor !== tokens.length) throw new Error(`Unexpected token "${tokens[cursor].value}".`);
  return bool(result);
};

export const findInnermostConditional = (text: string) => {
  const stack: Array<{
    start: number;
    contentStart: number;
    expression: string;
    paragraphScoped: boolean;
    elseStart?: number;
    elseEnd?: number;
  }> = [];

  for (const match of text.matchAll(CONDITIONAL_TAG_PATTERN)) {
    const tag = match[2].trim();
    const start = match.index;
    const end = start + match[0].length;
    if (tag.startsWith('if ')) {
      stack.push({
        start,
        contentStart: end,
        expression: (match[3] ?? '').trim(),
        paragraphScoped: match[1] === 'p',
      });
      continue;
    }
    if (tag === 'else') {
      const block = stack[stack.length - 1];
      if (!block || block.elseStart !== undefined) throw new Error('Unexpected template else tag.');
      block.elseStart = start;
      block.elseEnd = end;
      continue;
    }

    const block = stack.pop();
    if (!block) throw new Error('Unexpected template endif tag.');
    return {
      source: text.slice(block.start, end),
      expression: block.expression,
      paragraphScoped: block.paragraphScoped,
      truthyContent: text.slice(block.contentStart, block.elseStart ?? start),
      falsyContent: block.elseEnd === undefined ? '' : text.slice(block.elseEnd, start),
    };
  }

  if (stack.length) throw new Error('Template if tag is missing an endif tag.');
  return null;
};

export const createTableColumnPattern = (alias: string): RegExp => {
  // Matches {{ alias.column }} placeholders inside a prototype table cell.
  return new RegExp(`\\{\\{\\s*${escapeRegularExpression(alias)}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}`, 'g');
};

export const parseConditionalDirective = (source: string): string | null => {
  const match = source.match(CONDITIONAL_DIRECTIVE_PATTERN);
  return match?.[1].trim() ?? null;
};

const collectTableRows = (blocks: ExtractedBlock[]) => {
  const rows = new Map<string, {
    tableOrdinal: number;
    rowIndex: number;
    cells: Map<number, string>;
  }>();

  for (const block of blocks) {
    const context = block.tableContext;
    if (!context) continue;
    const key = `${context.tableOrdinal}:${context.rowIndex}`;
    const row = rows.get(key) ?? {
      tableOrdinal: context.tableOrdinal,
      rowIndex: context.rowIndex,
      cells: new Map(),
    };
    row.cells.set(context.columnIndex, `${row.cells.get(context.columnIndex) ?? ''}${block.text}`);
    rows.set(key, row);
  }

  return rows;
};

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let rest = source;

  while (rest) {
    const whitespace = rest.match(WHITESPACE_TOKEN_PATTERN)?.[0];
    if (whitespace) { rest = rest.slice(whitespace.length); continue; }
    const operator = rest.match(SYMBOLIC_OPERATOR_TOKEN_PATTERN)?.[0];
    if (operator) { tokens.push({ type: 'operator', value: operator }); rest = rest.slice(operator.length); continue; }
    const keyword = rest.match(WORD_OPERATOR_TOKEN_PATTERN)?.[0];
    if (keyword) { tokens.push({ type: 'operator', value: keyword === 'and' ? '&&' : keyword === 'or' ? '||' : '!' }); rest = rest.slice(keyword.length); continue; }
    const quoted = rest.match(QUOTED_STRING_TOKEN_PATTERN);
    if (quoted) { tokens.push({ type: 'value', value: quoted[2].replace(ESCAPED_STRING_CHARACTER_PATTERN, '$1') }); rest = rest.slice(quoted[0].length); continue; }
    const boolean = rest.match(BOOLEAN_TOKEN_PATTERN)?.[0];
    if (boolean) { tokens.push({ type: 'value', value: boolean === 'true' }); rest = rest.slice(boolean.length); continue; }
    const number = rest.match(NUMBER_TOKEN_PATTERN)?.[0];
    if (number) { tokens.push({ type: 'value', value: Number(number) }); rest = rest.slice(number.length); continue; }
    const name = rest.match(IDENTIFIER_TOKEN_PATTERN)?.[0];
    if (name) { tokens.push({ type: 'name', value: name }); rest = rest.slice(name.length); continue; }
    throw new Error(`Unsupported token near "${rest.slice(0, 12)}".`);
  }

  return tokens;
};

const isEqualityOperator = (value: Value | string | undefined): boolean => (
  value === '==' || value === '!=' || value === '===' || value === '!=='
);

// Escapes user-defined aliases before embedding them in generated regular expressions.
const escapeRegularExpression = (value: string) => value.replace(REGULAR_EXPRESSION_CHARACTER_PATTERN, '\\$&');
