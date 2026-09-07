import type { SuperDoc } from 'superdoc';
import type { ContentControlInfo, SelectionTarget } from 'superdoc/ui';

export interface TemplateField {
  id: string;
  alias: string;
  tag?: string;
  mode: 'inline' | 'block';
  group?: string;
  controlType?: string;
  value: string;
  lockMode: 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';
  metadata: Record<string, unknown>;
}

export interface NewFieldInput {
  alias: string;
  tag?: string;
  value: string;
  mode: 'inline' | 'block';
  locked: boolean;
  metadata: Record<string, unknown>;
}

export interface InsertedFieldCopy {
  field: TemplateField;
  groupTag: string;
  sourceId: string;
}

type FieldListener = (fields: readonly TemplateField[]) => void;

/** Owns template-field state, observation, and all document CRUD operations. */
export class FieldController {
  private fieldState: TemplateField[] = [];
  private readonly listeners = new Set<FieldListener>();
  private readonly overrides = new Map<string, Partial<TemplateField>>();
  private readonly pendingFields = new Map<string, TemplateField>();
  private stopObserving: (() => void) | null = null;

  constructor(private readonly superdoc: SuperDoc) {}

  get fields(): readonly TemplateField[] {
    return this.fieldState;
  }

  get(id: string): TemplateField | null {
    return this.fieldState.find((field) => field.id === id) || null;
  }

  subscribe(listener: FieldListener): () => void {
    this.listeners.add(listener);
    listener(this.fields);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    this.overrides.clear();
    this.pendingFields.clear();
    this.replaceFromControls(this.superdoc.ui.contentControls.list());
    await this.migrateLegacyGroups();
    this.replaceFromControls(this.superdoc.ui.contentControls.list());
  }

  async initialize(): Promise<void> {
    await this.load();
    this.stopObserving?.();
    this.stopObserving = this.superdoc.ui.contentControls.observe((snapshot) => {
      this.replaceFromControls(snapshot.items);
    });
  }

  destroy(): void {
    this.stopObserving?.();
    this.stopObserving = null;
    this.listeners.clear();
  }

  private parseControls(
    controls: readonly ContentControlInfo[] = this.superdoc.ui.contentControls.list(),
  ): TemplateField[] {
    return controls.map((control: ContentControlInfo) => ({
      id: control.id,
      alias: control.properties.alias || '',
      tag: control.properties.tag,
      mode: control.kind,
      group: this.parseGroup(control.properties.tag),
      controlType: control.controlType,
      value: control.text || '',
      lockMode: control.lockMode,
      metadata: this.parseMetadata(control.properties.tag),
    }));
  }

  private async migrateLegacyGroups(): Promise<void> {
    for (const field of [...this.fieldState]) {
      const legacyFieldId = field.metadata.fieldId;
      const currentGroup = field.metadata.group;
      const hasLegacyFieldId = typeof legacyFieldId === 'string' && legacyFieldId.trim();
      const hasLegacyCategoryGroup = currentGroup === 'field' || currentGroup === 'clause';
      if (!hasLegacyFieldId && !hasLegacyCategoryGroup) continue;

      const group = hasLegacyFieldId ? legacyFieldId : field.id;
      const category = currentGroup === 'clause' ? 'clause' : field.metadata.category || 'field';
      const metadata: Record<string, unknown> = { ...field.metadata, group, category };
      delete metadata.fieldId;
      const tag = JSON.stringify(metadata);
      const updated = await this.updateTagForField(field, tag);
      if (updated) this.patchState(field.id, { tag, group: String(group), metadata });
      else console.error(`Failed to migrate field group: ${field.id}`);
    }
  }

  async insertCopy(
    field: TemplateField,
    at: SelectionTarget | null,
  ): Promise<InsertedFieldCopy | null> {
    console.log('[Field insert] Step 1: resolving Document API');
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) {
      console.error('[Field insert] Step 1 failed: document is not ready');
      return null;
    }
    if (!at) {
      console.error('[Field insert] Step 1 failed: no captured cursor target');
      return null;
    }

