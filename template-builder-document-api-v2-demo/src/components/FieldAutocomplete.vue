<script setup lang="ts">
import type { TemplateField } from '../field-controller';

defineProps<{
  fields: TemplateField[];
  query: string;
  top: number;
  left: number;
}>();

const emit = defineEmits<{
  select: [field: TemplateField];
}>();
</script>

<template>
  <div
    class="field-autocomplete"
    :style="{ top: `${top}px`, left: `${left}px` }"
    role="listbox"
    aria-label="Template field suggestions"
    @mousedown.prevent
  >
    <div class="field-autocomplete__header">
      <span>Insert field</span>
      <code>{{ query ? `{{${query}` : '{{' }}</code>
    </div>
    <button
      v-for="field in fields"
      :key="field.id"
      type="button"
      role="option"
      @click="emit('select', field)"
    >
      <strong>{{ field.alias || 'Untitled field' }}</strong>
      <span>{{ field.value || field.tag || 'Empty field' }}</span>
    </button>
    <div v-if="!fields.length" class="field-autocomplete__empty">No matching fields</div>
  </div>
</template>

<style scoped>
.field-autocomplete {
  position: fixed;
  z-index: 1000;
  width: 280px;
  max-height: 260px;
  overflow-y: auto;
  padding: 6px;
  background: #fff;
  border: 1px solid #d8dee8;
  border-radius: 9px;
  box-shadow: 0 12px 30px rgba(31, 41, 55, .18);
}

.field-autocomplete__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 8px;
  color: #687386;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
}

.field-autocomplete__header code {
  color: #2563eb;
  font-size: 11px;
  text-transform: none;
}

button {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 2px;
  padding: 9px 10px;
  color: #303640;
  background: transparent;
  border: 0;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
}

button:hover,
button:focus-visible {
  background: #eff6ff;
  outline: none;
}

button strong { font-size: 13px; }
button span {
  overflow: hidden;
  width: 100%;
  color: #7a8493;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-autocomplete__empty {
  padding: 14px 10px;
  color: #8a919b;
  font-size: 12px;
  text-align: center;
}
</style>
