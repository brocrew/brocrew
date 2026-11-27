<script setup lang="ts">
import { computed, useId } from 'vue'
import { scheduleLine, SCHEDULE_PROMPT_CHARS, SCHEDULE_WHEN_CHARS } from '../lib/scheduled-work'
import {
  scheduledPromptText,
  scheduledNotStartedWords,
  scheduledRecordedTimeWords,
  type TimedScheduledJob,
} from '../lib/scheduled-job-details'
import ListDialogShell from './ListDialogShell.vue'

const props = defineProps<{ job: TimedScheduledJob; now: number }>()
const emit = defineEmits<{ close: [] }>()
const titleId = useId()
const line = computed(() => scheduleLine(props.job))
const input = computed(() => props.job.run?.input ?? props.job.prompt)
const prompt = computed(() => scheduledPromptText(input.value))
const when = computed(() => scheduledRecordedTimeWords(props.job, props.now))
const notStarted = computed(() => scheduledNotStartedWords(props.job))
const longerCopy = computed(
  () =>
    (input.value?.length ?? 0) > SCHEDULE_PROMPT_CHARS ||
    (props.job.schedule?.length ?? 0) > SCHEDULE_WHEN_CHARS ||
    (line.value.fallback !== undefined && props.job.id.length > SCHEDULE_WHEN_CHARS),
)
</script>

<template>
  <ListDialogShell
    :title-id="titleId"
    close-label="Close scheduled job"
    close-cy="close-scheduled-job"
    data-cy="scheduled-job-dialog"
    @close="emit('close')"
  >
    <template #title>Scheduled job</template>
    <div class="job-body">
      <p v-if="notStarted" class="bb-caption bb-muted" data-cy="scheduled-job-not-started">
        {{ notStarted.detail }}
      </p>
      <p v-if="when || line.repeat" class="job-facts" data-cy="scheduled-job-time">
        {{ when }}<template v-if="when && line.repeat"> · </template>{{ line.repeat }}
      </p>
      <p v-if="line.when" class="job-facts">
        Provider’s schedule:
        <code data-cy="scheduled-job-expression">{{ line.when.full }}</code>
      </p>
      <p v-else-if="line.fallback" class="job-facts" data-cy="scheduled-job-id">
        {{ line.fallback.full }}
      </p>
      <p v-if="longerCopy" class="bb-caption bb-muted" data-cy="scheduled-job-long-copy">
        The available copy is longer than expected; it is shown here in full.
      </p>
      <template v-if="prompt !== null">
        <div class="bb-reader job-prompt" data-cy="scheduled-job-prompt">{{ prompt }}</div>
        <p
          v-if="prompt.trim() === ''"
          class="bb-caption bb-muted"
          data-cy="scheduled-job-blank-prompt"
        >
          {{
            prompt === ''
              ? 'The supplied prompt is empty.'
              : 'The supplied prompt contains only whitespace.'
          }}
        </p>
        <p class="bb-caption bb-muted" data-cy="scheduled-job-copy-note">
          The provider’s copy of the prompt; it may already have been shortened.
        </p>
      </template>
      <p v-else class="bb-caption bb-muted" data-cy="scheduled-job-missing-prompt">
        The provider has not supplied this job’s prompt yet.
      </p>
    </div>
  </ListDialogShell>
</template>

<style scoped>
.list-dialog {
  width: min(var(--dialog-w), calc(100% - 2 * var(--lane-clear)));
}

.job-body {
  display: grid;
  min-height: 0;
  padding: var(--dialog-padding);
  overflow: auto;
  gap: var(--space-4);
}

.job-facts {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-small);
  overflow-wrap: anywhere;
}

.job-prompt {
  margin: 0;
  color: var(--text-soft);
  font: var(--type-small) / var(--leading-reading) var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
