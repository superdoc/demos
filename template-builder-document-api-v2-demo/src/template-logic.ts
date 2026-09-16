export type TemplateVariable = {
  id: string;
  name: string;
} & ({
  type: 'text';
  value: string;
} | {
  type: 'boolean';
  value: boolean;
});

export type DiscoveredVariable = Pick<TemplateVariable, 'name' | 'type'>;

export const discoverTemplateVariables = (text: string): DiscoveredVariable[] => {
  const discovered = new Map<string, TemplateVariable['type']>();
  const interpolationPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of text.matchAll(interpolationPattern)) discovered.set(match[1], 'text');

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

  return Array.from(discovered, ([name, type]) => ({ name, type }));
};

type Value = string | number | boolean;
type Token = { type: 'value' | 'name' | 'operator'; value: Value | string };

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let rest = source;
  while (rest) {
    const whitespace = rest.match(/^\s+/)?.[0];
    if (whitespace) { rest = rest.slice(whitespace.length); continue; }
    const operator = rest.match(/^(===|!==|==|!=|&&|\|\||!|\(|\))/)?.[0];
    if (operator) { tokens.push({ type: 'operator', value: operator }); rest = rest.slice(operator.length); continue; }
    const keyword = rest.match(/^(and|or|not)\b/)?.[0];
    if (keyword) { tokens.push({ type: 'operator', value: keyword === 'and' ? '&&' : keyword === 'or' ? '||' : '!' }); rest = rest.slice(keyword.length); continue; }
    const quoted = rest.match(/^(['"])((?:\\.|(?!\1).)*)\1/);
    if (quoted) { tokens.push({ type: 'value', value: quoted[2].replace(/\\(['"\\])/g, '$1') }); rest = rest.slice(quoted[0].length); continue; }
    const boolean = rest.match(/^(true|false)\b/)?.[0];
    if (boolean) { tokens.push({ type: 'value', value: boolean === 'true' }); rest = rest.slice(boolean.length); continue; }
    const number = rest.match(/^-?(?:\d+\.?\d*|\.\d+)/)?.[0];
    if (number) { tokens.push({ type: 'value', value: Number(number) }); rest = rest.slice(number.length); continue; }
    const name = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
    if (name) { tokens.push({ type: 'name', value: name }); rest = rest.slice(name.length); continue; }
    throw new Error(`Unsupported token near "${rest.slice(0, 12)}".`);
  }
  return tokens;
};

export const evaluateBooleanExpression = (source: string, variables: ReadonlyMap<string, Value>): boolean => {
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

export const findInnermostConditional = (text: string) => {
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