    const caret: SelectionTarget = {
      ...at,
      kind: 'selection',
      start: at.end,
      end: at.end,
    };
    console.log('[Field insert] Step 2: normalized captured target to cursor caret', caret);

    const value = (field.value || field.alias).trim();
    console.log('[Field insert] Step 3: prepared field payload', {
      requestedKind: field.mode,
      controlType: field.controlType,
      alias: field.alias,
      valueLength: value.length,
    });

    const grouping = this.groupingTag(field);

    console.log('[Field insert] TEST MODE: forcing inline SDT insertion into anchor run');
    const result = await doc.create.contentControl({
      kind: 'inline',
      controlType: field.controlType === 'text' ? 'text' : 'richText',
      at: caret,
      alias: field.alias,
      tag: grouping.tag,
      content: value,
      lockMode: 'unlocked',
    });
    console.log('[Field insert] Final Document API receipt', result);
    if (!result.success) {
      console.error('Content-control insertion failed', result.failure);
      return null;
    }
    if (result.success && grouping.updateSource) {
      const updated = await this.updateTagForField(field, grouping.tag);
      if (!updated)
        console.error('[Field insert] Inserted the copy but failed to tag the source SDT');
      else console.log('[Field insert] Added grouping tag to source SDT', grouping.tag);
    }
    const created = await doc.contentControls.get({ target: result.contentControl });
    const insertedField = this.parseControls([created])[0];
    if (!insertedField) {
      console.error('[Field insert] Created SDT could not be read back');
      return null;
    }
    const metadata = this.parseMetadata(grouping.tag);
    this.patchState(field.id, { tag: grouping.tag, group: String(metadata.group), metadata });
    this.pendingFields.set(insertedField.id, insertedField);
    this.upsertState(insertedField);
    return { field: insertedField, groupTag: grouping.tag, sourceId: field.id };
  }

  async createField(input: NewFieldInput): Promise<TemplateField | null> {
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) return null;
    const metadata = { ...input.metadata };
    const tag = input.tag?.trim() || JSON.stringify(metadata);
    const common = {
      controlType: 'richText' as const,
      alias: input.alias,
      tag,
      lockMode: input.locked ? ('sdtContentLocked' as const) : ('unlocked' as const),
    };
    const result =
      input.mode === 'block'
        ? await doc.create.contentControl({
            kind: 'block',
            ...common,
            html: `<p>${this.escapeHtml(input.value || input.alias)}</p>`,
          })
        : await doc.create.contentControl({
            kind: 'inline',
            ...common,
            content: input.value || input.alias,
          });
    if (!result.success) return null;
    let created = await doc.contentControls.get({ target: result.contentControl });
    let field = this.parseControls([created])[0] || null;
    if (!field) return null;

    if (field.metadata.group !== field.id) {
      const groupedMetadata: Record<string, unknown> = { ...field.metadata, group: field.id };
      delete groupedMetadata.fieldId;
      const groupedTag = JSON.stringify(groupedMetadata);
      const updated = await this.updateTagForField(field, groupedTag);
      if (updated) {
        created = await doc.contentControls.get({ target: result.contentControl });
        field = {
          ...(this.parseControls([created])[0] || field),
          tag: groupedTag,
          group: field.id,
          metadata: groupedMetadata,
        };
      }
    }
    this.pendingFields.set(field.id, field);
    this.upsertState(field);
    return field;
  }

  async deleteFields(fields: readonly TemplateField[]): Promise<string[]> {
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) return [];
    const deletedIds: string[] = [];
    for (const field of fields) {
      const result = await doc.contentControls.delete({ target: this.target(field) });
      if (result.success) deletedIds.push(field.id);
    }
    if (deletedIds.length) {
      const deleted = new Set(deletedIds);
      for (const id of deletedIds) {
        this.overrides.delete(id);
        this.pendingFields.delete(id);
      }
      this.fieldState = this.fieldState.filter((field) => !deleted.has(field.id));
      this.emit();
    }
    return deletedIds;
  }

  async updateValue(fields: readonly TemplateField[], value: string): Promise<boolean> {
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) return false;
    let success = true;
    for (const field of fields.filter((candidate) => candidate.lockMode === 'unlocked')) {
      const result = await doc.contentControls.replaceContent({ target: this.target(field), content: value, format: 'text' });
      if (result?.success) this.patchState(field.id, { value });
      else success = false;
    }
    return success;
  }

  async updateAlias(fields: readonly TemplateField[], alias: string): Promise<boolean> {
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) return false;
    return this.patchFields(fields, { alias }, (field) => doc.contentControls.patch({ target: this.target(field), alias }));
  }

  async updateTag(fields: readonly TemplateField[], tag: string): Promise<boolean> {
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) return false;
    const metadata = this.parseMetadata(tag);
    return this.patchFields(fields, { tag, metadata, group: typeof metadata.group === 'string' ? metadata.group : undefined },
      (field) => doc.contentControls.patch({ target: this.target(field), tag }));
  }

  async setLocked(fields: readonly TemplateField[], locked: boolean): Promise<boolean> {
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) return false;
    const lockMode = locked ? 'sdtContentLocked' as const : 'unlocked' as const;
    return this.patchFields(fields, { lockMode },
      (field) => doc.contentControls.setLockMode({ target: this.target(field), lockMode }));
  }

  private async updateTagForField(field: TemplateField, tag: string): Promise<boolean> {
    const doc = this.superdoc.activeEditor?.doc;
    if (!doc) return false;
    const result = await doc.contentControls.patch({ target: this.target(field), tag });
    return result?.success === true;
  }

  private replaceFromControls(controls: readonly ContentControlInfo[]): void {
    const observed = this.parseControls(controls);
    const observedIds = new Set(observed.map((field) => field.id));
    for (const id of observedIds) this.pendingFields.delete(id);
    this.fieldState = [
      ...observed.map((field) => ({ ...field, ...this.overrides.get(field.id) })),
      ...Array.from(this.pendingFields.values()).filter((field) => !observedIds.has(field.id)),
    ];
    this.emit();
  }

  private upsertState(field: TemplateField): void {
    const index = this.fieldState.findIndex((candidate) => candidate.id === field.id);
    if (index === -1) this.fieldState = [...this.fieldState, field];
    else this.fieldState = this.fieldState.map((candidate, candidateIndex) => candidateIndex === index ? field : candidate);
    this.emit();
  }

  private patchState(id: string, patch: Partial<TemplateField>): void {
    this.overrides.set(id, { ...this.overrides.get(id), ...patch });
    this.fieldState = this.fieldState.map((field) => field.id === id ? { ...field, ...patch } : field);
    this.emit();
  }

  private async patchFields(
    fields: readonly TemplateField[],
    patch: Partial<TemplateField>,
    mutate: (field: TemplateField) => Promise<{ success?: boolean }> | { success?: boolean },
  ): Promise<boolean> {
    let success = true;
    for (const field of fields) {
      const result = await mutate(field);
      if (result?.success) this.patchState(field.id, patch);
      else success = false;
    }
    return success;
  }

  private emit(): void {
    const snapshot = this.fieldState.map((field) => ({ ...field, metadata: { ...field.metadata } }));
    for (const listener of this.listeners) listener(snapshot);
  }

  private target(field: TemplateField) {
    return { kind: field.mode, nodeType: 'sdt' as const, nodeId: field.id };
  }

  private groupingTag(field: TemplateField): { tag: string; updateSource: boolean } {
    const group = field.metadata.group;
    if (typeof group === 'string' && group.trim() && group !== 'field' && group !== 'clause') {
      return { tag: field.tag || JSON.stringify(field.metadata), updateSource: false };
    }

    const metadata: Record<string, unknown> = { ...field.metadata, group: field.id };
    delete metadata.fieldId;
    const tag = JSON.stringify(metadata);
    return { tag, updateSource: true };
  }

  private parseGroup(tag?: string): string | undefined {
    if (!tag) return undefined;
    try {
      return JSON.parse(tag)?.group as string | undefined;
    } catch {
      return undefined;
    }
  }

  private parseMetadata(tag?: string): Record<string, unknown> {
    if (!tag) return {};
    try {
      const metadata = JSON.parse(tag);
      return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    } catch {
      return { tag };
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
