<script setup lang="ts">
import { computed } from 'vue'
import ForestCard from './ForestCard.vue'
import type { GraphNode } from '../lib/forest-graph'
import type { ForestRow } from '../lib/the-forest'
import type { RootFiles } from '../lib/files-kept'

const props = defineProps<{
  node: GraphNode
  here: boolean
  opened: boolean
  current?: string | null
  openedMembers: ReadonlySet<string>
  fileCounts?: ReadonlyMap<string, number>
  rootFiles?: RootFiles | null
}>()
const emit = defineEmits<{
  toggle: []
  toggleMember: [conversation: string]
  press: [row: ForestRow]
  files: [piece: string]
}>()
const members = computed(() => props.node.members ?? [])
const summary = computed(() => ({
  ...props.node,
  row: {
    ...props.node.row,
    name: `${props.node.row.name} ×${members.value.length}`,
    says: latest.value ? `Latest: ${latest.value}` : null,
  },
  tasks: [],
}))
const distribution = computed(() => {
  const counts = new Map<string, number>()
  for (const member of members.value) {
    const word = member.row.says ?? 'unknown'
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts].map(([word, count]) => `${count} ${word}`).join(' · ')
})
const dateOf = (member: GraphNode): string | null => {
  const updatedAt = member.row.conversationRow?.updatedAt
  return updatedAt === undefined
    ? null
    : new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
const latest = computed(() => [props.node.row.says, dateOf(props.node)].filter(Boolean).join(' · '))
</script>

<template>
  <section
    class="group-card nopan nodrag"
    :class="{ current: props.here }"
    :data-group="props.node.row.identity"
    data-cy="forest-group"
    @click.stop
  >
    <div class="summary" @click.stop="emit('toggle')">
      <ForestCard :node="summary" :here="props.here" :opened="props.opened" />
    </div>
    <div class="group-body">
      <p class="distribution" data-cy="forest-group-counts">{{ distribution }}</p>
      <button
        type="button"
        class="disclosure"
        data-cy="forest-group-toggle"
        :aria-expanded="props.opened"
        @click.stop="emit('toggle')"
      >
        {{ props.opened ? '▾ Hide conversations' : `▸ ${members.length} conversations` }}
      </button>
      <div v-if="props.opened" class="members" :aria-label="`${props.node.row.name} conversations`">
        <div
          v-for="member in members"
          :key="member.row.key"
          class="member"
          data-cy="forest-group-member"
          :data-conversation="member.row.conversation"
          @click.stop="emit('press', member.row)"
        >
          <ForestCard
            :node="member"
            :here="member.row.conversation === props.current"
            :opened="props.openedMembers.has(member.row.conversation)"
            :file-counts="props.fileCounts"
            :root-files="
              props.rootFiles?.conversation === member.row.conversation ? props.rootFiles : null
            "
            @toggle="emit('toggleMember', member.row.conversation)"
            @files="(piece) => emit('files', piece)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.group-card {
  width: 100%;
  overflow: hidden;
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--panel);
}
.group-card.current {
  border-color: var(--accent);
  box-shadow: var(--accent-glow-weak);
}
.summary :deep(.card) {
  border: 0;
  border-radius: 0;
  padding-bottom: var(--space-2);
  box-shadow: none;
}
.summary :deep(.head) {
  width: 100%;
}
.group-body {
  padding: 0 var(--space-5) var(--space-4);
}
.distribution {
  margin: 0 0 var(--space-2);
  color: var(--muted);
  font-size: var(--type-caption);
}
.disclosure {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-soft);
  cursor: pointer;
  font: inherit;
  font-size: var(--type-caption);
  text-decoration: underline;
}
.members {
  overflow: auto;
  max-height: 300px;
  margin-top: var(--space-3);
  border-top: var(--border-width) solid var(--line);
  overscroll-behavior: contain;
}
.member {
  width: 100%;
  margin-top: var(--space-2);
  cursor: pointer;
}
</style>
