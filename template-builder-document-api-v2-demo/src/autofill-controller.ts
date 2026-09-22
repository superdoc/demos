import type { SuperDoc } from 'superdoc';
import type { SelectionTarget } from 'superdoc/ui';

export interface AutofillField {
  id: string;
  alias: string;
  tag?: string;
  value?: string;
  metadata: Record<string, unknown>;
}

export interface AutofillAdapter {
  subscribeToFields(listener: (fields: readonly AutofillField[]) => void): () => void;
  insertField(field: AutofillField, target: SelectionTarget): Promise<boolean>;
  createField(alias: string, target: SelectionTarget): Promise<AutofillField | null>;
}

export interface AutofillSnapshot {
  open: boolean;
  query: string;
  suggestions: readonly AutofillField[];
  top: number;
  left: number;
}

type AutofillListener = (snapshot: AutofillSnapshot) => void;

/** Owns {{field}} detection, matching, positioning, and document insertion. */
export class AutofillController {
  // Subscribers receive immutable popup snapshots for rendering.
  private readonly listeners = new Set<AutofillListener>();
  // Fields are collapsed to one representative per logical field group.
  private fields: AutofillField[] = [];
  // Snapshot contains all presentation state needed by the Vue popup.
  private snapshot: AutofillSnapshot = { open: false, query: '', suggestions: [], top: 0, left: 0 };
  // Target covers the complete typed token that insertion will replace.
  private target: SelectionTarget | null = null;
  // Brace state tracks opening and closing delimiter progress.
  private pendingOpenBrace = false;
  private closingBraceCount = 0;
  private enabled = false;
  // Lifecycle handles are retained for deterministic cleanup.
  private editorElement: Element | null = null;
  private stopFields: (() => void) | null = null;
  private stopSelection: (() => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly superdoc: SuperDoc,
    private readonly adapter: AutofillAdapter,
  ) {}

