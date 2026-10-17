<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import type { WhatTheModelGot } from '../../../shared/what-this-agent-was-given'
import {
  MODEL_GOT_WHERE_WORDS,
  NOT_YET,
  READ_WHAT_THE_MODEL_GOT,
  recordLeavesOutWords,
  SENT_NOT_KEPT_YET,
  SENT_WITH_THE_CLOSING_BLOCK,
  sizeWords,
} from '../lib/agent-inputs'
import { readableError } from '../lib/session-record'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'

/**
 * 🔴 **F093 (C9 d) · what the model got with one message** — shown under a message's "Show what the
 * model got" switch, in the transcript and in the popup's Per message tab.
 *
 * ⚑ **The one read, `whatTheModelGot`**, made when it opens, where the pane provides it: BroBot's
 * parts in the order the model read them, each with where it sat, and the provider's own record of
 * the turn. ⚑ Without the read (a recording, or a message with no ordinal), or while it is out, it
 * draws what the message itself keeps: `sent`, the whole text the provider was handed. ⛔ A part
 * that is not recorded says so.
 */
const props = defineProps<{
  words: string
  sent?: string
  /** The paths BroBot attached to the words, as recorded. */
  attached?: readonly string[]
  /** {@link sent} carries the other messages of its turn too. */
  together?: boolean
  /** Why there is no {@link sent}, where not "from before it was kept". */
  why?: string
  /** Its ledger ordinal: the read's address. */
  ordinal?: number
  /** The go-ahead this app sent so the agent carries on. */
  goAhead?: boolean
}>()

const recordRole = (part: { author: string }): string =>
  part.author === 'the-provider' ? 'Added by the provider' : 'The message'

const readIt = inject(READ_WHAT_THE_MODEL_GOT, null)
const got = ref<WhatTheModelGot | null>(null)
const gotWhy = ref<string | null>(null)
const reading = ref(false)

onMounted(async () => {
  if (readIt === null || props.ordinal === undefined) return
  reading.value = true
  try {
    got.value = await readIt(props.ordinal)
  } catch (error) {
    gotWhy.value = `Couldn’t read the whole turn: ${readableError(error)}`
  } finally {
    reading.value = false
  }
})
</script>

