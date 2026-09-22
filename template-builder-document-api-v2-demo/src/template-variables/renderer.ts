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

export type TemplateRenderMode = 'final' | 'preview';
export type TemplateRenderState = {
  rendered: boolean;
  rendering: boolean;
  mode: TemplateRenderMode | null;
  hiddenControlIds: readonly string[];
  previewControls: readonly { id: string; raw: string }[];
};
type TemplateRenderListener = (state: TemplateRenderState) => void;

type PreviewMarker = { id: string; expression: string; raw: string };

const MAX_CONDITIONAL_PASSES = 1000;

/** Owns temporary document rendering, snapshots, replacement, and restoration. */
export class TemplateVariableRenderer {
  // Render state and the original DOCX snapshot live only for the active preview.
  private rendered = false;
  private rendering = false;
  private mode: TemplateRenderMode | null = null;
  private renderSnapshot: Blob | null = null;
  private previewMarkers: PreviewMarker[] = [];
  private hiddenControlIds: string[] = [];
  private previewControls: Array<{ id: string; raw: string }> = [];
  private readonly listeners = new Set<TemplateRenderListener>();

  constructor(
    private readonly superdoc: SuperDoc,
    private readonly onDocumentRestored?: () => Promise<void>,
  ) {}

  // Subscribers receive render progress and whether the preview is currently active.
  subscribe(listener: TemplateRenderListener): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  async render(
    variables: readonly TemplateVariable[],
    mode: TemplateRenderMode = 'final',
  ): Promise<void> {
    // Rendering is idempotent until the current preview is unrendered.
    if (this.rendered) return;

    await this.renderDocument(variables, mode);
  }

  async unrender(): Promise<void> {
    // Unrendering replaces the preview with the original DOCX snapshot.
    if (!this.rendered) return;

    this.setRendering(true);
    try {
      await this.restoreDocument();
      this.rendered = false;
      this.mode = null;
      this.hiddenControlIds = [];
      this.previewControls = [];
    } finally {
      this.setRendering(false);
    }
  }

