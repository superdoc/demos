<script setup lang="ts">
import type { TemplateField } from '../field-controller';

defineProps<{
  field: TemplateField;
  instanceCount: number;
  deleting?: boolean;
}>();

defineEmits<{
  back: [];
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <section class="delete-panel" aria-label="Delete field confirmation">
    <header>
      <button class="back-button" :disabled="deleting" @click="$emit('back')">← Back</button>
    </header>

    <div class="confirmation">
      <h2>Delete {{ instanceCount }} {{ instanceCount === 1 ? 'instance' : 'instances' }} of {{ field.alias || '(Untitled field)' }}?</h2>
      <p>This removes every instance in this field group from the document.</p>
      <div class="actions">
        <button class="confirm-button" :disabled="deleting" @click="$emit('confirm')">
          {{ deleting ? 'Deleting…' : 'Delete' }}
        </button>
        <button class="cancel-button" :disabled="deleting" @click="$emit('cancel')">Cancel</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.delete-panel { min-height: 100%; background: #fff; }
header { padding: 14px 1px; border-bottom: 1px solid #e2e5e9; }
.back-button { padding: 0; color: #245fae; background: transparent; border: 0; font-size: 12px; font-weight: 700; cursor: pointer; }
.back-button:disabled { cursor: default; opacity: .5; }
.confirmation { padding: 22px 0; }
h2 { margin: 0; color: #242a32; font-size: 18px; line-height: 1.35; }
p { margin: 9px 0 20px; color: #68707c; font-size: 12px; line-height: 1.5; }
.actions { display: flex; gap: 8px; }
.actions button { padding: 8px 14px; border-radius: 7px; font-size: 12px; font-weight: 750; cursor: pointer; }
.actions button:disabled { cursor: default; opacity: .5; }
.confirm-button { color: #fff; background: #b42318; border: 1px solid #b42318; }
.confirm-button:hover:not(:disabled) { background: #912018; }
.cancel-button { color: #44505e; background: #fff; border: 1px solid #ccd2da; }
</style>
