/** Coordinates template-variable discovery, state, and rendering. */
import type { SuperDoc } from 'superdoc';
import type { ContentControlInfo } from 'superdoc/ui';
import {
  CONDITIONAL_QUERY_PATTERN,
  discoverTemplateVariables,
  INTERPOLATION_QUERY_PATTERN,
  parseConditionalDirective,
} from '../helpers';

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
export type TemplateVariableControl = {
  id: string;
  alias: string;
  raw: string;
  kind: 'inline' | 'block';
};
type TemplateVariableListener = (
  variables: readonly TemplateVariable[],
  controls: readonly TemplateVariableControl[],
) => void;

/** Owns template-variable discovery and CRUD state. */
export class TemplateVariableController {
  private variableState: TemplateVariable[] = [];
  private variableControls: TemplateVariableControl[] = [];
  private readonly listeners = new Set<TemplateVariableListener>();

  constructor(private readonly superdoc: SuperDoc) {}

  get variables(): readonly TemplateVariable[] {
    return this.variableState;
  }

  get controls(): readonly TemplateVariableControl[] {
    return this.variableControls;
  }

  subscribe(listener: TemplateVariableListener): () => void {
    this.listeners.add(listener);
    listener(this.variableState, this.variableControls);
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
    await this.unwrapVariableControls();
    const text = await this.superdoc.activeEditor?.doc?.getText?.({});
    if (text === undefined) throw new Error('Document text is unavailable.');

    const existingNames = new Set(this.variableState.map(variable => variable.name.trim()).filter(Boolean));
    for (const discovered of discoverTemplateVariables(text)) {
      if (existingNames.has(discovered.name)) continue;

      if (discovered.type === 'boolean') {
        this.variableState.push({ id: crypto.randomUUID(), type: 'boolean', name: discovered.name, value: false });
      } else if (discovered.type === 'tableRows') {
        const emptyRow = Object.fromEntries(discovered.columns.map(column => [column, '']));
        this.variableState.push({
          id: crypto.randomUUID(),
          type: 'tableRows',
          name: discovered.name,
          columns: discovered.columns,
          value: [emptyRow],
        });
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

  clear(): void {
    this.variableState = [];
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
      variable.value = variable.value.map(row => (
        Object.fromEntries(variable.columns.map(column => [column, row[column] ?? '']))
      ));
    }
    this.emit();
  }

  destroy(): void {
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.variableState, this.variableControls);
  }

  async wrapTemplateSyntax(): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) throw new Error('Document API is unavailable.');

    const existingControls = (await documentApi.contentControls.list()).items;
    let nextAlias = existingControls.reduce((highest, control) => {
      const match = /^variable-(\d+)$/.exec(control.properties.alias || '');
      return Math.max(highest, match ? Number(match[1]) : 0);
    }, 0) + 1;

    const matches = await documentApi.query.match({
      select: {
        type: 'text',
        pattern: `(?:${CONDITIONAL_QUERY_PATTERN}|${INTERPOLATION_QUERY_PATTERN})`,
        mode: 'regex',
        caseSensitive: true,
      },
      limit: 10000,
    });

    const tokens = matches.items.flatMap((match) => {
      if (match.matchKind !== 'text') return [];
      if (match.target.start.kind !== 'text' || match.target.end.kind !== 'text') return [];
      const raw = match.snippet.slice(match.highlightRange.start, match.highlightRange.end);
      return [{
        target: {
          kind: 'selection' as const,
          start: match.target.start,
          end: match.target.end,
        },
        raw,
        directive: parseConditionalDirective(raw),
      }];
    });
    const extractedBlocks = (await documentApi.extract({})).blocks;
    const blockIndexes = new Map(extractedBlocks.map((block, index) => [block.nodeId, index]));
    const blocksById = new Map(extractedBlocks.map(block => [block.nodeId, block]));
    const conditionalRanges: Array<{
      target: typeof tokens[number]['target'];
      raw: string;
      kind: 'inline' | 'block';
    }> = [];
    const conditionalStack: typeof tokens = [];