  // Subscribe to popup state changes and immediately receive current state.
  subscribe(listener: AutofillListener): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => this.listeners.delete(listener);
  }

  // Attach keyboard, field, and selection observers to the mounted editor.
  initialize(editorElement: Element): void {
    this.editorElement = editorElement;
    editorElement.addEventListener('keydown', this.handleKeydown, true);
    this.stopFields = this.adapter.subscribeToFields((fields) => {
      this.fields = this.groupFields(fields);
      this.refreshSuggestions();
    });
    this.stopSelection = this.superdoc.ui.selection.observe((selection) => {
      if (this.snapshot.open) this.updateTarget(selection.selectionTarget);
    });
  }

  // Enable or disable trigger detection and close any active popup when disabled.
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.close();
  }

  // Replace the typed token with the field selected from the popup.
  async select(field: AutofillField): Promise<void> {
    const target = this.target;
    this.close();
    if (!target) return;
    const inserted = await this.adapter.insertField(field, target);
    if (!inserted) console.error(`Failed to insert suggested field: ${field.id}`);
  }

  // Detach every observer, event listener, timer, and subscriber.
  destroy(): void {
    this.editorElement?.removeEventListener('keydown', this.handleKeydown, true);
    this.stopFields?.();
    this.stopSelection?.();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }

  // Advance the delimiter/query state machine from editor keystrokes.
  private readonly handleKeydown = (event: Event) => {
    if (!this.enabled) return;
    if (!(event instanceof KeyboardEvent) || event.isComposing) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;

    if (event.key === 'Escape') {
      if (this.snapshot.open) {
        event.preventDefault();
        this.close();
      }
      return;
    }

    if (event.key === 'Backspace') {
      this.pendingOpenBrace = false;
      if (!this.snapshot.open) return;
      if (this.closingBraceCount > 0) this.closingBraceCount -= 1;
      else if (!this.snapshot.query) this.close();
      else this.setQuery(this.snapshot.query.slice(0, -1));
      if (this.snapshot.open) this.scheduleTargetUpdate();
      return;
    }

    if (!this.snapshot.open) {
      if (event.key === '{') {
        if (this.pendingOpenBrace) {
          this.pendingOpenBrace = false;
          this.snapshot = { ...this.snapshot, open: true, query: '' };
          this.refreshSuggestions();
          this.scheduleTargetUpdate();
        } else this.pendingOpenBrace = true;
      } else this.pendingOpenBrace = false;
      return;
    }

    if (/^[\w .-]$/.test(event.key)) {
      if (this.closingBraceCount) {
        this.close();
        return;
      }
      this.setQuery(this.snapshot.query + event.key);
      this.scheduleTargetUpdate();
      return;
    }

    if (event.key === '}') {
      this.closingBraceCount += 1;
      if (this.closingBraceCount === 2) this.schedule(() => void this.complete(), 75);
      else this.scheduleTargetUpdate();
      return;
    }

    this.close();
  };

  // Resolve a closed token to an existing field or create a new inline field.
  private async complete(): Promise<void> {
    this.updateTarget();
    const target = this.target;
    const alias = this.snapshot.query.trim();
    if (!target || !alias) {
      this.close();
      return;
    }

    const existing = this.fields.find((field) =>
      field.alias.trim().toLocaleLowerCase() === alias.toLocaleLowerCase());
    this.close();
    if (existing) {
      const inserted = await this.adapter.insertField(existing, target);
      if (!inserted) console.error(`Failed to insert existing field: ${existing.id}`);
      return;
    }

    const created = await this.adapter.createField(alias, target);
    if (!created) console.error(`Failed to create field: ${alias}`);
  }

  // Rebuild the replacement range and position the popup at the live caret.
  private updateTarget(observedTarget?: SelectionTarget | null): void {
    const caret = observedTarget || this.superdoc.ui.selection.current()?.selectionTarget;
    if (!caret || caret.start.kind !== 'text' || caret.end.kind !== 'text') return;
    const triggerLength = 2 + this.snapshot.query.length + this.closingBraceCount;
    if (caret.start.blockId !== caret.end.blockId || caret.end.offset < triggerLength) return;

    this.target = {
      ...caret,
      start: { ...caret.end, offset: caret.end.offset - triggerLength },
      end: { ...caret.end },
    };
    const rect = this.superdoc.ui.selection.getAnchorRect({ placement: 'end' });
    if (!rect) return;
    this.snapshot = {
      ...this.snapshot,
      left: Math.min(rect.left, window.innerWidth - 296),
      top: Math.min(rect.bottom + 6, window.innerHeight - 276),
    };
    this.emit();
  }

  // Store the query and recalculate matching suggestions.
  private setQuery(query: string): void {
    this.snapshot = { ...this.snapshot, query };
    this.refreshSuggestions();
  }

  // Filter the field catalog against alias, tag, and current value.
  private refreshSuggestions(): void {
    const query = this.snapshot.query.trim().toLocaleLowerCase();
    const suggestions = this.fields.filter((field) => !query || [field.alias, field.tag, field.value]
      .some((value) => value?.toLocaleLowerCase().includes(query))).slice(0, 8);
    this.snapshot = { ...this.snapshot, suggestions };
    this.emit();
  }

  // Reset the active token while preserving the popup's last position.
  private close(): void {
    this.pendingOpenBrace = false;
    this.closingBraceCount = 0;
    this.target = null;
    this.snapshot = { ...this.snapshot, open: false, query: '', suggestions: [] };
    this.emit();
  }

  // Wait briefly for SuperDoc's asynchronous selection to settle.
  private scheduleTargetUpdate(): void {
    this.schedule(() => this.updateTarget(), 50);
  }

  // Track delayed work so teardown cannot leave callbacks running.
  private schedule(callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  // Deduplicate copied field instances into logical autocomplete choices.
  private groupFields(fields: readonly AutofillField[]): AutofillField[] {
    const groups = new Map<string, AutofillField>();
    for (const field of fields) {
      const group = typeof field.metadata.group === 'string' ? field.metadata.group.trim() : '';
      const key = group && group !== 'field' && group !== 'clause' ? group : field.id;
      if (!groups.has(key)) groups.set(key, field);
    }
    return [...groups.values()];
  }

  // Clone mutable arrays before publishing controller state.
  private current(): AutofillSnapshot {
    return { ...this.snapshot, suggestions: [...this.snapshot.suggestions] };
  }

  // Publish a fresh snapshot to every listener.
  private emit(): void {
    const snapshot = this.current();
    for (const listener of this.listeners) listener(snapshot);
  }
}
