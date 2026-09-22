<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { TemplateVariable, TemplateVariableValue } from '../template-variables';

const props = defineProps<{
  variables: TemplateVariable[];
  variablesRendered: boolean;
  renderingVariables: boolean;
  loadingVariables: boolean;
  loadError: string;
}>();

const emit = defineEmits<{
  add: [type: TemplateVariable['type']];
  load: [];
  render: [];
  remove: [id: string];
  clear: [];
  update: [id: string, field: 'name' | 'value' | 'columns', value: TemplateVariableValue | string[]];
}>();

const chooseVariableType = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  if (select.value === 'text' || select.value === 'boolean' || select.value === 'textList' || select.value === 'tableRows') emit('add', select.value);
  select.value = '';
};

type TextListVariable = Extract<TemplateVariable, { type: 'textList' }>;
type TableRowsVariable = Extract<TemplateVariable, { type: 'tableRows' }>;

const variableTypeLabel = (variable: TemplateVariable) => {
  if (variable.type === 'boolean') return 'True/false';
  if (variable.type === 'textList') return 'Text list';
  if (variable.type === 'tableRows') return 'Table';
  return 'Text';
};

const updateTextListItem = (variable: TextListVariable, index: number, value: string) => {
  const items = [...variable.value];
  items[index] = value;
  emit('update', variable.id, 'value', items);
};

const addTextListItem = (variable: TextListVariable) => emit('update', variable.id, 'value', [...variable.value, '']);
const removeTextListItem = (variable: TextListVariable, index: number) => emit('update', variable.id, 'value', variable.value.filter((_, itemIndex) => itemIndex !== index));

const updateTableColumn = (variable: TableRowsVariable, index: number, value: string) => {
  const oldColumn = variable.columns[index];
  const columns = [...variable.columns];
  columns[index] = value;
  const rows = variable.value.map(row => ({ ...row, [value]: row[oldColumn] ?? '' }));
  emit('update', variable.id, 'columns', columns);
  emit('update', variable.id, 'value', rows);
};

const addTableColumn = (variable: TableRowsVariable) => emit('update', variable.id, 'columns', [...variable.columns, '']);

const removeTableColumn = (variable: TableRowsVariable, index: number) => emit(
  'update',
  variable.id,
  'columns',
  variable.columns.filter((_, columnIndex) => columnIndex !== index),
);

const updateTableCell = (variable: TableRowsVariable, rowIndex: number, column: string, value: string) => {
  const rows = variable.value.map((row, index) => index === rowIndex ? { ...row, [column]: value } : row);
  emit('update', variable.id, 'value', rows);
};

const addTableRow = (variable: TableRowsVariable) => {
  const row = Object.fromEntries(variable.columns.map(column => [column, '']));
  emit('update', variable.id, 'value', [...variable.value, row]);
};

const removeTableRow = (variable: TableRowsVariable, rowIndex: number) => emit(
  'update',
  variable.id,
  'value',
  variable.value.filter((_, index) => index !== rowIndex),
);

const searchInput = ref('');
const searchQuery = ref('');
const confirmingClear = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const updateSearch = (event: Event) => {
  searchInput.value = (event.target as HTMLInputElement).value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery.value = searchInput.value.trim().toLocaleLowerCase();
    searchTimer = null;
  }, 200);
};

const filteredVariables = computed(() => searchQuery.value
  ? props.variables.filter(variable => variable.name.toLocaleLowerCase().includes(searchQuery.value))
  : props.variables);

