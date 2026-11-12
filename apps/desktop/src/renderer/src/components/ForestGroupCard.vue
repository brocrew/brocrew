<script setup lang="ts">
import { computed } from 'vue'
import ForestCard from './ForestCard.vue'
import type { GraphNode } from '../lib/forest-graph'
import type { ForestRow } from '../lib/the-forest'

const props = defineProps<{ node: GraphNode; here: boolean; opened: boolean }>()
const emit = defineEmits<{ toggle: []; press: [row: ForestRow] }>()
const members = computed(() => props.node.members ?? [])
const summary = computed(() => ({
  ...props.node,
  row: { ...props.node.row, name: `${props.node.row.name} ×${members.value.length}` },
  tasks: [],
}))
const distribution = computed(() => {
  let active = 0
  let idle = 0
  let unknown = 0
  for (const member of members.value) {
    const doing = member.row.facets.doing
    if (doing === undefined || doing === 'unknown') unknown += 1
    else if (doing === 'idle') idle += 1
    else active += 1
  }
  return [active ? `${active} active` : '', idle ? `${idle} idle` : '', unknown ? `${unknown} unknown` : ''].filter(Boolean).join(' · ')
})
const newestTask = (member: GraphNode) => member.tasks.at(-1)?.taskRow
const dateOf = (member: GraphNode): string | null => {
  const updatedAt = member.row.conversationRow?.updatedAt
  return updatedAt === undefined ? null : new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <section class="group-card nopan nodrag" :class="{ current: props.here }" :data-group="props.node.row.identity" data-cy="forest-group" @click.stop>
    <div class="summary" @click.stop="emit('toggle')">
      <ForestCard :node="summary" :here="props.here" :opened="props.opened" />
    </div>
    <div class="group-body">
      <p class="distribution" data-cy="forest-group-counts">{{ distribution }}</p>
      <button type="button" class="disclosure" data-cy="forest-group-toggle" :aria-expanded="props.opened" @click.stop="emit('toggle')">
        {{ props.opened ? '▾ Hide conversations' : `▸ ${members.length} conversations` }}
      </button>
      <div v-if="props.opened" class="members" :aria-label="`${props.node.row.name} conversations`">
        <button v-for="member in members" :key="member.row.key" type="button" class="member" data-cy="forest-group-member" :data-conversation="member.row.conversation" @click.stop="emit('press', member.row)">
          <span class="member-label">{{ newestTask(member)?.reading.heading ?? member.row.conversation }} <span aria-hidden="true">↗</span></span>
          <span v-if="member.row.says || dateOf(member)">{{ [member.row.says, dateOf(member)].filter(Boolean).join(' · ') }}</span>
          <span v-if="newestTask(member)" class="piece">{{ newestTask(member)?.said }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.group-card { width: 100%; overflow: hidden; border: var(--border-width) solid var(--line); border-radius: var(--radius-md); background: var(--panel); }
.group-card.current { border-color: var(--accent); box-shadow: var(--accent-glow-weak); }
.summary :deep(.card) { border: 0; border-radius: 0; padding-bottom: var(--space-2); box-shadow: none; }
.summary :deep(.head) { width: 100%; }
.group-body { padding: 0 var(--space-5) var(--space-4); }
.distribution { margin: 0 0 var(--space-2); color: var(--muted); font-size: var(--type-caption); }
.disclosure { padding: 0; border: 0; background: none; color: var(--text-soft); cursor: pointer; font: inherit; font-size: var(--type-caption); text-decoration: underline; }
.members { overflow: auto; max-height: 300px; margin-top: var(--space-3); border-top: var(--border-width) solid var(--line); overscroll-behavior: contain; }
.member { display: flex; width: 100%; flex-direction: column; padding: var(--space-3) 0; border: 0; border-bottom: var(--border-width) solid var(--line); background: none; color: var(--muted); cursor: pointer; font: inherit; font-size: var(--type-caption); gap: var(--space-2); text-align: left; }
.member:hover { background: var(--wash-3); }
.member-label { display: flex; overflow-wrap: anywhere; justify-content: space-between; color: var(--text); font-weight: var(--fw-bold); }
.piece { color: var(--text-soft); line-height: 1.45; }
</style>
