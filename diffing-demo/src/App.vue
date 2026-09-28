<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { BlankDOCX, DOCX, getFileObject, SuperDoc } from 'superdoc';
import Topbar from './components/Topbar.vue';

type DocumentMode = 'suggesting' | 'editing' | 'viewing';

const leftSuperdoc = shallowRef<SuperDoc | null>(null);
const rightSuperdoc = shallowRef<SuperDoc | null>(null);
const previewSuperdoc = shallowRef<SuperDoc | null>(null);
const leftReady = ref(false);
const rightReady = ref(false);
const previewReady = ref(false);
const leftDocumentName = ref('untitled.docx');
const rightDocumentName = ref('untitled.docx');
const documentMode = ref<DocumentMode>('editing');
const leftDocumentLoaded = ref(false);
const rightDocumentLoaded = ref(false);
const previewHasResult = ref(false);
const isLoading = ref(false);
const isDiffing = ref(false);
const diffStatus = ref('Upload a left and right DOCX to compare them.');

const editorsReady = computed(() => leftReady.value && rightReady.value && previewReady.value);
const canDiff = computed(() => (
  editorsReady.value
  && leftDocumentLoaded.value
  && rightDocumentLoaded.value
  && !isLoading.value
  && !isDiffing.value
));

const replaceAndWaitForSource = async (superdoc: SuperDoc, source: File | Blob) => {
  let onComplete: (() => void) | null = null;
  const sourceComplete = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (onComplete) superdoc.off('source:complete', onComplete);
      reject(new Error('The document took too long to load.'));
    }, 30_000);

    onComplete = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    superdoc.once('source:complete', onComplete);
  });

  await Promise.all([superdoc.replaceFile(source), sourceComplete]);
};

const handleExport = async () => {
  await leftSuperdoc.value?.ui.document.export({
    exportType: ['docx'],
    exportedName: leftDocumentName.value.replace(/\.docx$/i, ''),
    triggerDownload: true,
  });
};

const handleLeftUpload = async (file: File) => {
  const superdoc = leftSuperdoc.value;
  if (!superdoc) return;
  isLoading.value = true;
  diffStatus.value = 'Loading the left document…';
  try {
    await replaceAndWaitForSource(superdoc, file);
    leftDocumentName.value = file.name;
    leftDocumentLoaded.value = true;
    previewHasResult.value = false;
    diffStatus.value = rightDocumentLoaded.value
      ? 'Documents ready to compare.'
      : 'Left document loaded. Upload the right document.';
  } catch (error) {
    console.error('Could not load the left document.', error);
    diffStatus.value = 'Could not load the left document. See console.';
  } finally {
    isLoading.value = false;
  }
};

const handleRightUpload = async (file: File) => {
  const superdoc = rightSuperdoc.value;
  if (!superdoc) return;
  isLoading.value = true;
  diffStatus.value = 'Loading the right document…';
  try {
    await replaceAndWaitForSource(superdoc, file);
    rightDocumentName.value = file.name;
    rightDocumentLoaded.value = true;
    previewHasResult.value = false;
    diffStatus.value = leftDocumentLoaded.value
      ? 'Documents ready to compare.'
      : 'Right document loaded. Upload the left document.';
  } catch (error) {
    console.error('Could not load the right document.', error);
    diffStatus.value = 'Could not load the right document. See console.';
  } finally {
    isLoading.value = false;
  }
};

const handleNewDocument = async () => {
  const superdoc = leftSuperdoc.value;
  if (!superdoc) return;
  const blankDocument = await getFileObject(BlankDOCX, 'untitled.docx', DOCX);
  await replaceAndWaitForSource(superdoc, blankDocument);
  leftDocumentName.value = 'untitled.docx';
  leftDocumentLoaded.value = false;
  previewHasResult.value = false;
  diffStatus.value = 'Upload a left and right DOCX to compare them.';
};

const handleModeChange = (mode: DocumentMode) => {
  leftSuperdoc.value?.setDocumentMode(mode);
  documentMode.value = mode;
};

const handleDiff = async () => {
  const rightDoc = rightSuperdoc.value?.activeEditor?.doc;
  const preview = previewSuperdoc.value;
  if (!rightDoc || !preview || !canDiff.value) return;

  isDiffing.value = true;
  diffStatus.value = 'Preparing documents for comparison…';

  try {
    const leftPackage = await leftSuperdoc.value?.export({ triggerDownload: false });
    if (!(leftPackage instanceof Blob)) throw new Error('Could not clone the left document for preview.');

    await replaceAndWaitForSource(preview, leftPackage);
    preview.setDocumentMode('editing');
    const previewDoc = preview.activeEditor?.doc;
    if (!previewDoc) throw new Error('The diff preview document API is unavailable.');

    const targetSnapshot = await rightDoc.diff.capture();
    diffStatus.value = 'Comparing documents…';
    const diff = await previewDoc.diff.compare({ targetSnapshot });
    if (!diff.summary.hasChanges) {
      preview.setViewingOptions({ trackedChanges: 'markup' });
      preview.setDocumentMode('viewing');
      previewHasResult.value = true;
      diffStatus.value = 'No differences found.';
      return;
    }

    const trackedEligibility = diff.applyEligibility?.tracked;
    if (trackedEligibility?.status === 'blocked') {
      console.error('Tracked diff apply is blocked.', {
        summary: diff.summary,
        blockers: trackedEligibility.blockers,
      });
      diffStatus.value = 'Tracked diff is not supported for these documents. See console.';
      return;
    }

    diffStatus.value = 'Rendering tracked changes in the diff preview…';
    const result = await previewDoc.diff.apply({ diff }, { changeMode: 'tracked' });
    const trackedChanges = result.operationReceipts.reduce(
      (count, receipt) => count + receipt.reviewItems.length,
      0,
    );

    preview.setViewingOptions({ trackedChanges: 'markup' });
    preview.setDocumentMode('viewing');
    previewHasResult.value = true;
    diffStatus.value = trackedChanges === 1
      ? 'Rendered 1 tracked change in the diff preview.'
      : `Rendered ${trackedChanges} tracked changes in the diff preview.`;
  } catch (error) {
    console.error('The documents could not be compared.', error);
    diffStatus.value = 'The documents could not be compared. See console.';
  } finally {
    isDiffing.value = false;
  }
};