const clearVariables = () => {
  emit('clear');
  confirmingClear.value = false;
};

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <section class="variables-panel" aria-label="Template variables">
    <header>
      <div class="header-summary">
        <span>Template data</span>
        <strong>{{ variables.length }} {{ variables.length === 1 ? 'variable' : 'variables' }}</strong>
      </div>
      <div class="header-actions">
        <button
          class="clear-variables"
          type="button"
          :disabled="!variables.length"
          @click="confirmingClear = true"
        >Clear</button>
        <button
          class="render-variables"
          :class="{ active: variablesRendered }"
          type="button"
          :disabled="renderingVariables"
          @click="emit('render')"
        >{{ variablesRendered ? 'Rendered' : 'Render' }}</button>
        <button class="load-variables" type="button" :disabled="loadingVariables" @click="emit('load')">
          {{ loadingVariables ? 'Loading…' : 'Load' }}
        </button>
        <select aria-label="Add variable" value="" @change="chooseVariableType">
          <option value="" disabled>Add</option>
          <option value="text">Text</option>
          <option value="boolean">True/false</option>
          <option value="textList">Text list</option>
          <option value="tableRows">Table rows</option>
        </select>
      </div>
      <p v-if="loadError" class="load-error" role="alert">{{ loadError }}</p>
      <div v-if="confirmingClear" class="clear-confirmation" role="alert">
        <p>Do you want to remove all variables from this list? Variables present in the document will remain in the document.</p>
        <div>
          <button type="button" @click="confirmingClear = false">Cancel</button>
          <button class="confirm-clear" type="button" @click="clearVariables">Remove all</button>
        </div>
      </div>
    </header>

    <input
      class="variable-search"
      :value="searchInput"
      type="search"
      placeholder="Search variables"
      aria-label="Search variables by name"
      @input="updateSearch"
    >

    <div v-if="filteredVariables.length" class="variable-list">
      <div v-for="variable in filteredVariables" :key="variable.id" class="variable-row" :class="{ 'table-variable': variable.type === 'tableRows' }">
        <div v-if="variable.type === 'tableRows'" class="table-variable-header">
          <label>
            <span>{{ variableTypeLabel(variable) }} variable name</span>
            <input
              :value="variable.name"
              type="text"
              placeholder="variable_name"
              @input="emit('update', variable.id, 'name', ($event.target as HTMLInputElement).value)"
            >
          </label>
          <button class="remove-variable" type="button" :aria-label="`Remove ${variable.name || 'variable'}`" @click="emit('remove', variable.id)">
            Remove
          </button>
        </div>
        <label v-else>
          <span>{{ variableTypeLabel(variable) }} variable name</span>
          <input
            :value="variable.name"
            type="text"
            placeholder="variable_name"
            @input="emit('update', variable.id, 'name', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label v-if="variable.type === 'text'">
          <span>Value</span>
          <input
            :value="variable.value"
            type="text"
            placeholder="Value"
            @input="emit('update', variable.id, 'value', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label v-else-if="variable.type === 'boolean'">
          <span>Value</span>
          <span class="boolean-control">
            <button
              class="boolean-toggle"
              :class="{ active: variable.value }"
              type="button"
              role="switch"
              :aria-checked="variable.value"
              @click="emit('update', variable.id, 'value', !variable.value)"
            ><span /></button>
            <strong>{{ variable.value ? 'True' : 'False' }}</strong>
          </span>
        </label>
        <div v-else-if="variable.type === 'textList'" class="collection-editor">
          <span>Items</span>
          <div v-for="(item, index) in variable.value" :key="index" class="collection-row">
            <input
              :value="item"
              type="text"
              :placeholder="`Item ${index + 1}`"
              @input="updateTextListItem(variable, index, ($event.target as HTMLInputElement).value)"
            >
            <button type="button" aria-label="Remove text item" @click="removeTextListItem(variable, index)">Remove</button>
          </div>
          <button class="add-collection-item" type="button" @click="addTextListItem(variable)">Add item</button>
        </div>
        <div v-if="variable.type === 'tableRows'" class="collection-editor table-row-editor">
          <span>Columns</span>
          <div v-for="(column, columnIndex) in variable.columns" :key="columnIndex" class="column-definition">
            <input
              :value="column"
              type="text"
              placeholder="column_name"
              @input="updateTableColumn(variable, columnIndex, ($event.target as HTMLInputElement).value)"
            >
            <button type="button" aria-label="Remove column" @click="removeTableColumn(variable, columnIndex)">Remove</button>
          </div>
          <button class="add-collection-item" type="button" @click="addTableColumn(variable)">Add column</button>
          <span class="rows-heading">Rows</span>
          <div v-for="(row, rowIndex) in variable.value" :key="rowIndex" class="table-data-row">
            <div class="table-data-row-header">
              <strong>Row {{ rowIndex + 1 }}</strong>
              <button type="button" aria-label="Remove table row" @click="removeTableRow(variable, rowIndex)">Remove</button>
            </div>
            <label v-for="column in variable.columns" :key="column">
              <span>{{ column ? `${column} value` : 'Unnamed column value' }}</span>
              <input
                :value="row[column]"
                type="text"
                :placeholder="column || 'Value'"
                @input="updateTableCell(variable, rowIndex, column, ($event.target as HTMLInputElement).value)"
              >
            </label>
          </div>
          <button class="add-collection-item" type="button" @click="addTableRow(variable)">Add row</button>
        </div>
        <button v-if="variable.type !== 'tableRows'" class="remove-variable" type="button" :aria-label="`Remove ${variable.name || 'variable'}`" @click="emit('remove', variable.id)">
          Remove
        </button>
      </div>
    </div>
    <p v-else-if="variables.length" class="empty-state">No variables match this search.</p>
    <p v-else class="empty-state">No variables yet. Add one to define template data.</p>
  </section>
</template>