  destroy(): void {
    // Release callbacks and any snapshot retained by an unfinished preview.
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
      this.hiddenControlIds = [];
      this.previewControls = [];
      // Capture first so any partial render can be rolled back safely.
      await this.captureDocument();

      const values = this.getScalarValues(variables);
      // Structural loops render first, nested conditions second, and scalar values last.
      await this.renderTableRowLoops(variables, values);
      this.previewMarkers = [];
      await this.renderConditionals(values, mode);
      await this.renderInterpolations(values);
      if (mode === 'final') await this.removeBlankVariableControls();
      if (mode === 'preview') await this.wrapPreviewHiddenContent();

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
    mode: TemplateRenderMode,
  ): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) throw new Error('Document API is unavailable.');

    const controls = (await documentApi.contentControls.list()).items.flatMap((control) => {
      try {
        const metadata = JSON.parse(control.properties.tag || '');
        return metadata?.variable === true && typeof metadata.raw === 'string'
          ? [{ control, raw: metadata.raw as string, variableType: metadata.variableType as string }]
          : [];
      } catch {
        return [];
      }
    });
    const hasConditionalControls = controls.some(({ raw }) => parseConditionalDirective(raw) !== null);
    if (!hasConditionalControls) {
      await this.renderLegacyConditionals(values, mode);
      return;
    }

    type PreviewEntry = { id: string; raw: string };
    type ConditionalFrame = {
      passed: boolean;
      inElse: boolean;
      raw: string;
      previewEntries: PreviewEntry[];
    };
    const stack: ConditionalFrame[] = [];
    const controlsToDelete: Array<(typeof controls)[number]['control']> = [];

    for (const item of controls) {
      for (const frame of stack) frame.raw += item.raw;
      const directive = parseConditionalDirective(item.raw);
      if (directive?.startsWith('if ')) {
        stack.push({
          passed: evaluateBooleanExpression(directive.slice(3).trim(), values),
          inElse: false,
          raw: item.raw,
          previewEntries: [],
        });
      } else if (directive === 'else') {
        const frame = stack[stack.length - 1];
        if (frame) frame.inElse = true;
      } else if (directive === 'endif') {
        const frame = stack.pop();
        if (frame) {
          for (const entry of frame.previewEntries) entry.raw = frame.raw;
        }
      }

      if (directive) {
        if (mode === 'final') controlsToDelete.push(item.control);
        else {
          const result = await documentApi.contentControls.replaceContent({
            target: item.control.target,
            content: '',
          });
          if (!result.success) throw new Error(`Conditional directive could not be cleared: ${item.raw}`);
        }
        continue;
      }
      if (item.variableType !== 'conditional-content') continue;

      const inactiveFrame = [...stack].reverse().find(frame => frame.inElse ? frame.passed : !frame.passed);
      if (mode === 'preview') {
        const entry: PreviewEntry = { id: item.control.id, raw: '' };
        stack[stack.length - 1]?.previewEntries.push(entry);
        this.previewControls.push(entry);
        if (inactiveFrame) {
          this.hiddenControlIds.push(item.control.id);
        }
      } else if (inactiveFrame) {
        controlsToDelete.push(item.control);
      }
    }

    for (const control of controlsToDelete.reverse()) {
      const result = await documentApi.contentControls.delete({ target: control.target });
      if (!result.success) throw new Error(`Conditional SDT could not be removed: ${control.properties.alias || control.id}`);
    }
  }

  private async removeBlankVariableControls(): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) throw new Error('Document API is unavailable.');

    const controls = (await documentApi.contentControls.list()).items;
    for (const control of [...controls].reverse()) {
      try {
        const metadata = JSON.parse(control.properties.tag || '');
        if (metadata?.variable !== true) continue;
      } catch {
        continue;
      }
      const content = await documentApi.contentControls.getContent({ target: control.target });
      if (content.content.trim().length > 0) continue;
      const result = await documentApi.contentControls.delete({ target: control.target });
      if (!result.success) throw new Error(`Blank variable SDT could not be removed: ${control.properties.alias || control.id}`);
    }
  }

  private async renderLegacyConditionals(
    values: ReadonlyMap<string, string | boolean>,
    mode: TemplateRenderMode,
  ): Promise<void> {
    for (let pass = 0; pass < MAX_CONDITIONAL_PASSES; pass += 1) {
      const textBeforeRender = await this.getDocumentText();
      const block = findInnermostConditional(textBeforeRender);
      if (!block) return;
      const conditionPassed = evaluateBooleanExpression(block.expression, values);
      const replacement = mode === 'preview'
        ? this.createPreviewConditional(block, conditionPassed)
        : conditionPassed ? block.truthyContent : block.falsyContent;
      const wasReplaced = await this.replaceConditionalBlock(replacement, block.paragraphScoped);
      if (!wasReplaced) throw new Error(`Conditional block could not be replaced: ${block.expression}`);
      if (await this.getDocumentText() === textBeforeRender) {
        throw new Error(`Conditional block did not change the document: ${block.expression}`);
      }
    }
    throw new Error(`Template exceeds the maximum conditional depth of ${MAX_CONDITIONAL_PASSES}.`);
  }

  private createPreviewConditional(
    block: { source: string; expression: string; truthyContent: string; falsyContent: string },
    conditionPassed: boolean,
  ): string {
    const hiddenContent = conditionPassed ? block.falsyContent : block.truthyContent;
    const visibleContent = conditionPassed ? block.truthyContent : block.falsyContent;
    if (!hiddenContent) return visibleContent;

    const id = crypto.randomUUID();
    this.previewMarkers.push({ id, expression: block.expression, raw: block.source });
    const hidden = `__SD_PREVIEW_START_${id}__${hiddenContent}__SD_PREVIEW_END_${id}__`;
    return conditionPassed ? `${visibleContent}${hidden}` : `${hidden}${visibleContent}`;
  }

  private async wrapPreviewHiddenContent(): Promise<void> {
    const documentApi = this.superdoc.activeEditor?.doc;
    if (!documentApi) throw new Error('Document API is unavailable.');

    for (const marker of [...this.previewMarkers].reverse()) {
      const startText = `__SD_PREVIEW_START_${marker.id}__`;
      const endText = `__SD_PREVIEW_END_${marker.id}__`;
      const startMatch = (await documentApi.query.match({
        select: { type: 'text', pattern: startText, mode: 'contains', caseSensitive: true },
        limit: 1,
      })).items[0];
      const endMatch = (await documentApi.query.match({
        select: { type: 'text', pattern: endText, mode: 'contains', caseSensitive: true },
        limit: 1,
      })).items[0];
      if (startMatch?.matchKind !== 'text' || endMatch?.matchKind !== 'text') continue;
      if (startMatch.target.start.kind !== 'text' || endMatch.target.start.kind !== 'text') continue;

      await documentApi.delete({ target: endMatch.target, behavior: 'exact' });
      await documentApi.delete({ target: startMatch.target, behavior: 'exact' });
      const sameBlock = startMatch.target.start.blockId === endMatch.target.start.blockId;
      const hiddenTarget = {
        kind: 'selection' as const,
        start: startMatch.target.start,
        end: {
          ...endMatch.target.start,
          offset: endMatch.target.start.offset - (sameBlock ? startText.length : 0),
        },
      };
      const result = await documentApi.create.contentControl({
        kind: sameBlock ? 'inline' : 'block',
        controlType: 'richText',
        at: hiddenTarget,
        alias: `Hidden: ${marker.expression}`,
        tag: JSON.stringify({ category: 'conditional-hidden', expression: marker.expression, hidden: true, raw: marker.raw }),
        lockMode: 'unlocked',
      });
      if (!result.success) throw new Error(`Hidden conditional could not be wrapped: ${marker.expression}`);
      this.hiddenControlIds.push(result.contentControl.nodeId);
      this.previewControls.push({ id: result.contentControl.nodeId, raw: marker.raw });
    }
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
      hiddenControlIds: [...this.hiddenControlIds],
      previewControls: [...this.previewControls],
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
