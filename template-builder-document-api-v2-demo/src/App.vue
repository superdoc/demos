<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue';
import { BlankDOCX, DOCX, getFileObject, SuperDoc } from 'superdoc';
import type { SelectionTarget } from 'superdoc/ui';
import { FieldController, type NewFieldInput, type TemplateField } from './field-controller';
import Topbar from './components/Topbar.vue';
import FieldCard from './components/FieldCard.vue';
import FieldEditorPanel from './components/FieldEditorPanel.vue';
import FieldDeletePanel from './components/FieldDeletePanel.vue';

const documentUrl = `${import.meta.env.BASE_URL}brief-nda.docx`;

// =============================================================================
// State
// =============================================================================

const superdocInstance = shallowRef<SuperDoc | null>(null);
const fieldController = shallowRef<FieldController | null>(null);
const isReady = ref(false);
const fields = ref<TemplateField[]>([]);
const documentName = ref('brief-nda.docx');
const documentMode = ref<'suggesting' | 'editing' | 'viewing'>('editing');
const activeTab = ref<'active' | 'all' | 'clause'>('all');
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
const creatingType = ref<'field' | 'clause' | null>(null);
let insertTarget: SelectionTarget | null = null;
let pendingInsertTarget: SelectionTarget | null = null;
let selectionCaptureTimer: ReturnType<typeof setTimeout> | null = null;
const SELECTION_CAPTURE_DEBOUNCE_MS = 150;
let stopFieldSubscription: (() => void) | null = null;

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

const clauseFields = computed(() => groupedSidebarFields.value.filter(field =>
  field.metadata.category === 'clause'
  || typeof field.metadata.clauseType === 'string'
  || field.metadata.group === 'clause'));
const visibleFields = computed(() => {
  if (activeTab.value === 'clause') return clauseFields.value;
  return groupedSidebarFields.value;
});
const editingField = computed(() => sidebarFields.value.find(field => field.id === editingFieldId.value) || null);
const editingInstances = computed(() => editingInstanceIds.value
  .map(id => sidebarFields.value.find(field => field.id === id))
  .filter((field): field is TemplateField => !!field));
const deletingField = computed(() => sidebarFields.value.find(field => field.id === deletingFieldId.value) || null);
const deletingInstances = computed(() => deletingInstanceIds.value
  .map(id => sidebarFields.value.find(field => field.id === id))
  .filter((field): field is TemplateField => !!field));
const creatingField = computed<TemplateField | null>(() => creatingType.value ? ({
  id: '',
  alias: '',
  mode: creatingType.value === 'clause' ? 'block' : 'inline',
  group: creatingType.value === 'clause' ? 'clause' : 'field',
  controlType: 'richText',
  value: '',
  lockMode: 'unlocked',
  metadata: {
    group: creatingType.value === 'clause' ? 'clause' : 'field',
    category: creatingType.value === 'clause' ? 'clause' : 'field',
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
  creatingType.value = null;
};

const openActiveDocumentField = (instanceId: string) => {
  const group = groupedSidebarFields.value.find(field => field.instanceIds.includes(instanceId));
  if (!group) return;
  activeDocumentFieldId.value = instanceId;
  editingFieldId.value = group.id;
  editingInstanceIds.value = [...group.instanceIds];
  editingSource.value = 'document';
  creatingType.value = null;
  activeTab.value = 'active';
};

const selectSidebarTab = (tab: 'active' | 'all' | 'clause') => {
  activeTab.value = tab;
  if (tab === 'active') {
    if (activeDocumentFieldId.value) openActiveDocumentField(activeDocumentFieldId.value);
    else closeFieldEditor();
  } else if (editingSource.value === 'document') {
    closeFieldEditor();
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
  creatingType.value = null;
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

const handleModeChange = (mode: 'suggesting' | 'editing' | 'viewing') => {
  superdocInstance.value?.setDocumentMode(mode);
  documentMode.value = mode;
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
      fieldController.value = new FieldController(superdoc);
      stopFieldSubscription = fieldController.value.subscribe((snapshot) => {
        fields.value = [...snapshot];
        console.log(`Field controller: ${snapshot.length} fields`);
      });
      isReady.value = true;
      console.log('SuperDoc ready');

      await fieldController.value.initialize();

      superdoc.ui.selection.observe((snapshot) => {
        if (snapshot.selectionTarget) debounceInsertSelection(snapshot.selectionTarget);
      });

    },
  });
  document.querySelector('#superdoc-editor')?.addEventListener('click', handleDocumentFieldClick);
});

onBeforeUnmount(() => {
  if (selectionCaptureTimer) clearTimeout(selectionCaptureTimer);
  stopFieldSubscription?.();
  fieldController.value?.destroy();
  document.querySelector('#superdoc-editor')?.removeEventListener('click', handleDocumentFieldClick);
  superdocInstance.value?.destroy();
});
</script>

<template>
  <div class="app">
    <Topbar
      :document-name="documentName"
      :ready="isReady"
      :mode="documentMode"
      :field-explorer-visible="fieldExplorerVisible"
      @upload="handleUpload"
      @new-document="handleNewDocument"
      @export="handleExport"
      @mode-change="handleModeChange"
      @toggle-field-explorer="fieldExplorerVisible = !fieldExplorerVisible"
    />

    <!-- Main Content -->
    <div class="main">
      <!-- Editor -->
      <div class="editor-container">
        <div class="editor-wrapper">
          <div id="superdoc-editor"></div>
        </div>
      </div>

      <!-- Field List Sidebar -->
      <aside v-if="fieldExplorerVisible" class="sidebar">
        <div class="highlight-toolbar">
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
          <button :class="{ active: activeTab === 'clause' }" @click="selectSidebarTab('clause')">Clauses</button>
        </div>

        <template v-if="!editingField && !creatingField && !deletingField && activeTab !== 'active'">

          <div class="sidebar-heading">
            <div>
              <span>{{ activeTab === 'clause' ? 'Clause library' : 'Template fields' }}</span>
              <strong>{{ visibleFields.length }} {{ visibleFields.length === 1 ? 'field' : 'fields' }}</strong>
            </div>
            <button class="new-field-button" @click="creatingType = activeTab === 'clause' ? 'clause' : 'field'">
              {{ activeTab === 'clause' ? 'New clause' : 'New field' }}
            </button>
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
          :key="editingField?.id || `new-${creatingType}`"
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
  align-items: center;
  justify-content: space-between;
  padding: 16px 1px 12px;
}

.sidebar-heading > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

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

.new-field-button { padding: 7px 10px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; font-size: 11px; font-weight: 750; cursor: pointer; }
.new-field-button:hover { background: #1d4ed8; }

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