onMounted(async () => {
  const leftBlank = await getFileObject(BlankDOCX, leftDocumentName.value, DOCX);
  const rightBlank = await getFileObject(BlankDOCX, rightDocumentName.value, DOCX);
  const previewBlank = await getFileObject(BlankDOCX, 'diff-preview.docx', DOCX);

  const left = new SuperDoc({
    selector: '#left-superdoc-editor',
    document: leftBlank,
    documentMode: documentMode.value,
    role: 'editor',
    toolbar: '#superdoc-toolbar',
    user: { name: 'Demo User', email: 'demo@example.com' },
    modules: {
      toolbar: {
        groups: {
          center: [
            'fontFamily', 'fontSize', 'list', 'numberedlist',
            'indentleft', 'indentright', 'lineHeight', 'clearFormatting',
          ],
        },
        hideButtons: false,
      },
      comments: { displayMode: 'sidebar' },
    },
    onReady: () => {
      leftSuperdoc.value = left;
      leftReady.value = true;
    },
  });

  const right = new SuperDoc({
    selector: '#right-superdoc-editor',
    document: rightBlank,
    documentMode: 'viewing',
    role: 'editor',
    user: { name: 'Comparison', email: 'comparison@example.com' },
    modules: { toolbar: false, comments: false },
    onReady: () => {
      rightSuperdoc.value = right;
      rightReady.value = true;
    },
  });

  const preview = new SuperDoc({
    selector: '#preview-superdoc-editor',
    document: previewBlank,
    documentMode: 'viewing',
    role: 'editor',
    viewing: { trackedChanges: 'markup' },
    user: { name: 'Diff Preview', email: 'preview@example.com' },
    modules: { toolbar: false, comments: false },
    onReady: () => {
      previewSuperdoc.value = preview;
      previewReady.value = true;
    },
  });
});

onBeforeUnmount(() => {
  leftSuperdoc.value?.destroy();
  rightSuperdoc.value?.destroy();
  previewSuperdoc.value?.destroy();
});
</script>

<template>
  <div class="app">
    <Topbar
      :document-name="leftDocumentName"
      :ready="editorsReady"
      :mode="documentMode"
      :left-document-name="leftDocumentLoaded ? leftDocumentName : ''"
      :right-document-name="rightDocumentLoaded ? rightDocumentName : ''"
      :can-diff="canDiff"
      :busy="isLoading || isDiffing"
      :diff-status="diffStatus"
      @upload="handleLeftUpload"
      @upload-left="handleLeftUpload"
      @upload-right="handleRightUpload"
      @diff="handleDiff"
      @new-document="handleNewDocument"
      @export="handleExport"
      @mode-change="handleModeChange"
    />

    <main class="editors">
      <section class="editor-pane">
        <header>
          <strong>Left document</strong>
          <span>{{ leftDocumentLoaded ? leftDocumentName : 'Upload a DOCX' }}</span>
        </header>
        <div id="left-superdoc-editor" class="editor-mount"></div>
      </section>
      <section class="editor-pane">
        <header>
          <strong>Right document</strong>
          <span>{{ rightDocumentLoaded ? rightDocumentName : 'Upload a DOCX' }}</span>
        </header>
        <div id="right-superdoc-editor" class="editor-mount"></div>
      </section>
      <section class="editor-pane preview-pane">
        <header>
          <strong>Diff preview</strong>
          <span>{{ previewHasResult ? 'Tracked changes markup' : 'Run the diff to render a preview' }}</span>
        </header>
        <div id="preview-superdoc-editor" class="editor-mount"></div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #eef1f5;
}

.editors {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: #cfd5dd;
  overflow: hidden;
}

.editor-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.editor-pane > header {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  color: #303640;
  background: #fff;
  border-bottom: 1px solid #dfe3e8;
  font-size: 12px;
}

.editor-pane > header span {
  min-width: 0;
  overflow: hidden;
  color: #737b87;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.editor-mount {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

@media (max-width: 900px) {
  .editors {
    grid-template-columns: 1fr;
    grid-template-rows: repeat(3, minmax(0, 1fr));
  }
}
</style>
