<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NewFieldInput, TemplateField } from '../field-controller';

const props = withDefaults(defineProps<{ field: TemplateField; instances?: TemplateField[]; creating?: boolean; showBack?: boolean }>(), { creating: false, instances: () => [], showBack: true });
const emit = defineEmits<{
  back: [];
  valueChange: [value: string];
  aliasChange: [alias: string];
  tagChange: [tag: string];
  lockChange: [locked: boolean];
  save: [field: NewFieldInput];
}>();

const value = ref(props.field.value);
const alias = ref(props.field.alias);
const tag = ref(props.field.tag || '');
type TagRow = { id: number; key: string; value: string };
let nextTagRowId = 1;
const displayTagValue = (input: unknown) => typeof input === 'string' ? input : JSON.stringify(input);
const rowsFromTag = (input: string): TagRow[] => {
  try {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed).map(([key, rowValue]) => ({ id: nextTagRowId++, key, value: displayTagValue(rowValue) }));
  } catch {
    return [];
  }
};
const tagRows = ref<TagRow[]>(rowsFromTag(tag.value));
const locked = ref(props.field.lockMode !== 'unlocked');
const showRaw = ref(false);
const valueFocused = ref(false);
const aliasFocused = ref(false);

watch(() => props.field.value, next => { if (!valueFocused.value) value.value = next; });
watch(() => props.field.alias, next => { if (!aliasFocused.value) alias.value = next; });
watch(() => props.field.tag, next => {
  const nextTag = next || '';
  if (nextTag === tag.value) return;
  tag.value = nextTag;
  tagRows.value = rowsFromTag(nextTag);
});
watch(() => props.field.lockMode, next => { locked.value = next !== 'unlocked'; });
const parseTagValue = (input: string): unknown => {
  try { return JSON.parse(input); }
  catch { return input; }
};
const updateTag = () => {
  const payload: Record<string, unknown> = {};
  for (const row of tagRows.value) {
    const key = row.key.trim();
    if (key) payload[key] = parseTagValue(row.value);
  }
  tag.value = JSON.stringify(payload);
  if (!props.creating) emit('tagChange', tag.value);
};
const addTagRow = () => {
  tagRows.value.push({ id: nextTagRowId++, key: '', value: '' });
};
const isProtectedTagKey = (key: string) => key === 'group';
const removeTagRow = (row: TagRow) => {
  if (isProtectedTagKey(row.key)) return;
  tagRows.value = tagRows.value.filter(candidate => candidate.id !== row.id);
  updateTag();
};
const rawFieldJson = computed(() => JSON.stringify({
  field: props.field,
  instances: props.instances,
}, null, 2));
const save = () => {
  updateTag();
  emit('save', {
    alias: alias.value.trim(),
    tag: tag.value.trim(),
    value: value.value,
    mode: props.field.mode,
    locked: locked.value,
    metadata: props.field.metadata,
  });
};
</script>

<template>
  <section class="field-editor" :aria-label="creating ? 'Create field' : 'Edit field'">
    <header>
      <button v-if="showBack" class="back-button" @click="$emit('back')">← Back</button>
      <div class="header-title-row">
        <div>
          <span>{{ creating ? (field.group === 'clause' ? 'New clause' : 'New field') : 'Edit field' }}</span>
          <strong>{{ alias || '(Untitled field)' }}</strong>
        </div>
        <button v-if="!creating" class="raw-button" :class="{ active: showRaw }" :aria-pressed="showRaw" @click="showRaw = !showRaw">
          {{ showRaw ? 'Form' : 'Raw' }}
        </button>
      </div>
    </header>

    <div v-if="showRaw && !creating" class="raw-view">
      <pre>{{ rawFieldJson }}</pre>
    </div>

    <div v-else class="editor-body">
      <label>
        <span>Field value</span>
        <textarea v-model="value" rows="7" :disabled="!creating && locked" @focus="valueFocused = true" @blur="valueFocused = false" @input="!creating && !locked && $emit('valueChange', value)" />
        <small v-if="!creating && locked">Unlock this field to edit its content.</small>
        <small v-else-if="!creating">Updates the document as you type.</small>
      </label>

      <label>
        <span>Alias</span>
        <input v-model="alias" type="text" @focus="aliasFocused = true" @blur="aliasFocused = false" @input="!creating && $emit('aliasChange', alias)" />
      </label>

      <section class="tag-editor">
        <div class="tag-heading">
          <span>Tag properties</span>
          <button type="button" @click="addTagRow">Add property</button>
        </div>
        <div v-if="tagRows.length" class="tag-rows">
          <div v-for="row in tagRows" :key="row.id" class="tag-row">
            <input v-model="row.key" :disabled="isProtectedTagKey(row.key)" type="text" aria-label="Tag key" placeholder="Key" @input="updateTag" />
            <input v-model="row.value" type="text" aria-label="Tag value" placeholder="Value" @input="updateTag" />
            <button type="button" :disabled="isProtectedTagKey(row.key)" :title="isProtectedTagKey(row.key) ? 'Required system property' : 'Remove property'" @click="removeTagRow(row)">Remove</button>
          </div>
        </div>
        <small><code>group</code> identifies all instances of this field and cannot be removed.</small>
      </section>

      <label class="lock-row">
        <span><strong>Lock field</strong><small>Prevent changes to the control and its content.</small></span>
        <input v-model="locked" type="checkbox" role="switch" @change="!creating && $emit('lockChange', locked)" />
      </label>

      <button v-if="creating" class="save-button" :disabled="!alias.trim()" @click="save">Save</button>

      <section v-else class="instances">
        <h3>Instances ({{ instances.length }})</h3>
        <dl v-for="(instance, index) in instances" :key="instance.id">
          <div><dt>Instance</dt><dd>{{ index + 1 }}{{ index === 0 ? ' (original)' : '' }}</dd></div>
          <div><dt>ID</dt><dd>{{ instance.id }}</dd></div>
          <div><dt>Type</dt><dd>{{ instance.controlType }} / {{ instance.mode }}</dd></div>
          <div><dt>Value</dt><dd>{{ instance.value || 'Empty field' }}</dd></div>
        </dl>
      </section>
    </div>
  </section>
