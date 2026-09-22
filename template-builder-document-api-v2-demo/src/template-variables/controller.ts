import type { SuperDoc } from 'superdoc';
import type { ContentControlInfo } from 'superdoc/ui';
import {
  CONDITIONAL_QUERY_PATTERN,
  discoverTemplateVariables,
  INTERPOLATION_QUERY_PATTERN,
  parseConditionalDirective,
} from './helpers';

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
    await this.wrapTemplateSyntax();
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

  private async wrapTemplateSyntax(): Promise<void> {
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
      const raw = match.snippet.slice(match.highlightRange.start, match.highlightRange.end);
      return [{ match, raw, directive: parseConditionalDirective(raw) }];
    });
    const extractedBlocks = (await documentApi.extract({})).blocks;
    const blockIndexes = new Map(extractedBlocks.map((block, index) => [block.nodeId, index]));
    const blocksById = new Map(extractedBlocks.map(block => [block.nodeId, block]));
    const segments: Array<{
      target: typeof tokens[number]['match']['target'];
      raw: string;
      kind: 'inline' | 'block';
      segmentType: 'syntax' | 'conditional-content';
      alias: string;
    }> = [];
    const conditionalKinds: Array<'inline' | 'block'> = [];
    let previousToken: typeof tokens[number] | undefined;

    for (const token of tokens) {
      if (previousToken && conditionalKinds.length > 0) {
        const start = previousToken.match.target.end;
        const end = token.match.target.start;
        const sameBlock = start.blockId === end.blockId;
        const contentKind = conditionalKinds[conditionalKinds.length - 1];
        if (sameBlock && start.offset < end.offset) {
          const raw = blocksById.get(start.blockId)?.text.slice(start.offset, end.offset) ?? '';
          segments.push({
            target: { kind: 'selection', start, end },
            raw,
            kind: contentKind,
            segmentType: 'conditional-content',
            alias: `variable-${nextAlias++}`,
          });
        } else if (!sameBlock) {
          const startIndex = blockIndexes.get(start.blockId);
          const endIndex = blockIndexes.get(end.blockId);
          if (startIndex !== undefined && endIndex !== undefined && startIndex <= endIndex) {
            for (let index = startIndex; index <= endIndex; index += 1) {
              const block = extractedBlocks[index];
              const segmentStart = index === startIndex ? start.offset : 0;
              const segmentEnd = index === endIndex ? end.offset : block.text.length;
              if (segmentStart >= segmentEnd) continue;
              segments.push({
                target: {
                  kind: 'selection',
                  start: { ...start, blockId: block.nodeId, offset: segmentStart },
                  end: { ...end, blockId: block.nodeId, offset: segmentEnd },
                },
                raw: block.text.slice(segmentStart, segmentEnd),
                kind: contentKind,
                segmentType: 'conditional-content',
                alias: `variable-${nextAlias++}`,
              });
            }
          }
        }
      }

      if (token.directive?.startsWith('if ')) {
        conditionalKinds.push(/^\{%\s*p\s+if\b/.test(token.raw) ? 'block' : 'inline');
      } else if (token.directive === 'endif') {
        conditionalKinds.pop();
      }
      previousToken = token;
    }

    // Adjacent inline SDTs must be created from left to right so their shared
    // boundaries remain outside the previously created control.
    const candidates = [
      ...tokens.map(token => ({
        target: token.match.target,
        raw: token.raw,
        kind: (/^\{%\s*p\s+(?:if\b|else\b|endif\b)/.test(token.raw) ? 'block' : 'inline') as 'inline' | 'block',
        segmentType: 'syntax' as const,
      })),
      ...segments.map(segment => ({
        target: segment.target,
        raw: segment.raw,
        kind: segment.kind,
        segmentType: 'conditional-content' as const,
      })),
    ].sort((left, right) => {
      const leftBlock = blockIndexes.get(left.target.start.blockId) ?? Number.MAX_SAFE_INTEGER;
      const rightBlock = blockIndexes.get(right.target.start.blockId) ?? Number.MAX_SAFE_INTEGER;
      return leftBlock - rightBlock || left.target.start.offset - right.target.start.offset;
    });

    for (const candidate of candidates) {
      const result = await documentApi.create.contentControl({
        kind: candidate.kind,
        controlType: 'richText',
        at: candidate.target,
        alias: `variable-${nextAlias++}`,
        tag: JSON.stringify({
          variable: true,
          variableType: candidate.segmentType,
          raw: candidate.raw,
          kind: candidate.kind,
        }),
        lockMode: 'unlocked',
      });
      if (!result.success) {
        throw new Error(
          `Variable segment could not be wrapped: ${candidate.raw || 'conditional content'} `
          + `(${result.failure.code}: ${result.failure.message})`,
        );
      }
    }

    this.variableControls = this.readVariableControls((await documentApi.contentControls.list()).items);
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
