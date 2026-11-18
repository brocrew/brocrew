<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { panelRuns, type PanelRun, type OpenPanelRun } from '../lib/panel-runs'
import type { TranscriptState } from '../lib/transcript'
import { useMinuteClock } from '../composables/useMinuteClock'
import { scheduledTimeWords, scheduledPromptPreview, scheduledNotStartedWords } from '../lib/scheduled-job-details'
import { droppedNote } from '../lib/background-work'
import { droppedScheduleNote } from '../lib/scheduled-work'
import CardSection from './CardSection.vue'
import CardEmpty from './CardEmpty.vue'
import PanelRunRow from './PanelRunRow.vue'
import PastRunsDialog from './PastRunsDialog.vue'
import ScheduledJobDialog from './ScheduledJobDialog.vue'
import OverlayHost from './OverlayHost.vue'

const props = withDefaults(defineProps<{
  state: TranscriptState
  conversation?: string
  canStop?: boolean
  onStop?: (id: string) => Promise<boolean>
  onOpenRun?: OpenPanelRun
  canNavigate?: (itemId: string) => boolean
  showSchedule?: boolean
}>(), { showSchedule: true })
const emit = defineEmits<{ navigate: [itemId: string] }>()
const runs = computed(() => panelRuns(props.state))
const recent = computed(() => runs.value.past.find((row) => row.failed))
const now = useMinuteClock()
const historyOpen = ref(false)
const unavailable = ref(false)
const scheduledId = ref<string | null>(null)
const scheduled = computed(() => runs.value.coming.find((job) => job.id === scheduledId.value) ?? null)
watch(scheduled, (job) => { if (!job) scheduledId.value = null })
const asked = ref(new Set<string>())
watch(() => props.conversation, () => {
  historyOpen.value = false
  unavailable.value = false
  scheduledId.value = null
  asked.value = new Set()
})
watch(() => props.state.background.running.map((row) => row.id).join('\u0000'), () => {
  const live = new Set(props.state.background.running.map((row) => row.id))
  asked.value = new Set([...asked.value].filter((id) => live.has(id)))
})
async function stop(id: string): Promise<void> {
  asked.value = new Set(asked.value).add(id)
  if (!(await props.onStop!(id))) {
    const next = new Set(asked.value)
    next.delete(id)
    asked.value = next
  }
}
async function open(run: PanelRun): Promise<void> {
  historyOpen.value = false
  if (run.target && props.onOpenRun && await props.onOpenRun(run.target)) return
  if (!props.onOpenRun && run.itemId) emit('navigate', run.itemId)
  else unavailable.value = true
}
</script>
<template>
  <CardSection icon="#i-bot" :count="runs.active.length" data-cy="panel-agents">
    <template #title><span data-cy="running-now-title">Running now</span></template>
    <div data-cy="running-now-rows">
      <PanelRunRow v-for="run in runs.active" :key="run.key" :run="run" :disabled="!onOpenRun && !!run.itemId && canNavigate?.(run.itemId) === false" :title="onOpenRun ? (run.target?.kind === 'agent' ? 'Open transcript' : 'Open output') : 'Show this in the conversation'" :can-stop="canStop && !!onStop" :stopping="!!run.stopId && asked.has(run.stopId)" @open="void open(run)" @stop="void stop(run.stopId!)" />
      <CardEmpty v-if="!runs.active.length" icon="#i-check" says="Nothing running." />
    </div>
    <p v-if="state.background.dropped" class="note">{{ droppedNote(state.background.dropped) }}</p>
    <template v-if="showSchedule && (runs.coming.length || state.schedule.dropped)">
      <p class="subheading">Coming up</p>
      <button v-for="job in runs.coming" :key="job.id" class="scheduled" type="button" :data-cy="`schedule-open-${job.id}`" @click="scheduledId = job.id">
        <span>{{ scheduledTimeWords(job, now) || job.schedule || 'Scheduled job' }}</span>
        <span v-if="scheduledNotStartedWords(job)" class="note">{{ scheduledNotStartedWords(job)?.short }}</span>
        <span class="note">{{ scheduledPromptPreview(job.prompt) }}</span>
      </button>
      <p v-if="state.schedule.dropped" class="note">{{ droppedScheduleNote(state.schedule.dropped) }}</p>
    </template>
    <template v-if="recent">
      <p class="subheading">Recently ended</p>
      <PanelRunRow :run="recent" @open="void open(recent)" />
    </template>
    <div class="footer"><button class="history" type="button" data-cy="past-runs-open" @click="historyOpen = true">Past runs ({{ runs.past.length }}) →</button></div>
  </CardSection>
  <OverlayHost v-if="historyOpen" label="Past runs" @close="historyOpen = false"><PastRunsDialog :runs="runs.past" @close="historyOpen = false" @open="void open($event)" /></OverlayHost>
  <OverlayHost v-if="scheduled" label="Scheduled job" @close="scheduledId = null"><ScheduledJobDialog :job="scheduled" :now="now" @close="scheduledId = null" /></OverlayHost>
  <OverlayHost v-if="unavailable" label="Run output" @close="unavailable = false"><section class="missing"><p>Output not available</p><button class="bb-button" type="button" @click="unavailable = false">Close</button></section></OverlayHost>
</template>
<style scoped>
.subheading { padding-top: var(--space-5); border-top: var(--border-width) solid var(--line); margin: var(--space-4) 0 0; color: var(--muted); font-size: var(--type-caption); }
.scheduled { display: grid; gap: var(--space-1); width: 100%; padding: var(--space-5) 0; border: 0; background: none; color: var(--text); text-align: left; font-size: var(--type-small); }
.note { color: var(--muted); font-size: var(--type-caption); }
.footer { padding-top: var(--space-5); border-top: var(--border-width) solid var(--line); display: flex; justify-content: flex-end; }
.history { border: 0; background: none; color: var(--accent-text); padding: 0; font-size: var(--type-caption); }
.missing { padding: var(--dialog-padding); border: var(--border-width) solid var(--line); border-radius: var(--radius-lg); background: var(--panel); color: var(--text); }
.missing p { margin-bottom: var(--space-5); }
</style>
