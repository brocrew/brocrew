<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useMinuteClock } from '../composables/useMinuteClock'
import { usePersistentToggle } from '../composables/usePersistentToggle'
import { nextWake, scheduleHeld } from '../../../shared/agent-state'
import { droppedScheduleNote, scheduleHead, scheduleLine } from '../lib/scheduled-work'
import {
  scheduledNotStartedWords,
  SCHEDULE_NOT_STARTED_TAG,
  scheduledPromptPreview,
  scheduledTimeWords,
  comingTimeWords,
} from '../lib/scheduled-job-details'
import type { ScheduleRegistry } from '../lib/transcript'
import OverlayHost from './OverlayHost.vue'
import ScheduledJobDialog from './ScheduledJobDialog.vue'

const props = defineProps<{ registry: ScheduleRegistry; fold?: string }>()
// Folded until a person opens it: one line says how many jobs and when the next one fires.
const folded = usePersistentToggle(
  props.fold ?? '',
  Boolean(props.fold),
  props.fold ? undefined : null,
)
const bodyId = useId()
const now = useMinuteClock()
const held = computed(() => scheduleHeld(props.registry))
/** When the next job fires, in words, or `null` where no job's time is known. */
const nextSays = computed(() => {
  const at = nextWake(props.registry.jobs, now.value)
  return at === null ? null : comingTimeWords(at, now.value) || null
})
const lines = computed(() =>
  props.registry.jobs.map((job) => ({
    ...scheduleLine(job),
    next: scheduledTimeWords(job, now.value),
    preview: scheduledPromptPreview(job.prompt),
    notStarted: scheduledNotStartedWords(job),
  })),
)
const openedId = ref<string | null>(null)
const opened = computed(() => props.registry.jobs.find((job) => job.id === openedId.value) ?? null)
// A removed job cannot reopen its popup if the provider later reuses its id.
watch(opened, (job) => {
  if (!job) openedId.value = null
})
// A different listing or a folded block cannot leave the previous job's popup open.
watch(
  () => props.registry,
  () => {
    openedId.value = null
  },
)
watch(folded, () => {
  openedId.value = null
})

const ASKS_TITLE =
  'What this job will send when it fires — the provider’s own copy of it, which it may have shortened.'
const WHEN_TITLE = 'The schedule exactly as the provider sent it. Only the provider can honour it.'
const ID_TITLE =
  'The provider named no schedule and no prompt for this job. This is its own id for it.'
function cellTitle(caveat: string, shown: { full: string }): string {
  return `${caveat}\n\n${shown.full}`
}
</script>

