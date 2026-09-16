<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { TemplateVariable } from '../template-logic';

const props = defineProps<{ variables: TemplateVariable[] }>();

const emit = defineEmits<{
  add: [type: TemplateVariable['type']];
  load: [];
  remove: [id: string];
  update: [id: string, field: 'name' | 'value', value: string | boolean];
}>();

const chooseVariableType = (event: Event) => {
  const select = event.target as HTMLSelectElement;
  if (select.value === 'text' || select.value === 'boolean') emit('add', select.value);
  select.value = '';
};

const searchInput = ref('');
const searchQuery = ref('');
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

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <section class="variables-panel" aria-label="Template variables">
    <header>
      <div>
        <span>Template data</span>
        <strong>{{ variables.length }} {{ variables.length === 1 ? 'variable' : 'variables' }}</strong>
      </div>
      <div class="header-actions">
        <button class="load-variables" type="button" @click="emit('load')">Load variables</button>
        <select aria-label="Add variable" value="" @change="chooseVariableType">
          <option value="" disabled>Add variable</option>
          <option value="text">Text</option>
          <option value="boolean">True/false</option>
        </select>
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
      <div v-for="variable in filteredVariables" :key="variable.id" class="variable-row">
        <label>
          <span>Variable name</span>
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
        <label v-else>
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
        <button class="remove-variable" type="button" :aria-label="`Remove ${variable.name || 'variable'}`" @click="emit('remove', variable.id)">
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
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
header > div { display: flex; flex-direction: column; gap: 2px; }
header span { color: #8a919b; font-size: 9px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
header strong { color: #303640; font-size: 13px; }
.header-actions { display: flex; flex-direction: row; align-items: center; gap: 7px; }
header select, header button { padding: 7px 10px; color: #fff; background: #2563eb; border: 0; border-radius: 7px; font-size: 11px; font-weight: 750; cursor: pointer; }
header select { padding-right: 28px; }
header select:hover, header button:hover { background-color: #1d4ed8; }
header .load-variables { color: #245fae; background: #fff; border: 1px solid #b9c9df; }
header .load-variables:hover { color: #1d4ed8; background: #f8fafc; border-color: #8da9cf; }
.variable-list { display: flex; flex-direction: column; gap: 10px; }
.variable-search { width: 100%; margin-bottom: 12px; padding: 9px 11px; color: #252a32; background: #fff; border: 1px solid #cbd5e1; border-radius: 7px; font: inherit; font-size: 12px; }
.variable-search:focus { border-color: #2563eb; outline: 2px solid #2563eb22; }
.variable-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: end; padding: 11px; background: #f8fafc; border: 1px solid #e1e7ef; border-radius: 8px; }
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
.empty-state { margin: 0; padding: 24px 12px; color: #8a919b; text-align: center; font-size: 12px; }
</style>
