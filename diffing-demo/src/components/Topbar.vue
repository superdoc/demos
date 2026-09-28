<script setup lang="ts">
import { ref } from 'vue';

type DocumentMode = 'suggesting' | 'editing' | 'viewing';

defineProps<{
  documentName: string;
  ready: boolean;
  mode: DocumentMode;
  leftDocumentName: string;
  rightDocumentName: string;
  canDiff: boolean;
  busy: boolean;
  diffStatus: string;
}>();

const emit = defineEmits<{
  export: [];
  newDocument: [];
  upload: [file: File];
  uploadLeft: [file: File];
  uploadRight: [file: File];
  diff: [];
  modeChange: [mode: DocumentMode];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const leftFileInput = ref<HTMLInputElement | null>(null);
const rightFileInput = ref<HTMLInputElement | null>(null);
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

const emitDocument = (side: 'left' | 'right', file?: File) => {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.docx')) {
    importError.value = 'Choose a .docx file.';
    return;
  }
  importError.value = '';
  if (side === 'left') emit('uploadLeft', file);
  else emit('uploadRight', file);
  const input = side === 'left' ? leftFileInput.value : rightFileInput.value;
  if (input) input.value = '';
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
    <div class="topbar-row">
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        @change="uploadDocument(($event.target as HTMLInputElement).files?.[0])"
      />
      <input
        ref="leftFileInput"
        class="visually-hidden"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        @change="emitDocument('left', ($event.target as HTMLInputElement).files?.[0])"
      />
      <input
        ref="rightFileInput"
        class="visually-hidden"
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        @change="emitDocument('right', ($event.target as HTMLInputElement).files?.[0])"
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
      <div class="file-name">{{ documentName }}</div>
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
    </div>
    <div class="diff-row">
      <div class="diff-actions">
        <button type="button" :disabled="!ready || busy" @click="leftFileInput?.click()">
          Upload left document
        </button>
        <button type="button" :disabled="!ready || busy" @click="rightFileInput?.click()">
          Upload right document
        </button>
        <button type="button" class="diff-button" :disabled="!canDiff" @click="emit('diff')">
          {{ busy ? 'Working…' : 'Diff document' }}
        </button>
      </div>
      <div class="diff-feedback" aria-live="polite">
        <span v-if="leftDocumentName" title="Left document">Left: {{ leftDocumentName }}</span>
        <span v-if="rightDocumentName" title="Right document">Right: {{ rightDocumentName }}</span>
        <strong v-if="diffStatus">{{ diffStatus }}</strong>
      </div>
    </div>
    <div class="toolbar-row">
      <div id="superdoc-toolbar" class="default-toolbar" aria-label="Document toolbar" />
    </div>
  </header>
</template>

<style scoped>
.topbar {
  z-index: 12;
  display: grid;
  grid-template-rows: 50px 58px 72px;
  background: #f8f8f8;
  border-bottom: 1px solid #cfd5dd;
  box-shadow: 0 1px 5px #11182712;
}

.diff-row {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 8px 10px;
  border-bottom: 1px solid #e1e5ea;
}

.diff-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.diff-actions button {
  min-height: 34px;
  padding: 0 14px;
  color: #303640;
  background: #fff;
  border: 1px solid #cfd4db;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.diff-actions button:hover:not(:disabled) {
  border-color: #8aa7cc;
  background: #f7faff;
}

.diff-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.diff-actions .diff-button {
  color: #fff;
  background: #2563eb;
  border-color: #2563eb;
}

.diff-actions .diff-button:hover:not(:disabled) {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

.diff-feedback {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
  color: #5b6472;
  font-size: 11px;
  white-space: nowrap;
}

.diff-feedback span {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.diff-feedback strong {
  overflow: hidden;
  color: #1f5b3a;
  font-weight: 700;
  text-overflow: ellipsis;
}

.topbar-row {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid #e1e5ea;
}

.file-name {
  position: absolute;
  left: 50%;
  max-width: 520px;
  padding: 4px 9px;
  overflow: hidden;
  color: #20242c;
  transform: translateX(-50%);
  font-size: 16px;
  white-space: nowrap;
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

.toolbar-row {
  position: relative;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  overflow-x: auto;
  overflow-y: hidden;
}
</style>