<style scoped>
.variables-panel { padding: 16px 1px 0; }
header { display: flex; align-items: flex-start; flex-direction: column; gap: 10px; margin-bottom: 12px; }
.header-summary { display: flex; flex-direction: column; gap: 2px; }
header span { color: #8a919b; font-size: 9px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
header strong { color: #303640; font-size: 13px; }
.header-actions { display: flex; flex-direction: row; align-items: center; gap: 7px; }
header select, header button { padding: 7px 10px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; font-size: 11px; font-weight: 750; cursor: pointer; }
header select { padding-right: 28px; }
header select:hover, header button:hover { background-color: #1d4ed8; }
header .load-variables, header .render-variables, header .clear-variables { color: #245fae; background: #fff; border: 1px solid #b9c9df; }
header .load-variables:hover, header .render-variables:hover, header .clear-variables:hover { color: #1d4ed8; background: #f8fafc; border-color: #8da9cf; }
header .load-variables:disabled { cursor: wait; opacity: .6; }
.load-error { margin: 0; padding: 8px 10px; color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; font-size: 11px; line-height: 1.4; }
header .render-variables.active { color: #fff; background-color: #2563eb; border-color: #2563eb; }
header .render-variables.active:hover { color: #fff; background: #1d4ed8; border-color: #1d4ed8; }
header button:disabled { cursor: wait; opacity: .55; }
.clear-confirmation { width: 100%; padding: 11px; color: #4b5563; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 7px; font-size: 12px; line-height: 1.4; }
.clear-confirmation div { display: flex; flex-direction: row; gap: 7px; margin-top: 9px; }
.clear-confirmation button { color: #596273; background: #fff; border: 1px solid #cbd5e1; }
.clear-confirmation .confirm-clear { color: #fff; background: #b42318; border-color: #b42318; }
.variable-list { display: flex; flex-direction: column; gap: 10px; }
.variable-search { width: 100%; margin-bottom: 12px; padding: 9px 11px; color: #252a32; background: #fff; border: 1px solid #cbd5e1; border-radius: 7px; font: inherit; font-size: 12px; }
.variable-search:focus { border-color: #2563eb; outline: 2px solid #2563eb22; }
.variable-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: end; padding: 11px; background: #f8fafc; border: 1px solid #e1e7ef; border-radius: 8px; }
.variable-row.table-variable { display: flex; align-items: stretch; flex-direction: column; gap: 14px; }
.table-variable-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: end; }
label { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
label span { color: #596273; font-size: 10px; font-weight: 700; }
input { width: 100%; min-width: 0; padding: 8px 9px; color: #252a32; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; font-size: 12px; }
input:focus { border-color: #2563eb; outline: 2px solid #2563eb22; }
.boolean-control { display: flex; min-height: 34px; align-items: center; gap: 8px; }
.boolean-control strong { color: #303640; font-size: 11px; }
.boolean-toggle { position: relative; width: 34px; height: 20px; padding: 0; background: #aeb7c4; border: 0; border-radius: 999px; cursor: pointer; }
.boolean-toggle span { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: transform .15s ease; }
.boolean-toggle.active { background: #2563eb; }
.boolean-toggle.active span { transform: translateX(14px); }
.boolean-toggle:focus-visible { outline: 2px solid #2563eb55; outline-offset: 2px; }
.remove-variable { padding: 8px 9px; color: #b42318; background: #fff; border: 1px solid #f0b8b3; border-radius: 6px; font-size: 10px; font-weight: 700; cursor: pointer; }
.remove-variable:hover { color: #fff; background: #b42318; border-color: #b42318; }
.collection-editor { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.collection-editor > span { color: #596273; font-size: 10px; font-weight: 700; }
.collection-row { display: flex; min-width: 0; gap: 5px; }
.collection-row input { flex: 1 1 0; }
.collection-row button, .column-definition button, .table-data-row button, .add-collection-item { padding: 6px 8px; color: #596273; background: #fff; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 10px; font-weight: 700; cursor: pointer; }
.collection-row button:hover, .column-definition button:hover, .table-data-row button:hover { color: #b42318; border-color: #f0b8b3; }
.add-collection-item { align-self: flex-start; color: #245fae; border-color: #b9c9df; }
.column-definition { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; }
.rows-heading { margin-top: 8px; }
.table-data-row { display: flex; min-width: 0; flex-direction: column; gap: 7px; padding: 9px; background: #fff; border: 1px solid #dbe3ee; border-radius: 7px; }
.table-data-row-header { display: flex; align-items: center; justify-content: space-between; }
.table-data-row-header strong { color: #303640; font-size: 11px; }
.empty-state { margin: 0; padding: 24px 12px; color: #8a919b; text-align: center; font-size: 12px; }
</style>
