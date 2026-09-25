<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue';
import { BlankDOCX, DOCX, getFileObject, SuperDoc } from 'superdoc';
import type { SelectionTarget } from 'superdoc/ui';
import { FieldController, type NewFieldInput, type TemplateField } from './field-controller';
import Topbar from './components/Topbar.vue';
import FieldCard from './components/FieldCard.vue';
import FieldEditorPanel from './components/FieldEditorPanel.vue';
import FieldDeletePanel from './components/FieldDeletePanel.vue';
import VariablesPanel from './components/VariablesPanel.vue';
import FieldAutocomplete from './components/FieldAutocomplete.vue';
import {
  AutofillController,
  type AutofillAdapter,
  type AutofillField,
  type AutofillSnapshot,
} from './autofill-controller';
import { VariableHighlightController, type VariablePreviewRange } from './template-variables/controllers/highlight';
import {
  TemplateVariables,
  type TemplateRenderMode,
  type TemplateVariable,
  type TemplateVariableControl,
  type TemplateVariableValue,
} from './template-variables';

type DocumentMode = 'suggesting' | 'editing' | 'viewing';

const documentUrl = `${import.meta.env.BASE_URL}parser-test-document.docx`;

// =============================================================================
// State
// =============================================================================

const superdocInstance = shallowRef<SuperDoc | null>(null);
const fieldController = shallowRef<FieldController | null>(null);
const autofillController = shallowRef<AutofillController | null>(null);
const templateVars = shallowRef<TemplateVariables | null>(null);
const variableHighlightController = shallowRef<VariableHighlightController | null>(null);
const isReady = ref(false);
const fields = ref<TemplateField[]>([]);
const documentName = ref('parser-test-document.docx');
const documentMode = ref<'suggesting' | 'editing' | 'viewing'>('editing');
const activeTab = ref<'active' | 'all' | 'variables'>('all');
const variables = ref<TemplateVariable[]>([]);
const variablesRendered = ref(false);
const renderingVariables = ref(false);
const loadingVariables = ref(false);
const variableLoadError = ref('');
const variableRenderMode = ref<TemplateRenderMode | null>(null);
const hiddenVariableControlIds = ref<string[]>([]);
const variableControls = ref<TemplateVariableControl[]>([]);
const variablePreviewRanges = ref<VariablePreviewRange[]>([]);
const variableSyntaxPopover = ref({ visible: false, raw: '', top: 0, left: 0 });
const variablesHighlighted = ref(false);
const editingFieldId = ref<string | null>(null);
const editingInstanceIds = ref<string[]>([]);
const activeDocumentFieldId = ref<string | null>(null);
const editingSource = ref<'sidebar' | 'document' | null>(null);
const deletingFieldId = ref<string | null>(null);
const deletingInstanceIds = ref<string[]>([]);
const isDeletingField = ref(false);
const highlightedGroupKeys = ref<Set<string>>(new Set());
const highlightLockedFields = ref(false);
const fieldExplorerVisible = ref(true);
const fieldAutofillEnabled = ref(false);
const creatingMode = ref<'inline' | 'block' | null>(null);
const confirmingFieldClear = ref(false);
let insertTarget: SelectionTarget | null = null;
let pendingInsertTarget: SelectionTarget | null = null;
let selectionCaptureTimer: ReturnType<typeof setTimeout> | null = null;
const SELECTION_CAPTURE_DEBOUNCE_MS = 150;
let stopFieldSubscription: (() => void) | null = null;
let stopTemplateVariableSubscription: (() => void) | null = null;
let stopSelectionSubscription: (() => void) | null = null;
let stopAutofillSubscription: (() => void) | null = null;
let modeBeforeVariableRender: DocumentMode = 'editing';
let editorElement: Element | null = null;
const autofill = ref<AutofillSnapshot>({ open: false, query: '', suggestions: [], top: 0, left: 0 });

const hideVariableSyntaxPopover = () => {
  variableSyntaxPopover.value.visible = false;
};

const sidebarFields = computed(() => fields.value);

type GroupedSidebarField = TemplateField & {
  groupKey: string;
  instanceIds: string[];
  copyCount: number;
};

