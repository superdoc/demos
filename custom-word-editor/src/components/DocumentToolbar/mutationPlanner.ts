import type { ContentControlInfo, DocumentApi, PartialBrowserDocumentApi, SelectionInfo, SelectionTarget } from 'superdoc/ui';
import { getSelectedContentControls, isContentLocked } from './contentControlSelection';
import { checkReceipt } from './operationResults';

type MutationPlan = Parameters<DocumentApi['mutations']['apply']>[0];
type MutationStep = MutationPlan['steps'][number];
type AtomicPlanEntry = Parameters<DocumentApi['plan']['execute']>[0]['entries'][number];

export type ChangeMode = MutationPlan['changeMode'];
export type InlineFormatting = Parameters<DocumentApi['format']['apply']>[0]['inline'];

/** The two changes the toolbar can make to selected text. */
export type SelectionChange =
  | { kind: 'format'; target: SelectionTarget; inline: InlineFormatting }
  | { kind: 'replaceText'; target: SelectionTarget; text: string };

interface ApplySelectionChangesInput {
  doc: PartialBrowserDocumentApi;
  selection: SelectionInfo;
  changes: SelectionChange[];
  changeMode: ChangeMode;
}

/**
 * Entry point shared by toolbar buttons and keyboard shortcuts.
 *
 * Ordinary text: apply the mutation plan directly.
 * Locked controls: unlock → apply the same plan → restore original locks.
 * The locked path commits once, rolls back on failure, and adds one Undo entry.
 */
export async function applySelectionChanges({ doc, selection, changes, changeMode }: ApplySelectionChangesInput) {
  if (changes.length === 0) return;

  const mutation = createMutationPlan(changes, changeMode);
  const selectedControls = await getSelectedContentControls(doc, selection);
  const lockedControls = selectedControls.filter(isContentLocked);

  if (lockedControls.length === 0) {
    if (!doc.mutations?.apply) throw new Error('The mutation planner is unavailable.');
    checkReceipt(await doc.mutations.apply(mutation));
    return;
  }

  if (!doc.plan?.execute) throw new Error('Atomic formatting is unavailable.');

  const unlockControls = lockedControls.map((control) => setControlLock(control, 'unlocked'));
  const applyFormatting: AtomicPlanEntry = { operationId: 'mutations.apply', input: mutation };
  // Restore inner controls before their enclosing controls.
  const restoreLocks = [...lockedControls].reverse().map((control) => setControlLock(control, control.lockMode));

  const result = await doc.plan.execute({
    atomic: true,
    entries: [...unlockControls, applyFormatting, ...restoreLocks],
  });

  if (result.failure) throw new Error(result.failure.message);
}

function createMutationPlan(changes: SelectionChange[], changeMode: ChangeMode): MutationPlan {
  return {
    atomic: true,
    changeMode,
    steps: changes.map(createMutationStep),
  };
}

function createMutationStep(change: SelectionChange, index: number): MutationStep {
  const where = { by: 'target', target: change.target } as const;

  switch (change.kind) {
    case 'format':
      return {
        id: `format-${index}`,
        op: 'format.apply',
        where,
        args: { inline: change.inline },
      } satisfies Extract<MutationStep, { op: 'format.apply' }>;

    case 'replaceText':
      return {
        id: `replace-${index}`,
        op: 'text.rewrite',
        where,
        args: { replacement: { text: change.text } },
      } satisfies Extract<MutationStep, { op: 'text.rewrite' }>;
  }
}

function setControlLock(control: ContentControlInfo, lockMode: ContentControlInfo['lockMode']): AtomicPlanEntry {
  return {
    operationId: 'contentControls.setLockMode',
    input: { target: control.target, lockMode },
    // Only the text change is tracked in Reviewing mode; lock changes stay direct.
    options: { changeMode: 'direct' },
  };
}