<template>
  <aside
    v-if="held"
    class="sch-bar"
    data-cy="schedule-bar"
    :data-folded="props.fold ? folded : undefined"
  >
    <p v-if="props.fold" class="sch-head">
      <button
        type="button"
        class="sch-fold"
        :aria-expanded="!folded"
        :aria-controls="bodyId"
        data-cy="schedule-fold"
        @click="folded = !folded"
      >
        <svg class="sch-icon sch-chevron" :class="{ folded }" aria-hidden="true">
          <use href="#i-chevron" />
        </svg>
        <strong data-cy="schedule-head">{{ scheduleHead(props.registry) }}</strong>
        <span v-if="nextSays" class="sch-next" data-cy="schedule-next">· next {{ nextSays }}</span>
      </button>
    </p>
    <p v-else class="sch-head">
      <svg class="sch-icon" aria-hidden="true"><use href="#i-clock" /></svg>
      <strong data-cy="schedule-head">{{ scheduleHead(props.registry) }}</strong>
    </p>
    <div v-show="!folded" :id="bodyId" class="sch-body">
      <ol class="sch-rows">
        <li
          v-for="line in lines"
          :key="line.id"
          class="sch-row"
          :data-cy="`schedule-row-${line.id}`"
          :data-bare="String(line.fallback !== undefined)"
        >
          <button
            type="button"
            class="sch-open"
            aria-haspopup="dialog"
            :aria-label="`Open scheduled job: ${line.next || line.when?.text || line.fallback?.text || 'Scheduled job'}${line.repeat ? ` · ${line.repeat}` : ''}. ${line.notStarted ? `${line.notStarted.short}. ` : ''}${line.preview}${line.notStarted ? ` ${line.notStarted.detail}` : ''}`"
            :data-cy="`schedule-open-${line.id}`"
            @click="openedId = line.id"
          >
            <span class="sch-when">
              <span v-if="line.next" class="sch-time" :data-cy="`schedule-next-${line.id}`">{{
                line.next
              }}</span>
              <code
                v-else-if="line.when"
                :data-cy="`schedule-when-${line.id}`"
                :title="cellTitle(WHEN_TITLE, line.when)"
                >{{ line.when.text }}</code
              >
              <code
                v-else-if="line.fallback"
                :data-cy="`schedule-id-${line.id}`"
                :title="cellTitle(ID_TITLE, line.fallback)"
                >{{ line.fallback.text }}</code
              >
              <span v-else class="sch-time">Scheduled job</span>
              <span v-if="line.repeat" class="sch-repeat" aria-hidden="true">·</span>
              <span v-if="line.repeat" class="sch-repeat" :data-cy="`schedule-repeat-${line.id}`">{{
                line.repeat
              }}</span>
              <span v-if="line.notStarted" class="sch-repeat" aria-hidden="true">·</span>
              <span
                v-if="line.notStarted"
                class="sch-repeat"
                :data-cy="`schedule-not-started-${line.id}`"
                >{{ SCHEDULE_NOT_STARTED_TAG }}</span
              >
              <svg class="sch-icon sch-open-icon" aria-hidden="true"><use href="#i-chevron" /></svg>
            </span>
            <span
              class="sch-asks"
              :data-cy="`schedule-asks-${line.id}`"
              :title="
                [line.notStarted?.detail, line.asks ? cellTitle(ASKS_TITLE, line.asks) : undefined]
                  .filter(Boolean)
                  .join('\n\n') || undefined
              "
              >{{ line.preview }}</span
            >
          </button>
        </li>
      </ol>
      <p v-if="props.registry.dropped > 0" class="sch-dropped" data-cy="schedule-dropped">
        {{ droppedScheduleNote(props.registry.dropped) }}
      </p>
    </div>
    <!-- Escape the Agent panel's size container so the existing overlay covers the window. -->
    <Teleport to="body">
      <OverlayHost v-if="opened" label="Scheduled job" @close="openedId = null">
        <ScheduledJobDialog :job="opened" :now="now" @close="openedId = null" />
      </OverlayHost>
    </Teleport>
  </aside>
</template>

<style scoped>
/* A section of the agent card, as Current task is: the panel's width, its heading at the left. */
.sch-bar {
  padding: var(--space-4) var(--space-6);
  border: var(--border-width) solid var(--drawer-card-line, var(--line));
  border-radius: var(--radius-lg);
  background: var(--drawer-card-bg, var(--panel));
}
.sch-next {
  overflow: hidden;
  min-width: 0;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sch-head {
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-caption);
  gap: var(--space-4);
}
.sch-icon {
  width: 11px;
  height: 11px;
  flex: none;
  color: var(--faint);
}
.sch-fold,
.sch-open {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  gap: var(--space-4);
  text-align: left;
}
.sch-fold {
  flex: 1 1 auto;
}
.sch-chevron {
  transform: rotate(90deg);
}
.sch-chevron.folded {
  transform: none;
}
.sch-rows {
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}
.sch-row {
  padding: var(--space-3) 0;
}
.sch-open {
  display: grid;
  width: 100%;
  gap: var(--space-2);
}
.sch-when {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--space-4);
}
/* The complete expression and prompt are available in the popup. */
.sch-when code,
.sch-time,
.sch-asks {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sch-when code {
  color: var(--mono-text);
  font: var(--type-caption) / 1.4 var(--font-mono);
}
.sch-time {
  color: var(--text-soft);
  font-size: var(--type-caption);
}
.sch-repeat {
  flex: none;
  color: var(--faint);
  font-size: var(--type-caption);
}
.sch-open-icon {
  margin-left: auto;
}
.sch-asks {
  color: var(--muted);
  font-size: var(--type-caption);
}
.sch-dropped {
  margin: var(--space-4) 0 0;
  color: var(--waiting);
  font-size: var(--type-caption);
}
</style>
