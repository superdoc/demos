import type { SuperDoc } from 'superdoc';
import { discoverTemplateVariables } from './helpers';

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
type TemplateVariableListener = (variables: readonly TemplateVariable[]) => void;

/** Owns template-variable discovery and CRUD state. */
export class TemplateVariableController {
  private variableState: TemplateVariable[] = [];
  private readonly listeners = new Set<TemplateVariableListener>();

  constructor(private readonly superdoc: SuperDoc) {}

  get variables(): readonly TemplateVariable[] {
    return this.variableState;
  }

  subscribe(listener: TemplateVariableListener): () => void {
    this.listeners.add(listener);
    listener(this.variableState);
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
    for (const listener of this.listeners) listener(this.variableState);
  }
}