<template>
  <div class="what-it-got" data-cy="what-the-model-got">
    <p v-if="reading" class="standing">Reading…</p>

    <!-- The whole turn, from the read. -->
    <template v-else-if="got">
      <p class="part-head">BroCrew’s parts, in the order the model read them</p>
      <div v-for="(part, at) in got.parts" :key="at" class="part" data-cy="what-the-model-got-part">
        <p class="part-title">
          <strong>{{ part.title }}</strong>
          <span class="where">{{ MODEL_GOT_WHERE_WORDS[part.where] }}</span>
          <span v-if="part.size" class="where">{{ sizeWords(part.size) }}</span>
        </p>
        <p v-if="part.path" class="path">{{ part.path }}</p>
        <p v-if="part.heading" class="path" data-cy="what-the-model-got-heading">
          Above it: {{ part.heading }}
        </p>
        <details v-if="part.text !== null" :open="part.where === 'this-message'">
          <summary class="where">The text</summary>
          <pre class="words">{{ part.text }}</pre>
        </details>
        <p v-else class="not-yet">{{ part.why }}</p>
      </div>
      <p
        v-if="got.launch && !got.launch.recorded"
        class="not-yet"
        data-cy="what-the-model-got-unrecorded"
      >
        Its launch kept no record, so the parts before this message are composed now.
      </p>

      <p class="part-head">The provider’s own record of the turn</p>
      <template v-if="got.providersRecord.found">
        <p class="standing" data-cy="what-the-model-got-record">
          As kept in its own file
          {{ got.providersRecord.version ? `by version ${got.providersRecord.version}` : '' }}.
          {{
            got.providerKeptTheSameText === true
              ? 'It kept the same text BroCrew handed over.'
              : got.providerKeptTheSameText === false
                ? 'Its text differs from what BroCrew handed over.'
                : ''
          }}
        </p>
        <div
          v-for="(part, at) in [...got.providersRecord.standing, ...got.providersRecord.parts]"
          :key="at"
          class="part"
          data-cy="what-the-model-got-record-part"
        >
          <p class="part-title">
            <strong>{{ part.title ?? part.label }}</strong>
            <!-- ⚑ Said only where it adds to the title: "The message · The message" said nothing. -->
            <span v-if="recordRole(part) !== (part.title ?? part.label)" class="where">{{
              recordRole(part)
            }}</span>
          </p>
          <details :open="part.author === 'the-message'">
            <summary class="where">The text</summary>
            <pre class="words">{{ part.text }}</pre>
          </details>
        </div>
        <p
          v-if="
            recordLeavesOutWords(
              PROVIDER_NAME[got.providersRecord.provider],
              got.providersRecord.leavesOut,
            )
          "
          class="not-yet"
          data-cy="what-the-model-got-record-leaves-out"
        >
          {{
            recordLeavesOutWords(
              PROVIDER_NAME[got.providersRecord.provider],
              got.providersRecord.leavesOut,
            )
          }}
        </p>
        <p v-if="!got.providersRecord.whole" class="not-yet">
          The provider’s record of this turn is not whole: some of it could not be read.
        </p>
      </template>
      <p v-else class="not-yet" data-cy="what-the-model-got-record-why">
        {{ got.providersRecord.why }}
      </p>
    </template>

    <!-- What the message itself keeps. -->
    <template v-else>
      <p v-if="gotWhy" class="not-yet" data-cy="what-the-model-got-why">{{ gotWhy }}</p>
      <template v-if="props.sent !== undefined">
        <p class="part-head">The whole text it was handed</p>
        <p v-if="props.together" class="standing" data-cy="what-the-model-got-together">
          Handed over in one text with the other messages of its turn.
        </p>
        <p
          v-else-if="props.goAhead && props.sent !== props.words"
          class="standing"
          data-cy="what-the-model-got-closing-block"
        >
          {{ SENT_WITH_THE_CLOSING_BLOCK }}
        </p>
        <p
          v-else-if="props.sent === props.words"
          class="standing"
          data-cy="what-the-model-got-as-typed"
        >
          Sent exactly as written: BroCrew added no lines to it.
        </p>
        <pre class="words" data-cy="what-the-model-got-sent">{{ props.sent }}</pre>
      </template>
      <template v-else>
        <p class="part-head">The words</p>
        <pre class="words" data-cy="what-the-model-got-words">{{ props.words }}</pre>
        <p class="part-head">BroCrew’s lines around them</p>
        <p
          v-for="path in props.attached ?? []"
          :key="path"
          class="attached"
          data-cy="what-the-model-got-attached"
        >
          This app attached <span class="path">{{ path }}</span>
        </p>
        <p class="not-yet" data-cy="what-the-model-got-lines">
          {{ props.why ?? `${NOT_YET} ${SENT_NOT_KEPT_YET}` }}
        </p>
      </template>
      <p class="part-head">The provider’s own record</p>
      <p class="not-yet" data-cy="what-the-model-got-reminders">{{ NOT_YET }}</p>
    </template>

    <p class="part-head">Always with it</p>
    <p class="standing">
      Its instructions, memory and tools: “What this agent receives” shows them.
    </p>
  </div>
</template>

<style scoped>
.what-it-got {
  display: grid;
  color: var(--text);
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-1);
  gap: var(--space-2);
}

.part-head {
  margin: var(--space-2) 0 0;
  color: var(--muted);
  font-size: var(--type-caption);
  font-weight: var(--fw-semibold);
}

.part-head:first-child {
  margin-top: 0;
}

.part {
  display: grid;
  padding: var(--space-3);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  gap: var(--space-2);
}

.part-title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 0;
  font-size: var(--type-small);
  gap: var(--space-2) var(--space-4);
}

.where {
  color: var(--muted);
  font-size: var(--type-caption);
}

.words {
  max-height: var(--max-code-h);
  margin: 0;
  overflow: auto;
  color: var(--text);
  font: var(--type-small) / var(--leading-relaxed) var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.attached {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-small);
}

.path {
  margin: 0;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
  overflow-wrap: anywhere;
}

.not-yet,
.standing {
  margin: 0;
  color: var(--faint);
  font-size: var(--type-small);
}
</style>
