<script setup lang="ts">
import { computed } from 'vue'
import { subAgentFacets } from '../lib/agent-state'
import type { SubAgentCard } from '../lib/transcript'
import type { ChildWorkInput } from '../../../shared/runtime-ipc'
import AgentState from './AgentState.vue'

const props = withDefaults(
  defineProps<{
    card: SubAgentCard
    placement?: 'transcript' | 'nested'
    canOpenTranscript?: boolean
  }>(),
  { placement: 'transcript', canOpenTranscript: true },
)
const emit = defineEmits<{
  openChild: [what: ChildWorkInput, label: string]
}>()
const anonymous = computed(() => (props.card.origin === 'observed' ? 'nested agent' : 'agent'))
const openLabel = computed(() => props.card.title || props.card.kind || anonymous.value)
const status = computed(() => (props.card.running ? 'running' : (props.card.outcome ?? 'unreported')))
const statusLabel = computed(() => (status.value === 'unreported' ? 'ended' : status.value))
const facets = computed(() => subAgentFacets(props.card))

function openTranscript(): void {
  emit('openChild', { part: 'transcript', agentId: props.card.agentId }, openLabel.value)
}
</script>

<template>
  <div
    class="subagent"
    data-cy="subagent-entry"
    :data-status="status"
    :data-placement="placement"
    :data-agent-id="card.agentId"
    :title="card.agentId"
  >
    <div class="head" data-cy="subagent-head">
      <AgentState size="compact" v-bind="facets" :label="card.kind || anonymous" />
      <span class="who">
        <strong data-cy="subagent-kind">{{ card.kind || anonymous }}</strong>
        <span v-if="card.title" class="title" data-cy="subagent-title">{{ card.title }}</span>
      </span>
      <span v-if="card.running && card.lastTool" class="doing" data-cy="subagent-last-tool">
        {{ card.lastTool }}
      </span>
      <span class="status" data-cy="subagent-status">{{ statusLabel }}</span>
      <button
        v-if="canOpenTranscript"
        class="open-transcript"
        type="button"
        aria-label="Open transcript"
        data-cy="subagent-open-transcript"
        @click="openTranscript"
      >
        <span class="action-label">Open transcript</span> <span aria-hidden="true">→</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.subagent {
  min-width: 0;
  margin: var(--space-3) 0 0;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--panel);
  container-type: inline-size;
}

[data-placement='transcript'] {
  max-width: var(--measure-message);
  margin: var(--space-3) auto var(--space-6);
}

.head {
  display: flex;
  height: 43px;
  min-width: 0;
  align-items: center;
  padding: 0 var(--space-6);
  gap: var(--space-4);
  font-size: var(--type-caption);
}

.who {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: var(--space-3);
}

.who strong,
.title,
.doing {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.who strong {
  flex-shrink: 0;
  max-width: 40%;
  color: var(--text-soft);
  font-weight: var(--fw-semibold);
}

.title,
.doing {
  color: var(--muted);
}

.doing {
  max-width: 15%;
  font-family: var(--font-mono);
}

.status,
.open-transcript {
  flex: none;
  white-space: nowrap;
}

.status {
  color: var(--muted);
}

[data-status='running'] .status {
  color: var(--accent-text);
}

[data-status='completed'] .status {
  color: var(--success);
}

[data-status='failed'] .status {
  color: var(--danger);
}

.open-transcript {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-text);
  font: inherit;
}

.open-transcript:hover {
  text-decoration: underline;
}

@container (max-width: 500px) {
  .action-label {
    display: none;
  }
}
</style>
