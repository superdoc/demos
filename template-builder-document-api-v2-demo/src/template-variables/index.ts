import type { SuperDoc } from 'superdoc';
import {
  TemplateVariableController,
  type TemplateVariable,
  type TemplateVariableValue,
} from './controller';
import {
  TemplateVariableRenderer,
  type TemplateRenderState,
} from './renderer';

export type { TemplateVariable, TemplateVariableValue };

export type TemplateVariablesState = TemplateRenderState & {
  variables: readonly TemplateVariable[];
};

export type TemplateVariablesOptions = {
  onDocumentRestored?: () => Promise<void>;
};

type TemplateVariablesListener = (state: TemplateVariablesState) => void;

/** Provides one integration surface for variable CRUD and temporary document rendering. */
export class TemplateVariables {
  private readonly controller: TemplateVariableController;
  private readonly renderer: TemplateVariableRenderer;
  private readonly listeners = new Set<TemplateVariablesListener>();
  private variables: readonly TemplateVariable[] = [];
  private renderState: TemplateRenderState = { rendered: false, rendering: false };
  private readonly stopControllerSubscription: () => void;
  private readonly stopRendererSubscription: () => void;

  constructor(superdoc: SuperDoc, options: TemplateVariablesOptions = {}) {
    this.controller = new TemplateVariableController(superdoc);
    this.renderer = new TemplateVariableRenderer(superdoc, options.onDocumentRestored);
    this.stopControllerSubscription = this.controller.subscribe((variables) => {
      this.variables = variables;
      this.emit();
    });
    this.stopRendererSubscription = this.renderer.subscribe((renderState) => {
      this.renderState = renderState;
      this.emit();
    });
  }

  get state(): TemplateVariablesState {
    return { variables: this.variables, ...this.renderState };
  }

  subscribe(listener: TemplateVariablesListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  add(type: TemplateVariable['type']): void {
    this.controller.add(type);
  }

  load(): Promise<void> {
    return this.controller.load();
  }

  remove(id: string): void {
    this.controller.remove(id);
  }

  update(
    id: string,
    field: 'name' | 'value' | 'columns',
    value: TemplateVariableValue | string[],
  ): void {
    this.controller.update(id, field, value);
  }

  render(): Promise<void> {
    return this.renderer.render(this.variables);
  }

  unrender(): Promise<void> {
    return this.renderer.unrender();
  }

  destroy(): void {
    this.stopControllerSubscription();
    this.stopRendererSubscription();
    this.listeners.clear();
    this.controller.destroy();
    this.renderer.destroy();
  }

  private emit(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}
