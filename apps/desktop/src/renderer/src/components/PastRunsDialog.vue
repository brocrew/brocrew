<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import ListDialogShell from './ListDialogShell.vue'
import PanelRunRow from './PanelRunRow.vue'
import type { PanelRun, RunGroup } from '../lib/panel-runs'
const props = defineProps<{ runs: PanelRun[]; conversation?: string }>()
const emit = defineEmits<{ close: []; open: [run: PanelRun] }>()
const titleId = useId()
const query = ref('')
const filter = ref<RunGroup | 'All kinds'>('All kinds')
const groups: (RunGroup | 'All kinds')[] = [
  'All kinds',
  'Agents',
  'Commands',
  'Workflows',
  'Jobs & monitors',
  'Checklists',
  'Runs',
]
const count = (group: RunGroup | 'All kinds'): number =>
  props.runs.filter((row) => group === 'All kinds' || row.group === group).length
const shown = computed(() =>
  props.runs.filter(
    (row) =>
      (filter.value === 'All kinds' || row.group === filter.value) &&
      `${row.label} ${row.detail} ${row.status}`
        .toLocaleLowerCase()
        .includes(query.value.trim().toLocaleLowerCase()),
  ),
)
</script>
<template>
  <ListDialogShell :title-id="titleId" data-cy="past-runs-dialog" @close="emit('close')">
    <template #title>Past runs</template>
    <template #search
      ><input
        v-model="query"
        type="search"
        placeholder="Search past runs…"
        aria-label="Search past runs"
        data-cy="past-runs-search"
    /></template>
    <template #controls>
      <div class="list-filters" role="group" aria-label="Run kind">
        <button
          v-for="group in groups"
          :key="group"
          class="list-filter"
          :aria-pressed="filter === group"
          @click="filter = group"
        >
          {{ group }} <span class="list-filter-count">{{ count(group) }}</span>
        </button>
      </div>
      <p class="list-count" role="status" data-cy="past-runs-count">
        {{ shown.length }} {{ shown.length === 1 ? 'run' : 'runs' }}
      </p>
    </template>
    <template #results>
      <div v-if="shown.length" data-cy="past-runs-rows">
        <PanelRunRow
          v-for="run in shown"
          :key="run.key"
          :run="run"
          :conversation="conversation"
          @open="emit('open', run)"
        />
      </div>
      <p v-else class="list-empty">No past runs match this view.</p>
    </template>
  </ListDialogShell>
</template>
<style scoped src="./dialog-presentation.css"></style>

<style scoped>
.list-dialog {
  width: min(560px, calc(100% - 2 * var(--space-8)));
  min-width: 0;
}
:deep(.list-body),
:deep([data-cy='past-runs-rows']),
:deep(.list-dialog) {
  min-width: 0;
}
:deep(.list-body) {
  overflow-x: hidden;
}
.list-filters {
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
}
.list-filter {
  flex: 0 1 auto;
  max-width: 100%;
  white-space: normal;
}
</style>