const groupedSidebarFields = computed<GroupedSidebarField[]>(() => {
  const groups = new Map<string, GroupedSidebarField>();
  for (const field of sidebarFields.value) {
    const group = typeof field.metadata.group === 'string' ? field.metadata.group.trim() : '';
    const groupKey = group && group !== 'field' && group !== 'clause' ? `group:${group}` : `instance:${field.id}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.instanceIds.push(field.id);
      existing.copyCount += 1;
    } else {
      groups.set(groupKey, { ...field, groupKey, instanceIds: [field.id], copyCount: 1 });
    }
  }
  return Array.from(groups.values());
});

const highlightAllFields = computed(() => groupedSidebarFields.value.length > 0
  && groupedSidebarFields.value.every(field => highlightedGroupKeys.value.has(field.groupKey)));

const isGroupHighlighted = (field: GroupedSidebarField) => highlightedGroupKeys.value.has(field.groupKey);

const applyFieldHighlights = () => {
  document.querySelectorAll('.template-field-highlight, .template-field-highlight-locked').forEach(element => {
    element.classList.remove('template-field-highlight', 'template-field-highlight-locked');
  });
  for (const group of groupedSidebarFields.value) {
    const groupHighlighted = isGroupHighlighted(group);
    const groupIsLocked = group.instanceIds.some(id =>
      sidebarFields.value.find(field => field.id === id)?.lockMode !== 'unlocked');
    const groupLocked = groupIsLocked && (groupHighlighted || highlightLockedFields.value);
    if (!groupHighlighted && !groupLocked) continue;
    for (const id of group.instanceIds) {
      const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
      document.querySelectorAll(`[data-sdt-id="${escapedId}"]`).forEach(element => {
        element.classList.add(groupLocked ? 'template-field-highlight-locked' : 'template-field-highlight');
      });
    }
  }
};

const scheduleFieldHighlights = () => {
  void nextTick(() => requestAnimationFrame(applyFieldHighlights));
};


const toggleAllFieldHighlights = () => {
  highlightedGroupKeys.value = highlightAllFields.value
    ? new Set()
    : new Set(groupedSidebarFields.value.map(field => field.groupKey));
};

const toggleGroupHighlight = (field: GroupedSidebarField) => {
  const next = new Set(highlightedGroupKeys.value);
  if (next.has(field.groupKey)) next.delete(field.groupKey);
  else next.add(field.groupKey);
  highlightedGroupKeys.value = next;
};

watch([highlightedGroupKeys, highlightLockedFields, groupedSidebarFields], scheduleFieldHighlights, { deep: true });

const visibleFields = computed(() => groupedSidebarFields.value);
const editingField = computed(() => sidebarFields.value.find(field => field.id === editingFieldId.value) || null);
const editingInstances = computed(() => editingInstanceIds.value
  .map(id => sidebarFields.value.find(field => field.id === id))
  .filter((field): field is TemplateField => !!field));
const deletingField = computed(() => sidebarFields.value.find(field => field.id === deletingFieldId.value) || null);
const deletingInstances = computed(() => deletingInstanceIds.value
  .map(id => sidebarFields.value.find(field => field.id === id))
  .filter((field): field is TemplateField => !!field));
const creatingField = computed<TemplateField | null>(() => creatingMode.value ? ({
  id: '',
  alias: '',
  mode: creatingMode.value,
  group: 'field',
  controlType: 'richText',
  value: '',
  lockMode: 'unlocked',
  metadata: {
    group: 'field',
    category: 'field',
  },
}) : null);

// =============================================================================
// Click Handlers
// =============================================================================

const handleValueChange = async (value: string) => {
  if (!editingField.value) return;
  if (editingField.value.lockMode !== 'unlocked') return;
  const success = await fieldController.value?.updateValue(editingInstances.value, value);
  if (!success) console.error('Failed to update one or more field values');
};

const handleAliasChange = async (alias: string) => {
  if (!editingField.value) return;
  const success = await fieldController.value?.updateAlias(editingInstances.value, alias);
  if (!success) console.error('Failed to update one or more field aliases');
};

const handleTagChange = async (tag: string) => {
  if (!editingField.value) return;
  const success = await fieldController.value?.updateTag(editingInstances.value, tag);
  if (!success) console.error('Failed to update one or more field tags');
};

const handleLockChange = async (locked: boolean) => {
  if (!editingField.value) return;
  const success = await fieldController.value?.setLocked(editingInstances.value, locked);
  if (!success) console.error('Failed to update one or more field locks');
};

const startEditingField = (field: GroupedSidebarField) => {
  editingFieldId.value = field.id;
  editingInstanceIds.value = [...field.instanceIds];
  editingSource.value = 'sidebar';
};

const closeFieldEditor = () => {
  editingFieldId.value = null;
  editingInstanceIds.value = [];
  editingSource.value = null;
  creatingMode.value = null;
};

const openActiveDocumentField = (instanceId: string) => {
  const group = groupedSidebarFields.value.find(field => field.instanceIds.includes(instanceId));
  if (!group) return;
  activeDocumentFieldId.value = instanceId;
  editingFieldId.value = group.id;
  editingInstanceIds.value = [...group.instanceIds];
  editingSource.value = 'document';
  creatingMode.value = null;
  activeTab.value = 'active';
};

const selectSidebarTab = (tab: 'active' | 'all' | 'variables') => {
  activeTab.value = tab;
  if (tab === 'active') {
    if (activeDocumentFieldId.value) openActiveDocumentField(activeDocumentFieldId.value);
    else closeFieldEditor();
  } else if (editingSource.value === 'document') {
    closeFieldEditor();
  }
};

const addVariable = (type: TemplateVariable["type"]) => templateVars.value?.add(type);

const loadVariables = async () => {
  if (!templateVars.value || loadingVariables.value) return;
  loadingVariables.value = true;
  variableLoadError.value = '';
  try {
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await templateVars.value.load();
  } catch (error) {
    variableLoadError.value = error instanceof Error ? error.message : 'Variables could not be loaded.';
    console.error('[Variable load]', error);
  } finally {
    loadingVariables.value = false;
  }
};

const clearVariableHighlights = () => {
  variableHighlightController.value?.disable();
  variablesHighlighted.value = false;
};

const toggleVariableHighlights = async () => {
  if (!variableHighlightController.value) return;
  variablesHighlighted.value = await variableHighlightController.value.toggle();
};

const removeVariable = (id: string) => templateVars.value?.remove(id);

const clearVariables = () => templateVars.value?.clear();

const updateVariable = (id: string, field: "name" | "value" | "columns", value: TemplateVariableValue | string[]) => {
  templateVars.value?.update(id, field, value);
};

const unrenderVariables = async (nextMode = modeBeforeVariableRender) => {
  if (!variablesRendered.value) return;
  superdocInstance.value?.setDocumentMode('editing');
  await templateVars.value?.unrender();
  superdocInstance.value?.setDocumentMode(nextMode);
  documentMode.value = nextMode;
};

const renderVariables = async (mode: TemplateRenderMode | 'off') => {
  clearVariableHighlights();
  if (mode === 'off') {
    await unrenderVariables();
    return;
  }

  if (variablesRendered.value && variableRenderMode.value === mode) return;

  const baseMode = variablesRendered.value ? modeBeforeVariableRender : documentMode.value;
  if (variablesRendered.value) await unrenderVariables(baseMode);

  modeBeforeVariableRender = baseMode;
  superdocInstance.value?.setDocumentMode('editing');
  try {
    await templateVars.value?.render(mode);
    if (mode === 'preview') {
      await variableHighlightController.value?.enable(false);
      variablesHighlighted.value = true;
    }
    superdocInstance.value?.setDocumentMode('viewing');
    documentMode.value = 'viewing';
  } catch (error) {
    superdocInstance.value?.setDocumentMode(modeBeforeVariableRender);
    documentMode.value = modeBeforeVariableRender;
    throw error;
  }
};

const handleDocumentFieldClick = (event: Event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const control = target.closest<HTMLElement>('[data-sdt-id]');
  const instanceId = control?.dataset.sdtId;
  if (instanceId) {
    openActiveDocumentField(instanceId);
    return;
  }
  activeDocumentFieldId.value = null;
  if (editingSource.value === 'document') closeFieldEditor();
};

const startDeletingField = (field: GroupedSidebarField) => {
  deletingFieldId.value = field.id;
  deletingInstanceIds.value = [...field.instanceIds];
};

const closeDeleteConfirmation = () => {
  if (isDeletingField.value) return;
  deletingFieldId.value = null;
  deletingInstanceIds.value = [];
};

const handleDeleteField = async () => {
  if (!deletingField.value || isDeletingField.value) return;
  isDeletingField.value = true;
  const expectedCount = deletingInstances.value.length;
  const deletedIds = await fieldController.value?.deleteFields(deletingInstances.value) || [];
  if (deletedIds.length !== expectedCount) console.error('Failed to delete one or more field instances');
  isDeletingField.value = false;
  closeDeleteConfirmation();
};

const handleCreateField = async (input: NewFieldInput) => {
  const created = await fieldController.value?.createField(input);
  if (!created) {
    console.error('Failed to create field');
    return;
  }
  creatingMode.value = null;
};

const chooseFieldMode = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  if (select.value === 'inline' || select.value === 'block') creatingMode.value = select.value;
  select.value = '';
};

const loadFields = async () => {
  confirmingFieldClear.value = false;
  await fieldController.value?.load();
};

const clearFieldList = () => {
  fieldController.value?.clearList();
  confirmingFieldClear.value = false;
};

const captureInsertSelection = () => {
  console.groupCollapsed('[Field insert] Capture cursor');
  const selection = superdocInstance.value?.ui.selection.current();
  console.log('Current UI selection', selection);
  const captured = superdocInstance.value?.ui.selection.capture();
  console.log('Captured UI selection', captured);
  const currentTarget = captured?.selectionTarget || selection?.selectionTarget;
  if (currentTarget) pendingInsertTarget = currentTarget;
  if (selectionCaptureTimer) {
    clearTimeout(selectionCaptureTimer);
    selectionCaptureTimer = null;
  }
  if (pendingInsertTarget) {
    insertTarget = pendingInsertTarget;
    pendingInsertTarget = null;
  }
  console.log('Stored insertion target', insertTarget);
  console.groupEnd();
};

const debounceInsertSelection = (target: SelectionTarget) => {
  pendingInsertTarget = target;
  if (selectionCaptureTimer) clearTimeout(selectionCaptureTimer);
  selectionCaptureTimer = setTimeout(() => {
    insertTarget = pendingInsertTarget;
    pendingInsertTarget = null;
    selectionCaptureTimer = null;
    console.log('[Field insert] Debounced cursor target', insertTarget);
  }, SELECTION_CAPTURE_DEBOUNCE_MS);
};

const handleInsertField = async (field: TemplateField) => {
  const target = insertTarget;
  console.log('[Field insert] Inserting patched inline SDT at CAPTURED CURSOR', {
    target,
    blockId: target?.start.kind === 'text' ? target.start.blockId : null,
    startOffset: target?.start.kind === 'text' ? target.start.offset : null,
    endOffset: target?.end.kind === 'text' ? target.end.offset : null,
  });
  console.groupCollapsed(`[Field insert] ${field.alias || field.id}`);
  console.log('Field', field);
  insertTarget = null;
  const insertion = await fieldController.value?.insertCopy(field, target);
  const success = !!insertion;
  console.log('Insertion completed', { success });
  if (!success) console.error(`Failed to insert field at the current cursor: ${field.id}`);
  console.groupEnd();
};

const handleAutocompleteSelect = async (field: AutofillField) => {
  await autofillController.value?.select(field);
};

const handleExport = async () => {
  console.log('Exporting...');
  await superdocInstance.value?.ui.document.export({
    exportType: ['docx'],
    exportedName: documentName.value.replace(/\.docx$/i, ''),
    triggerDownload: true,
  });
  console.log('Exported template');
};

const handleUpload = async (file: File) => {
  clearVariableHighlights();
  await unrenderVariables();
  highlightedGroupKeys.value = new Set();
  highlightLockedFields.value = false;
  await superdocInstance.value?.replaceFile(file);
  documentName.value = file.name;
  setTimeout(async () => {
    await fieldController.value?.load();
  }, 250);
};

const handleNewDocument = async () => {
  const superdoc = superdocInstance.value;
  if (!superdoc) return;

  clearVariableHighlights();
  await unrenderVariables();

  const blankDocument = await getFileObject(BlankDOCX, 'untitled.docx', DOCX);
  editingFieldId.value = null;
  editingInstanceIds.value = [];
  activeDocumentFieldId.value = null;
  editingSource.value = null;
  insertTarget = null;
  highlightedGroupKeys.value = new Set();
  highlightLockedFields.value = false;
  fields.value = [];
  documentName.value = 'untitled.docx';
  await superdoc.replaceFile(blankDocument);
  await fieldController.value?.load();
};

const handleModeChange = async (mode: DocumentMode) => {
  if (variablesRendered.value && mode !== 'viewing') {
    await unrenderVariables(mode);
    return;
  }
  superdocInstance.value?.setDocumentMode(mode);
  documentMode.value = mode;
};

const toggleFieldAutofill = () => {
  fieldAutofillEnabled.value = !fieldAutofillEnabled.value;
  autofillController.value?.setEnabled(fieldAutofillEnabled.value);
};

// =============================================================================
// Lifecycle
// =============================================================================

onMounted(() => {
  console.log('Initializing SuperDoc...');

  const superdoc = new SuperDoc({
    selector: '#superdoc-editor',
    document: documentUrl,
    documentMode: 'editing',
    role: 'editor',
    toolbar: '#superdoc-toolbar',
    user: { name: 'Demo User', email: 'demo@example.com' },
    ui: {
      contentControls: true,
      contextMenu: {
        sections: [{
          id: 'template-fields',
          items: [{
            id: 'add-field-from-selection',
            label: 'Add field using selected text',
            showWhen: ({ hasSelection }) => hasSelection,
            enabledWhen: ({ hasSelection, isEditable }) => hasSelection && isEditable,
            onSelect: async ({ context }) => {
              const target = superdoc.ui.selection.current()?.selectionTarget;
              const alias = (await context?.selectedTextSettled || '').trim();
              if (!alias || !target) return;
              await fieldController.value?.createFieldFromSelection(alias, target);
            },
          }],
        }],
      },
    },
    modules: {
      toolbar: {
        groups: {
          center: [
            'fontFamily',
            'fontSize',
            'list',
            'numberedlist',
            'indentleft',
            'indentright',
            'lineHeight',
            'clearFormatting',
          ],
        },
        hideButtons: false,
      },
      comments: {
        displayMode: 'sidebar',
      },
      contentControls: {
        chrome: 'none',
      },
    },
    onReady: async () => {
      superdocInstance.value = superdoc;
      variableHighlightController.value = new VariableHighlightController(superdoc, {
        onHover: (raw, event) => {
          variableSyntaxPopover.value = {
            visible: true,
            raw,
            top: event.clientY + 14,
            left: event.clientX + 14,
          };
        },
        onLeave: hideVariableSyntaxPopover,
      });
      fieldController.value = new FieldController(superdoc);
      templateVars.value = new TemplateVariables(superdoc, {
        onDocumentRestored: async () => { await fieldController.value?.load(); },
      });
      stopFieldSubscription = fieldController.value.subscribe((snapshot) => {
        const nextFields = [...snapshot];
        if (JSON.stringify(nextFields) === JSON.stringify(fields.value)) return;
        fields.value = nextFields;
        console.log(`Field controller: ${snapshot.length} fields`);
      });
      stopTemplateVariableSubscription = templateVars.value.subscribe((state) => {
        variables.value = [...state.variables];
        variablesRendered.value = state.rendered;
        renderingVariables.value = state.rendering;
        variableRenderMode.value = state.mode;
        hiddenVariableControlIds.value = [...state.hiddenControlIds];
        variablePreviewRanges.value = [...state.previewRanges];
        variableHighlightController.value?.setPreviewRanges(state.previewRanges);
        variableControls.value = [
          ...state.previewControls.map(control => ({ ...control, alias: '', kind: 'inline' as const })),
          ...state.variableControls,
        ];
      });
      isReady.value = true;
      console.log('SuperDoc ready');

      await fieldController.value.initialize();

      const autofillAdapter: AutofillAdapter = {
        subscribeToFields: (listener) => fieldController.value!.subscribe(fields => listener(fields)),
        insertField: async (field, target) => {
          const source = fieldController.value?.get(field.id);
          if (!source) return false;
          return !!await fieldController.value?.replaceRangeWithFieldCopy(source, target);
        },
        createField: async (alias, target) => fieldController.value?.createField({
          alias,
          value: alias,
          mode: 'inline',
          locked: false,
          metadata: { group: 'field', category: 'field' },
        }, target) || null,
      };
      autofillController.value = new AutofillController(superdoc, autofillAdapter);
      stopAutofillSubscription = autofillController.value.subscribe((snapshot) => {
        autofill.value = snapshot;
      });
      editorElement = document.querySelector('#superdoc-editor');
      if (editorElement) autofillController.value.initialize(editorElement);
      editorElement?.addEventListener('click', handleDocumentFieldClick);

      stopSelectionSubscription = superdoc.ui.selection.observe((snapshot) => {
        if (snapshot.selectionTarget) debounceInsertSelection(snapshot.selectionTarget);
      });

    },
  });
});

onBeforeUnmount(() => {
  if (selectionCaptureTimer) clearTimeout(selectionCaptureTimer);
  stopFieldSubscription?.();
  stopTemplateVariableSubscription?.();
  stopSelectionSubscription?.();
  stopAutofillSubscription?.();
  variableHighlightController.value?.destroy();
  autofillController.value?.destroy();
  fieldController.value?.destroy();
  templateVars.value?.destroy();
  editorElement?.removeEventListener('click', handleDocumentFieldClick);
  superdocInstance.value?.destroy();
});
</script>

<template>
  <div class="app">
    <Topbar
      :document-name="documentName"
      :ready="isReady"
      :mode="documentMode"
      :variables-rendered="variablesRendered"
      :field-explorer-visible="fieldExplorerVisible"
      :field-autofill-enabled="fieldAutofillEnabled"
      @upload="handleUpload"
      @new-document="handleNewDocument"
      @export="handleExport"
      @mode-change="handleModeChange"
      @toggle-field-explorer="fieldExplorerVisible = !fieldExplorerVisible"
      @toggle-field-autofill="toggleFieldAutofill"
    />

    <!-- Main Content -->
    <div class="main">
      <!-- Editor -->
      <div class="editor-container">
        <div class="editor-wrapper" :class="{ 'variables-rendered': variablesRendered }">
          <div id="superdoc-editor"></div>
        </div>
      </div>

      <FieldAutocomplete
        v-if="autofill.open"
        :fields="[...autofill.suggestions]"
        :query="autofill.query"
        :top="autofill.top"
        :left="autofill.left"
        @select="handleAutocompleteSelect"
      />

      <div
        v-if="variableSyntaxPopover.visible"
        class="variable-syntax-popover"
        :style="{ top: `${variableSyntaxPopover.top}px`, left: `${variableSyntaxPopover.left}px` }"
        role="tooltip"
      >{{ variableSyntaxPopover.raw }}</div>

      <!-- Field List Sidebar -->
      <aside v-if="fieldExplorerVisible" class="sidebar">
        <div v-if="activeTab !== 'variables'" class="highlight-toolbar">
          <button
            :class="{ active: highlightAllFields }"
            :aria-pressed="highlightAllFields"
            @click="toggleAllFieldHighlights"
          >Highlight all</button>
          <button
            :class="{ active: highlightLockedFields }"
            :aria-pressed="highlightLockedFields"
            @click="highlightLockedFields = !highlightLockedFields"
          >Highlight locked</button>
        </div>

        <div v-if="!creatingField && !deletingField && (!editingField || editingSource === 'document')" class="sidebar-tabs" role="tablist" aria-label="Field views">
          <button :class="{ active: activeTab === 'active' }" @click="selectSidebarTab('active')">Active field</button>
          <button :class="{ active: activeTab === 'all' }" @click="selectSidebarTab('all')">Fields</button>
          <button :class="{ active: activeTab === 'variables' }" @click="selectSidebarTab('variables')">Variables</button>
        </div>

        <VariablesPanel
          v-if="!editingField && !creatingField && !deletingField && activeTab === 'variables'"
          :variables="variables"
          :variables-rendered="variablesRendered"
          :rendering-variables="renderingVariables"
          :loading-variables="loadingVariables"
          :variables-highlighted="variablesHighlighted"
          :load-error="variableLoadError"
          :render-mode="variableRenderMode"
          @add="addVariable"
          @load="loadVariables"
          @highlight="toggleVariableHighlights"
          @render="renderVariables"
          @remove="removeVariable"
          @clear="clearVariables"
          @update="updateVariable"
        />

        <template v-else-if="!editingField && !creatingField && !deletingField && activeTab !== 'active'">

          <div class="sidebar-heading">
            <div>
              <span>Template fields</span>
              <strong>{{ visibleFields.length }} {{ visibleFields.length === 1 ? 'field' : 'fields' }}</strong>
            </div>
            <div class="sidebar-heading-actions">
              <button
                class="field-action-button"
                :disabled="!visibleFields.length"
                @click="confirmingFieldClear = true"
              >Clear</button>
              <button class="field-action-button" @click="loadFields">Load</button>
              <select aria-label="Add field" value="" @change="chooseFieldMode">
                <option value="" disabled>Add</option>
                <option value="inline">Inline</option>
                <option value="block">Block</option>
              </select>
            </div>
            <div v-if="confirmingFieldClear" class="field-clear-confirmation" role="alert">
              <p>Do you want to remove all fields from this list? Fields present in the document will remain in the document.</p>
              <div>
                <button type="button" @click="confirmingFieldClear = false">Cancel</button>
                <button class="confirm-clear" type="button" @click="clearFieldList">Remove all</button>
              </div>
            </div>
          </div>

          <div v-if="visibleFields.length" class="field-cards">
            <FieldCard
              v-for="field in visibleFields"
              :key="field.id"
              :field="field"
              :copy-count="field.copyCount"
              :highlighted="isGroupHighlighted(field)"
              @edit="startEditingField(field)"
              @delete="startDeletingField(field)"
              @toggle-highlight="toggleGroupHighlight(field)"
              @prepare-insert="captureInsertSelection"
              @insert="handleInsertField"
            />
          </div>
          <div v-else class="empty-state">
            No fields in this view.
          </div>
        </template>

        <div v-else-if="!editingField && !creatingField && !deletingField && activeTab === 'active'" class="empty-state active-field-empty">
          Click a field in the document to edit it here.
        </div>

        <FieldDeletePanel
          v-else-if="deletingField"
          :field="deletingField"
          :instance-count="deletingInstances.length"
          :deleting="isDeletingField"
          @back="closeDeleteConfirmation"
          @cancel="closeDeleteConfirmation"
          @confirm="handleDeleteField"
        />

        <FieldEditorPanel
          v-else
          :key="editingField?.id || `new-${creatingMode}`"
          :field="editingField || creatingField!"
          :instances="editingInstances"
          :creating="!!creatingField"
          :show-back="editingSource !== 'document'"
          @back="closeFieldEditor"
          @value-change="handleValueChange"
          @alias-change="handleAliasChange"
          @tag-change="handleTagChange"
          @lock-change="handleLockChange"
          @save="handleCreateField"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: white;
  border-bottom: 1px solid #e0e0e0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.header-hint {
  color: #666;
  font-size: 14px;
}

.header-hint code {
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-label {
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.toggle-btn {
  padding: 4px 12px;
  border: 1px solid #d0d0d0;
  background: white;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.toggle-btn:first-of-type {
  border-radius: 4px 0 0 4px;
}

.toggle-btn:last-of-type {
  border-radius: 0 4px 4px 0;
  margin-left: -1px;
}

.toggle-btn:hover:not(:disabled) {
  background: #f5f5f5;
}

.toggle-btn.active {
  background: #2563eb;
  border-color: #2563eb;
  color: white;
}

.toggle-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #2563eb;
  color: white;
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.btn-outline {
  background: white;
  color: #2563eb;
  border: 1px solid #2563eb;
}

.btn-outline:hover:not(:disabled) {
  background: #eff6ff;
}

.main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.editor-container {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
  padding: 16px;
}

.toolbar {
  background: white;
  border: 1px solid #e0e0e0;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
}

.editor-wrapper {
  flex: 1;
  background: white;
  border: 1px solid #e0e0e0;
  border-top: none;
  border-radius: 0 0 8px 8px;
  overflow: auto;
}

.editor-wrapper.variables-rendered {
  outline: 2px solid #2563eb;
  outline-offset: -2px;
}

.sidebar {
  position: relative;
  width: 520px;
  flex-shrink: 0;
  background: white;
  border-left: 1px solid #e0e0e0;
  padding: 0 14px 16px;
  overflow-y: auto;
}

.highlight-toolbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding: 10px 0 0; }
.highlight-toolbar button { width: 100%; padding: 8px 12px; color: #245fae; background: #fff; border: 1px solid #b9c9df; border-radius: 7px; font-size: 11px; font-weight: 750; cursor: pointer; }
.highlight-toolbar button:hover, .highlight-toolbar button.active { color: #fff; background: #2563eb; border-color: #2563eb; }

:global([data-sdt-id].template-field-highlight) {
  background: rgba(250, 204, 21, .3) !important;
  box-shadow: inset 0 0 0 2px rgba(234, 179, 8, .75) !important;
}

:global([data-sdt-id].template-field-highlight-locked) {
  background: rgba(239, 68, 68, .22) !important;
  box-shadow: inset 0 0 0 2px rgba(220, 38, 38, .78) !important;
}

.variable-syntax-popover {
  position: fixed;
  z-index: 10000;
  max-width: 360px;
  padding: 8px 10px;
  color: #f8fafc;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, .22);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow-wrap: anywhere;
  pointer-events: none;
}

.sidebar-tabs {
  position: sticky;
  z-index: 5;
  top: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 0 -14px;
  padding: 9px 8px 0;
  background: #fff;
  border-bottom: 1px solid #e1e4e8;
}

.active-field-empty { padding-top: 24px; }

.sidebar-tabs button {
  position: relative;
  padding: 10px 3px 11px;
  color: #717985;
  background: transparent;
  border: 0;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.sidebar-tabs button.active {
  color: #245fae;
}

.sidebar-tabs button.active::after {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  background: #2563eb;
  border-radius: 2px 2px 0 0;
  content: '';
}

.sidebar-heading {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 10px;
  padding: 16px 1px 12px;
}

.sidebar-heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-heading > .sidebar-heading-actions {
  width: 100%;
  flex-direction: row;
  gap: 7px;
}

.sidebar-heading-actions button,
.sidebar-heading-actions select { padding: 7px 10px; color: #245fae; background: #fff; border: 1px solid #b9c9df; border-radius: 7px; font-size: 11px; font-weight: 750; cursor: pointer; }
.sidebar-heading-actions select { padding-right: 28px; color: #fff; background-color: #2563eb; border-color: #2563eb; }
.sidebar-heading-actions button:hover { color: #1d4ed8; background: #f8fafc; border-color: #8da9cf; }
.sidebar-heading-actions select:hover { background-color: #1d4ed8; }
.sidebar-heading-actions button:disabled { cursor: default; opacity: .5; }
.field-clear-confirmation { width: 100%; padding: 11px; color: #4b5563; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 7px; font-size: 12px; line-height: 1.4; }
.field-clear-confirmation > div { display: flex; flex-direction: row; gap: 7px; margin-top: 9px; }
.field-clear-confirmation button { padding: 7px 10px; color: #596273; background: #fff; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 11px; font-weight: 750; cursor: pointer; }
.field-clear-confirmation .confirm-clear { color: #fff; background: #b42318; border-color: #b42318; }

.sidebar-heading span {
  color: #8a919b;
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.sidebar-heading strong {
  color: #303640;
  font-size: 13px;
}

.field-cards {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.sidebar h2 {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin: 0 0 16px 0;
}

.field-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px;
  background: #fafafa;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.field-item:hover {
  border-color: #d0d0d0;
}

.field-item.selected {
  border-color: #2563eb;
  background: #eff6ff;
}

.field-content {
  flex: 1;
  min-width: 0;
}

.field-alias {
  font-size: 14px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.field-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: #888;
}

.field-id {
  font-family: monospace;
}

.btn-delete {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #999;
  border-radius: 4px;
  transition: all 0.15s;
}

.btn-delete:hover {
  color: #ef4444;
  background: #fef2f2;
}

.empty-state {
  color: #888;
  font-size: 14px;
  text-align: center;
  padding: 24px;
}
</style>