</template>

<style scoped>
.field-editor { min-height: 100%; background: #fff; }
header { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; padding: 14px 1px; border-bottom: 1px solid #e2e5e9; }
header > div { display: flex; flex-direction: column; gap: 2px; }
.header-title-row { width: 100%; flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; }
.header-title-row > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
header span { color: #858c96; font-size: 10px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
header strong { color: #242a32; font-size: 16px; }
.back-button { padding: 0; color: #245fae; background: transparent; border: 0; font-size: 12px; font-weight: 700; cursor: pointer; }
.raw-button { padding: 5px 9px; color: #245fae; background: #edf4ff; border: 1px solid #c9dcf7; border-radius: 6px; font-size: 10px; font-weight: 750; cursor: pointer; }
.raw-button.active { color: #fff; background: #2563eb; border-color: #2563eb; }
.raw-view { padding: 15px 0; }
.raw-view pre { margin: 0; padding: 12px; overflow: auto; color: #d9e2f1; background: #172033; border-radius: 8px; font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.editor-body { display: flex; flex-direction: column; gap: 15px; padding: 15px 0; }
label { display: flex; flex-direction: column; gap: 6px; color: #3a4049; font-size: 11px; font-weight: 700; }
input[type='text'], textarea { width: 100%; padding: 9px 10px; color: #292f37; background: #fff; border: 1px solid #c9ced5; border-radius: 7px; outline: none; font: 12px/1.45 inherit; resize: vertical; }
input[type='text']:focus, textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px #3b82f619; }
textarea:disabled { color: #7b828c; background: #f1f3f5; cursor: not-allowed; }
small { color: #8a919b; font-size: 10px; font-weight: 400; }
code { font-size: inherit; }
.tag-editor { display: flex; flex-direction: column; gap: 7px; }
.tag-heading { display: flex; align-items: center; justify-content: space-between; color: #3a4049; font-size: 11px; font-weight: 700; }
.tag-heading button { padding: 4px 7px; color: #245fae; background: #edf4ff; border: 1px solid #c9dcf7; border-radius: 5px; font-size: 10px; font-weight: 700; cursor: pointer; }
.tag-rows { display: flex; flex-direction: column; gap: 6px; }
.tag-row { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr) auto; gap: 5px; }
.tag-row input { min-width: 0; padding: 7px 8px; }
.tag-row input:disabled { color: #667085; background: #f1f3f5; }
.tag-row button { padding: 5px 7px; color: #b42318; background: #fff; border: 1px solid #efc0bb; border-radius: 5px; font-size: 9px; font-weight: 700; cursor: pointer; }
.tag-row button:disabled { color: #98a0aa; background: #f5f6f8; border-color: #dfe3e8; cursor: not-allowed; }
.save-button { width: 100%; padding: 10px 14px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; font-size: 12px; font-weight: 750; cursor: pointer; }
.save-button:hover:not(:disabled) { background: #1d4ed8; }
.save-button:disabled { cursor: default; opacity: .5; }
.lock-row { flex-direction: row; align-items: center; justify-content: space-between; padding: 11px; background: #f5f6f8; border-radius: 8px; }
.lock-row > span { display: flex; flex-direction: column; gap: 3px; }
.lock-row input { width: 34px; height: 18px; accent-color: #2563eb; }
dl { margin: 0; padding: 10px; background: #f7f8fa; border-radius: 8px; }
.instances { display: flex; flex-direction: column; gap: 8px; }
.instances h3 { margin: 0; color: #3a4049; font-size: 11px; }
dl div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 8px; padding: 3px 0; font-size: 10px; }
dt { color: #858c96; } dd { margin: 0; overflow-wrap: anywhere; color: #454c56; }
</style>
