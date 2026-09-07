<script setup lang="ts">
import type { TemplateField } from '../field-controller';

defineProps<{
  field: TemplateField;
  copyCount: number;
  highlighted: boolean;
}>();

defineEmits<{
  edit: [field: TemplateField];
  delete: [field: TemplateField];
  insert: [field: TemplateField];
  prepareInsert: [];
  toggleHighlight: [];
}>();
</script>

<template>
  <article
    class="field-card"
  >
    <div class="field-card-heading">
      <div class="field-identity">
        <div class="field-title-row">
          <strong>{{ field.alias || '(Untitled field)' }}</strong>
          <span class="field-kind">{{ field.mode }}</span>
        </div>
      </div>
      <div class="field-actions">
        <div class="field-action-row">
          <button
            class="highlight-toggle"
            :class="{ active: highlighted }"
            :aria-pressed="highlighted"
            @click.stop="$emit('toggleHighlight')"
          >Highlight</button>
          <button
            class="insert-button"
            @pointerdown.stop="$emit('prepareInsert')"
            @click.stop="$emit('insert', field)"
          >Insert</button>
          <button class="edit-button" @click.stop="$emit('edit', field)">Edit</button>
          <button class="delete-button" @click.stop="$emit('delete', field)">Delete</button>
        </div>
      </div>
    </div>
    <p>{{ field.value || 'Empty field' }}</p>
    <div class="copy-count">{{ copyCount }} {{ copyCount === 1 ? 'instance' : 'instances' }}</div>
    <div class="field-card-meta">
      <span>{{ field.controlType || 'content control' }}</span>
      <span :class="{ locked: field.lockMode !== 'unlocked' }">
        {{ field.lockMode === 'unlocked' ? 'Unlocked' : 'Locked' }}
      </span>
    </div>
  </article>
</template>

<style scoped>
.field-card { padding: 12px; background: #fff; border: 1px solid #dfe3e8; border-radius: 9px; transition: border-color .15s, box-shadow .15s; }
.field-card:hover { border-color: #b8c0ca; }
.field-card-heading, .field-title-row, .field-card-meta { display: flex; align-items: center; }
.field-card-heading { align-items: flex-start; justify-content: space-between; gap: 8px; }
.field-identity { display: flex; min-width: 0; flex: 1; flex-direction: column; align-items: flex-start; gap: 5px; }
.field-title-row { min-width: 0; align-items: flex-start; gap: 7px; }
.field-actions { display: flex; flex: 0 0 auto; align-items: center; }
.field-action-row { display: flex; align-items: center; gap: 5px; }
strong { min-width: 0; color: #252a32; font-size: 13px; overflow-wrap: anywhere; white-space: normal; }
.field-kind { flex: 0 0 auto; padding: 2px 5px; color: #68707c; background: #eef0f3; border-radius: 4px; font-size: 9px; text-transform: uppercase; }
.edit-button, .insert-button, .delete-button { padding: 5px 9px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
.edit-button { color: #245fae; background: #edf4ff; border: 1px solid #c9dcf7; }
.insert-button { color: #44505e; background: #fff; border: 1px solid #ccd2da; }
.delete-button { color: #b42318; background: #fff; border: 1px solid #f0b8b2; }
.delete-button:hover { background: #fff1f0; }
.highlight-toggle { padding: 5px 9px; color: #64748b; background: #fff; border: 1px solid #ccd2da; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; }
.highlight-toggle:hover, .highlight-toggle.active { color: #245fae; background: #edf4ff; border-color: #c9dcf7; }
p { display: -webkit-box; margin: 10px 0; overflow: hidden; color: #606874; font-size: 12px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.copy-count { margin: -4px 0 8px; color: #64748b; font-size: 10px; font-weight: 700; }
.field-card-meta { justify-content: space-between; color: #8a919c; font-size: 10px; }
.locked { color: #a44d2c; }
</style>
