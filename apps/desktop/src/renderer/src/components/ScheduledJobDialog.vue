<script setup lang="ts">
import { computed, useId } from 'vue'
import { scheduleLine, SCHEDULE_PROMPT_CHARS, SCHEDULE_WHEN_CHARS } from '../lib/scheduled-work'
import {
  scheduledPromptText,
  scheduledNotStartedWords,
  scheduledRecordedTimeWords,
  type TimedScheduledJob,
} from '../lib/scheduled-job-details'

const props = defineProps<{ job: TimedScheduledJob; now: number }>()
const emit = defineEmits<{ close: [] }>()
const titleId = useId()
const line = computed(() => scheduleLine(props.job))
const prompt = computed(() => scheduledPromptText(props.job.prompt))
const when = computed(() => scheduledRecordedTimeWords(props.job, props.now))
const notStarted = computed(() => scheduledNotStartedWords(props.job))
const longerCopy = computed(
  () =>
    (props.job.prompt?.length ?? 0) > SCHEDULE_PROMPT_CHARS ||
    (props.job.schedule?.length ?? 0) > SCHEDULE_WHEN_CHARS ||
    (line.value.fallback !== undefined && props.job.id.length > SCHEDULE_WHEN_CHARS),
)
</script>

<template>
  <section class="job-dialog" :aria-labelledby="titleId" data-cy="scheduled-job-dialog">
    <header class="job-head">
      <h2 :id="titleId" class="bb-title">Scheduled job</h2>
      <button
        type="button"
        class="bb-button bb-button--icon"
        aria-label="Close scheduled job"
        data-cy="close-scheduled-job"
        @click="emit('close')"
      >
        <svg class="icon"><use href="#i-x" /></svg>
      </button>
    </header>
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
        <pre class="bb-reader job-prompt" data-cy="scheduled-job-prompt">{{ prompt }}</pre>
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
  </section>
</template>

<style scoped>
.job-dialog {
  display: flex;
  width: min(var(--dialog-w), calc(100% - 2 * var(--lane-clear)));
  max-height: min(var(--dialog-max-h), calc(100dvh - var(--dialog-gutter) * 2));
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
}

.job-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: var(--dialog-padding);
  border-bottom: var(--border-width) solid var(--line);
  gap: var(--control-gap);
}

.job-head h2 {
  margin: 0;
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
