import { DOCX, type SuperDoc } from 'superdoc';
import type { TemplateVariable } from './controller';
import {
  CONDITIONAL_QUERY_PATTERN,
  createTableColumnPattern,
  evaluateBooleanExpression,
  findInnermostConditional,
  findTableRowLoops,
  INTERPOLATION_QUERY_PATTERN,
  parseConditionalDirective,
  parseInterpolation,
  renderInterpolation,
} from './helpers';

export type TemplateRenderMode = 'final';
export type TemplateRenderState = {
  rendered: boolean;
  rendering: boolean;
  mode: TemplateRenderMode | null;
};
type TemplateRenderListener = (state: TemplateRenderState) => void;

const MAX_CONDITIONAL_PASSES = 1000;

/** Owns temporary document rendering, snapshots, replacement, and restoration. */
export class TemplateVariableRenderer {
  // Render state and the original DOCX snapshot live only for the active render.
  private rendered = false;
  private rendering = false;
  private mode: TemplateRenderMode | null = null;
  private renderSnapshot: Blob | null = null;
  private readonly listeners = new Set<TemplateRenderListener>();

  constructor(
    private readonly superdoc: SuperDoc,
    private readonly onDocumentRestored?: () => Promise<void>,
  ) {}

  // Subscribers receive render progress and whether rendering is currently active.
  subscribe(listener: TemplateRenderListener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  async render(
    variables: readonly TemplateVariable[],
    mode: TemplateRenderMode = 'final',
  ): Promise<void> {
    // Rendering is idempotent until the current render is reverted.
    if (this.rendered) return;

    await this.renderDocument(variables, mode);
  }

  async unrender(): Promise<void> {
    // Unrendering replaces the rendered document with the original DOCX snapshot.
    if (!this.rendered) return;

    this.setRendering(true);
    try {
      await this.restoreDocument();
      this.rendered = false;
      this.mode = null;
    } finally {
      this.setRendering(false);
    }
  }

  destroy(): void {
    // Release callbacks and any snapshot retained by an unfinished render.
    this.listeners.clear();
    this.renderSnapshot = null;
  }

  private async renderDocument(
    variables: readonly TemplateVariable[],
    mode: TemplateRenderMode,
  ): Promise<void> {
    if (this.rendered) return;

    this.setRendering(true);

    try {
      // Capture first so any partial render can be rolled back safely.
      await this.captureDocument();

      const values = this.getScalarValues(variables);
      // Structural loops render first, nested conditions second, and scalar values last.
      await this.renderTableRowLoops(variables, values);
      await this.renderConditionals(values);
      await this.renderInterpolations(values);

      this.rendered = true;
      this.mode = mode;
    } catch (error) {
      // A failed pass restores the source document before surfacing the error.
      if (this.renderSnapshot) await this.restoreDocument();
      console.error('Failed to render variables', error);
      throw error;
    } finally {
      this.setRendering(false);
    }
  }

  private getScalarValues(
    variables: readonly TemplateVariable[],
  ): Map<string, string | boolean> {
    // Conditions and interpolation use only named text and boolean variables.
    const scalarVariables = variables.filter(
      (variable): variable is Extract<TemplateVariable, { type: 'text' | 'boolean' }> => (
        variable.type === 'text' || variable.type === 'boolean'
      ),
    );

    return new Map(scalarVariables
      .map(variable => [variable.name.trim(), variable.value] as const)
      .filter(([name]) => name.length > 0));
  }

  private async captureDocument(): Promise<void> {
    // Export without downloading to preserve an in-memory copy of the source DOCX.
    this.renderSnapshot = await this.superdoc.ui.document.export({
      exportType: ['docx'],
      triggerDownload: false,
    }) ?? null;
    if (!this.renderSnapshot) throw new Error('The document could not be captured before rendering.');
  }

  private async restoreDocument(): Promise<void> {
    // replaceFile restores document structure that cannot be recovered with text edits alone.
    if (!this.renderSnapshot) throw new Error('The original document snapshot is unavailable.');

    const originalDocument = new File([this.renderSnapshot], 'template.docx', { type: DOCX });
    await this.superdoc.replaceFile(originalDocument);
    await this.onDocumentRestored?.();
    this.renderSnapshot = null;
  }

  private async renderConditionals(
    values: ReadonlyMap<string, string | boolean>,
  ): Promise<void> {
    for (let pass = 0; pass < MAX_CONDITIONAL_PASSES; pass += 1) {
      const textBeforeRender = await this.getDocumentText();
      const block = findInnermostConditional(textBeforeRender);
      if (!block) return;
      const conditionPassed = evaluateBooleanExpression(block.expression, values);
      const replacement = conditionPassed ? block.truthyContent : block.falsyContent;
      const wasReplaced = await this.replaceConditionalBlock(replacement, block.paragraphScoped);
      if (!wasReplaced) throw new Error(`Conditional block could not be replaced: ${block.expression}`);
      if (await this.getDocumentText() === textBeforeRender) {
        throw new Error(`Conditional block did not change the document: ${block.expression}`);
      }
    }
    throw new Error(`Template exceeds the maximum conditional depth of ${MAX_CONDITIONAL_PASSES}.`);
  }

  private async getDocumentText(): Promise<string> {
    const text = await this.superdoc.activeEditor?.doc?.getText?.({});
    if (text === undefined) throw new Error('Document text is unavailable.');
    return text;
  }

  private async replaceConditionalBlock(
    replacement: string,
    paragraphScoped: boolean,
  ): Promise<boolean> {
    const documentApi = this.superdoc.activeEditor?.doc;
    const matches = await documentApi?.query?.match?.({
      select: { type: 'text', pattern: CONDITIONAL_QUERY_PATTERN, mode: 'regex', caseSensitive: true },
      limit: 1000,
    });
    if (!matches || !documentApi) throw new Error('Document query is unavailable.');

    const stack: Array<{ opening: typeof matches.items[number]; alternate?: typeof matches.items[number] }> = [];
    let opening: typeof matches.items[number] | undefined;
    let closing: typeof matches.items[number] | undefined;
    for (const match of matches.items) {
      if (match.matchKind !== 'text') continue;
      const tag = parseConditionalDirective(match.blocks.map(block => block.text).join(''));
      if (!tag) continue;
      if (tag.startsWith('if ')) stack.push({ opening: match });
      else if (tag === 'else') {
        const current = stack[stack.length - 1];
        if (current) current.alternate = match;
      } else if (tag === 'endif') {
        const current = stack.pop();
        if (current) {
          opening = current.opening;
          closing = match;
          break;
        }
      }
    }
    if (!opening || !closing || opening.matchKind !== 'text' || closing.matchKind !== 'text') return false;
    const result = await documentApi.replace({
      target: { ...opening.target, end: closing.target.end },
      text: paragraphScoped ? replacement.trim() : replacement,
    });
    return result.success;
  }

  private async renderTableRowLoops(
    variables: readonly TemplateVariable[],
    values: ReadonlyMap<string, string | boolean>,
  ): Promise<void> {
    // Extract table coordinates before expanding each {%tr for ... %} loop.
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) throw new Error('Document API is unavailable.');

    const loops = findTableRowLoops((await documentApi.extract({})).blocks);
    if (!loops.length) return;
    const tableMatches = await documentApi.query.match({
      select: { type: 'node', nodeType: 'table' },
      limit: 1000,
    });

    // Work bottom-up so row mutations do not invalidate later loop coordinates.
    for (const loop of [...loops].sort(
      (a, b) => b.tableOrdinal - a.tableOrdinal || b.openingRowIndex - a.openingRowIndex,
    )) {
      const tableMatch = tableMatches.items[loop.tableOrdinal];
      if (!tableMatch || tableMatch.matchKind !== 'node' || tableMatch.address.nodeType !== 'table') {
        throw new Error(`Table for row loop "${loop.variableName}" could not be found.`);
      }

      const variable = variables.find(candidate => candidate.name.trim() === loop.variableName);
      const rows = variable?.type === 'tableRows' ? variable.value : [];
      const tableTarget = {
        kind: 'block' as const,
        nodeType: 'table' as const,
        nodeId: tableMatch.address.nodeId,
      };
      if (!rows.length) {
        // An empty data set removes the loop directives and its prototype rows.
        await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: loop.closingRowIndex });
        for (const prototype of [...loop.prototypeRows].reverse()) {
          await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: prototype.rowIndex });
        }
        await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: loop.openingRowIndex });
        continue;
      }

      const insertedRowCount = rows.length * loop.prototypeRows.length - loop.prototypeRows.length;
      const lastPrototypeRow = loop.prototypeRows[loop.prototypeRows.length - 1]?.rowIndex;
      if (lastPrototypeRow === undefined) {
        throw new Error(`Table-row loop "${loop.variableName}" has no prototype row.`);
      }
      if (insertedRowCount > 0) {
        // Add enough copies of the prototype rows for every supplied data item.
        await documentApi.tables.insertRow({
          target: tableTarget,
          rowIndex: lastPrototypeRow,
          position: 'below',
          count: insertedRowCount,
        });
      }

      // Populate each generated cell by replacing alias.column placeholders.
      for (const [itemIndex, item] of rows.entries()) {
        for (const [prototypeOffset, prototype] of loop.prototypeRows.entries()) {
          const rowIndex = loop.prototypeRows[0].rowIndex
            + itemIndex * loop.prototypeRows.length
            + prototypeOffset;
          for (const [columnIndex, template] of prototype.cells.entries()) {
            const rowText = template.replace(
              createTableColumnPattern(loop.alias),
              (_, column: string) => item[column] ?? '',
            );
            const text = rowText.replace(/\{\{[^{}]+\}\}/g, (raw) => {
              const interpolation = parseInterpolation(raw);
              return interpolation ? renderInterpolation(interpolation, values) : raw;
            });
            await documentApi.tables.setCellText({ target: tableTarget, rowIndex, columnIndex, text });
          }
        }
      }

      // Remove the opening and closing directive rows after expansion completes.
      await documentApi.tables.deleteRow({
        target: tableTarget,
        rowIndex: loop.closingRowIndex + insertedRowCount,
      });
      await documentApi.tables.deleteRow({ target: tableTarget, rowIndex: loop.openingRowIndex });
    }
  }

  private async renderInterpolations(
    values: ReadonlyMap<string, string | boolean>,
  ): Promise<void> {
    // Query all {{ ... }} candidates before parsing their supported interpolation syntax.
    const documentApi = this.superdoc.activeEditor?.doc;
    const matches = await documentApi?.query?.match?.({
      select: {
        type: 'text',
        pattern: INTERPOLATION_QUERY_PATTERN,
        mode: 'regex',
        caseSensitive: true,
      },
      limit: 1000,
    });
    if (!matches || !documentApi) throw new Error('Document query is unavailable.');

    // Replace from the end so earlier document targets remain stable.
    for (const match of [...matches.items].reverse()) {
      if (match.matchKind !== 'text') continue;
      const interpolation = parseInterpolation(match.blocks.map(block => block.text).join(''));
      if (!interpolation) continue;
      await documentApi.replace({ target: match.target, text: renderInterpolation(interpolation, values) });
    }
  }

  private state(): TemplateRenderState {
    return {
      rendered: this.rendered,
      rendering: this.rendering,
      mode: this.mode,
    };
  }

  private setRendering(rendering: boolean): void {
    // State updates are emitted through one path so the facade stays synchronized.
    this.rendering = rendering;
    this.emit();
  }

  private emit(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }
}