    for (const token of tokens) {
      if (token.directive?.startsWith('if ')) {
        conditionalStack.push(token);
      } else if (token.directive === 'endif') {
        const opening = conditionalStack.pop();
        if (!opening) continue;
        if (conditionalStack.length > 0) continue;
        const startIndex = blockIndexes.get(opening.target.start.blockId);
        const endIndex = blockIndexes.get(token.target.end.blockId);
        if (startIndex === undefined || endIndex === undefined || startIndex > endIndex) continue;

        const raw = extractedBlocks
          .slice(startIndex, endIndex + 1)
          .map((block, relativeIndex, blocks) => {
            const start = relativeIndex === 0 ? opening.target.start.offset : 0;
            const end = relativeIndex === blocks.length - 1 ? token.target.end.offset : block.text.length;
            return block.text.slice(start, end);
          })
          .join('\n');
        conditionalRanges.push({
          target: {
            kind: 'selection',
            start: opening.target.start,
            end: token.target.end,
          },
          raw,
          kind: startIndex === endIndex && !/^\{%\s*p\s+if\b/.test(opening.raw) ? 'inline' : 'block',
        });
      }
    }

    const isInsideConditional = (token: typeof tokens[number]) => conditionalRanges.some((range) => {
      const tokenBlock = blockIndexes.get(token.target.start.blockId);
      const startBlock = blockIndexes.get(range.target.start.blockId);
      const endBlock = blockIndexes.get(range.target.end.blockId);
      if (tokenBlock === undefined || startBlock === undefined || endBlock === undefined) return false;
      if (tokenBlock < startBlock || tokenBlock > endBlock) return false;
      if (tokenBlock === startBlock && token.target.start.offset < range.target.start.offset) return false;
      if (tokenBlock === endBlock && token.target.end.offset > range.target.end.offset) return false;
      return true;
    });

    const candidates = [
      ...conditionalRanges.map(range => ({
        target: range.target,
        raw: range.raw,
        kind: range.kind,
        segmentType: 'conditional-block' as const,
      })),
      ...tokens.filter(token => token.directive === null && !isInsideConditional(token)).map(token => ({
        target: token.target,
        raw: token.raw,
        kind: 'inline' as const,
        segmentType: 'interpolation' as const,
      })),
    ].sort((left, right) => {
      const leftBlock = blockIndexes.get(left.target.start.blockId) ?? Number.MAX_SAFE_INTEGER;
      const rightBlock = blockIndexes.get(right.target.start.blockId) ?? Number.MAX_SAFE_INTEGER;
      return leftBlock - rightBlock || left.target.start.offset - right.target.start.offset;
    });

    for (const candidate of candidates) {
      const alias = `variable-${nextAlias++}`;
      const createControl = (target: typeof candidate.target) => documentApi.create.contentControl({
        kind: candidate.kind,
        controlType: 'richText',
        at: target,
        alias,
        tag: JSON.stringify({
          variable: true,
          variableType: candidate.segmentType,
          raw: candidate.raw,
          kind: candidate.kind,
        }),
        lockMode: 'unlocked',
      });

      let result = await createControl(candidate.target);
      if (
        !result.success
        && result.failure.code === 'CAPABILITY_UNAVAILABLE'
        && result.failure.message.includes('offsets are outside the paragraph')
        && candidate.target.start.blockId === candidate.target.end.blockId
      ) {
        const block = blocksById.get(candidate.target.start.blockId);
        const extractedOffset = block
          ? this.findNearestTextOffset(block.text, candidate.raw, candidate.target.start.offset)
          : -1;
        if (block && extractedOffset >= 0) {
          // Query/extract offsets include tabs, while content-control text
          // offsets do not. Translate into the API's text-only coordinates.
          const correctedOffset = block.text.slice(0, extractedOffset).replace(/\t/g, '').length;
          result = await createControl({
            kind: 'selection',
            start: { ...candidate.target.start, offset: correctedOffset },
            end: { ...candidate.target.end, offset: correctedOffset + candidate.raw.length },
          });
        }
      }
      if (!result.success) {
        console.warn('[Variable load] Skipped variable segment that could not be wrapped:', {
          text: candidate.raw || 'conditional content',
          code: result.failure.code,
          message: result.failure.message,
        });
        continue;
      }
    }

    this.variableControls = this.readVariableControls((await documentApi.contentControls.list()).items);
  }

  private findNearestTextOffset(text: string, needle: string, expectedOffset: number): number {
    let nearestOffset = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let offset = text.indexOf(needle); offset >= 0; offset = text.indexOf(needle, offset + 1)) {
      const distance = Math.abs(offset - expectedOffset);
      if (distance < nearestDistance) {
        nearestOffset = offset;
        nearestDistance = distance;
      }
    }
    return nearestOffset;
  }

  private async unwrapVariableControls(): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) throw new Error('Document API is unavailable.');

    const variableControls = (await documentApi.contentControls.list()).items.filter((control) => (
      this.parseTag(control.properties.tag).variable === true
    ));
    for (const control of [...variableControls].reverse()) {
      const result = await documentApi.contentControls.unwrap({ target: control.target });
      if (!result.success) {
        console.warn(`Skipping stale variable control: ${control.properties.alias || control.id}`, result.failure);
      }
    }
    this.variableControls = [];
  }

  private readVariableControls(controls: readonly ContentControlInfo[]): TemplateVariableControl[] {
    return controls.flatMap((control) => {
      const metadata = this.parseTag(control.properties.tag);
      if (metadata.variable !== true || typeof metadata.raw !== 'string') return [];
      return [{
        id: control.id,
        alias: control.properties.alias || '',
        raw: metadata.raw,
        kind: control.kind === 'block' ? 'block' : 'inline',
      }];
    });
  }

  private parseTag(tag?: string): Record<string, unknown> {
    if (!tag) return {};
    try {
      const value = JSON.parse(tag);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

}
