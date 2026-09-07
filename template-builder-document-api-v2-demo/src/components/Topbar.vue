<script setup lang="ts">
import { ref } from 'vue';

type DocumentMode = 'suggesting' | 'editing' | 'viewing';

defineProps<{
  documentName: string;
  ready: boolean;
  mode: DocumentMode;
  fieldExplorerVisible: boolean;
}>();

const emit = defineEmits<{
  export: [];
  newDocument: [];
  upload: [file: File];
  modeChange: [mode: DocumentMode];
  toggleFieldExplorer: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const importError = ref('');

const uploadDocument = (file?: File) => {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.docx')) {
    importError.value = 'Choose a .docx file.';
    return;
  }

  importError.value = '';
  emit('upload', file);
  if (fileInput.value) fileInput.value.value = '';
};

const chooseFileAction = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  if (select.value === 'new') emit('newDocument');
  if (select.value === 'upload') fileInput.value?.click();
  if (select.value === 'save-as') emit('export');
  select.value = '';
};
</script>

<template>
  <header class="topbar">
    <div class="ribbon-tabs-row">
      <div class="file-title">
        <div class="file-name">{{ documentName }}</div>
      </div>

      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        @change="uploadDocument(($event.target as HTMLInputElement).files?.[0])"
      />

      <select
        class="file-menu"
        aria-label="File"
        value=""
        :disabled="!ready"
        :title="importError || undefined"
        @change="chooseFileAction"
      >
        <option value="" disabled>File</option>
        <option value="new">New document</option>
        <option value="upload">Upload…</option>
        <option value="save-as">Save As…</option>
      </select>

      <a class="more-demos-button" href="/">Demos</a>

      <label class="mode-select">
        <select
          aria-label="Document mode"
          :value="mode"
          :disabled="!ready"
          @change="emit('modeChange', ($event.target as HTMLSelectElement).value as DocumentMode)"
        >
          <option value="suggesting">Reviewing</option>
          <option value="editing">Editing</option>
          <option value="viewing">Viewing</option>
        </select>
      </label>

      <button
        class="field-explorer-toggle"
        :class="{ active: fieldExplorerVisible }"
        :aria-pressed="fieldExplorerVisible"
        @click="emit('toggleFieldExplorer')"
      >{{ fieldExplorerVisible ? 'Hide field explorer' : 'Show field explorer' }}</button>
    </div>

    <div class="ribbon-controls-row">
      <div id="superdoc-toolbar" class="default-toolbar" aria-label="Document toolbar" />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  z-index: 12;
  display: grid;
  grid-template-rows: 50px 72px;
  background: #f8f8f8;
  border-bottom: 1px solid #cfd5dd;
  box-shadow: 0 1px 5px #11182712;
}

.ribbon-tabs-row {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid #e1e5ea;
}

.file-title {
  position: absolute;
  left: 50%;
  display: flex;
  min-width: 260px;
  transform: translateX(-50%);
  text-align: center;
}

.file-name {
  max-width: 520px;
  display: flex;
  align-items: center;
  gap: 9px;
  margin: auto;
  padding: 4px 9px;
  overflow: hidden;
  color: #20242c;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-menu {
  min-width: 112px;
  height: 34px;
  padding: 5px 28px 5px 10px;
  color: #303640;
  background: #fff;
  border: 1px solid #cfd4db;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 750;
}

.more-demos-button {
  display: inline-flex;
  height: 34px;
  align-items: center;
  margin-left: 8px;
  padding: 0 13px;
  color: #fff;
  background: #2563eb;
  border: 1px solid #2563eb;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 750;
  text-decoration: none;
  white-space: nowrap;
}

.more-demos-button:hover {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

.more-demos-button:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 3px #3b82f638;
}

.mode-select {
  display: flex;
  align-items: center;
  margin-left: auto;
}

.mode-select select {
  min-width: 122px;
  padding: 8px 30px 8px 10px;
  color: #303640;
  background: #fff;
  border: 1px solid #cfd4db;
  border-radius: 8px;
  outline: none;
  font-size: 12px;
  font-weight: 700;
}

.field-explorer-toggle {
  margin-left: 8px;
  padding: 8px 11px;
  color: #245fae;
  background: #fff;
  border: 1px solid #b9c9df;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;
}

.field-explorer-toggle.active {
  color: #fff;
  background: #2563eb;
  border-color: #2563eb;
}

.mode-select select:focus,
.file-menu:focus {
  border-color: #3b82f6;
  outline: 0;
  box-shadow: 0 0 0 3px #3b82f61c;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.ribbon-controls-row {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  overflow-x: auto;
  overflow-y: hidden;
}

.default-toolbar {
  width: auto;
  background: #f8f8f8;
}

.default-toolbar :deep(.superdoc-toolbar),
.default-toolbar :deep(.toolbar) {
  width: 100%;
  background: #f8f8f8 !important;
  border: 0 !important;
  box-shadow: none !important;
}
</style>
