<script setup lang="ts">
import { ref } from 'vue';
import buildCommand from '../build-app.sh?raw';

const dialog = ref<HTMLDialogElement | null>(null);
const copied = ref(false);
const error = ref('');

const copyCommand = async () => {
  try {
    await navigator.clipboard.writeText(buildCommand);
    copied.value = true;
    error.value = '';
  } catch { error.value = 'Could not access the clipboard. Select the commands above and copy them.'; }
};
</script>

<template>
  <button class="build-this-button" type="button" @click="dialog?.showModal()">Build this</button>
  <dialog ref="dialog" class="build-dialog" aria-labelledby="build-dialog-title"
    @close="copied = false; error = ''" @click.self="dialog?.close()">
    <div class="build-dialog-header">
      <div><h2 id="build-dialog-title">Build this app</h2><p>Copy this Bash snippet to clone and run Template Builder locally.</p></div>
      <button class="build-dialog-close" type="button" aria-label="Close" @click="dialog?.close()">×</button>
    </div>
    <div class="build-dialog-body">
      <pre><code>{{ buildCommand }}</code></pre>
      <div class="build-dialog-actions">
        <button class="build-command-copy" type="button" @click="copyCommand">{{ copied ? 'Copied' : 'Copy all commands' }}</button>
        <a href="https://github.com/superdoc/demos/blob/main/template-builder-document-api-v2-demo/README.md" target="_blank" rel="noreferrer">View the README on GitHub</a>
      </div>
      <p class="build-dialog-note" role="status">{{ error || (copied ? 'Commands copied to clipboard.' : 'Requires Node.js 22+ and Git. Open the local URL printed by Vite.') }}</p>
    </div>
  </dialog>
</template>

<style scoped>
.build-this-button { height: 34px; margin-left: 8px; padding: 0 13px; color: #fff; background: #2563eb; border: 1px solid #2563eb; border-radius: 7px; font-size: 11px; font-weight: 750; white-space: nowrap; cursor: pointer; }
.build-this-button:hover, .build-command-copy:hover { background: #1d4ed8; }
.build-this-button:focus-visible { outline: 0; box-shadow: 0 0 0 3px #3b82f638; }
.build-dialog { width: min(720px, calc(100vw - 40px)); max-height: calc(100dvh - 40px); margin: auto; padding: 0; overflow: auto; color: #1f2937; background: #fff; border: 1px solid #d1d5db; border-radius: 14px; box-shadow: 0 24px 80px #0f172a40; }
.build-dialog::backdrop { background: #0f172a66; }
.build-dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 22px 24px 18px; border-bottom: 1px solid #e5e7eb; }
.build-dialog-header h2 { margin: 0 0 6px; font-size: 20px; }
.build-dialog-header p { margin: 0; color: #64748b; font-size: 13px; line-height: 1.5; }
.build-dialog-close { padding: 0 6px; border: 0; color: #64748b; background: transparent; font-size: 25px; cursor: pointer; }
.build-dialog-body { padding: 20px 24px 24px; }
.build-dialog-body pre { margin: 0 0 14px; padding: 16px; overflow-x: auto; color: #e2e8f0; background: #0f172a; border-radius: 8px; font-size: 13px; line-height: 1.6; }
.build-dialog-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
.build-command-copy { padding: 8px 12px; color: #fff; background: #2563eb; border: 0; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
.build-dialog-actions a { color: #2563eb; font-size: 12px; font-weight: 600; }
.build-dialog-note { margin: 16px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
</style>
