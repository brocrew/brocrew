<script setup lang="ts">
import { computed } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { instructionAskedSentence } from '../lib/instruction-asked'
import { lostReplySentence } from '../lib/lost-reply'
import { askedToStopSays, stopUnansweredSays } from '../lib/stop-unanswered'
import type { AgentIdentity, Provider } from '../../../shared/runtime-ipc'
import { toldClause, type NoticeItem, type TranscriptItem } from '../lib/transcript'

/** Session/turn lifecycle and errors, kept visible but out of the way. */
const props = defineProps<{
  item: NoticeItem & Pick<TranscriptItem, 'at'>
  /**
   * 🔴 **667 · the roster, so a lost reply names its parent the way the reply's card does.**
   * ⚑ **712 · and an ask about an identity's rules names both identities** (R41).
   * ⚑ **737 · and who asked a turn to stop** — the ask's notice and the one that says it went
   * unanswered (`734` F-2, `732` F-4).
   * ⚠️ `null`/absent is the roster not having landed, and the parent then reads as its slug; the
   * asker of a stop reads as its category (*an agent*), the rows' own rule.
   */
  identities?: readonly AgentIdentity[] | null
  /**
   * 🔴 **730 · R83 — this conversation's provider**, so a Stop it has not answered names it
   * (*"Codex has not answered the stop…"*). ⚑ Absent where the surface does not know it; the
   * notice then says *the provider*, which is what the fold wrote.
   */
  provider?: Provider | null
  canRecoverSignIn?: boolean
  signInExpired?: boolean
  signInRenewed?: boolean
  recoveringSignIn?: boolean
}>()

defineEmits<{ signIn: []; retrySignIn: [] }>()
const expired = computed(
  () =>
    props.signInExpired || (props.item.claudeSignIn?.needsSignIn === true && !props.signInRenewed),
)

/**
 * ⚑ **712 · R41 — an ask about an identity's rules, both identities named** (`instruction-asked.ts`),
 * or the fold's own sentence for every other notice.
 */
const askedOrText = computed(() =>
  props.item.instructionAsked === undefined
    ? stopAskedOrText.value
    : instructionAskedSentence(props.item.instructionAsked, props.identities ?? null),
)
/** ⚑ **737 · who asked a turn to stop, named with the roster** — the fold wrote its category. */
const stopAskedOrText = computed(() =>
  props.item.askedToStop === undefined
    ? props.item.text
    : askedToStopSays(props.item.askedToStop, props.identities ?? null),
)
/** ⚑ **730 · R83 — one function, with the provider** — the fold wrote it with none. */
const stopOrAsked = computed(() =>
  props.item.stopUnanswered === undefined
    ? askedOrText.value
    : stopUnansweredSays(
        props.item.stopUnanswered,
        props.provider ?? null,
        props.identities ?? null,
      ),
)
/** ⚑ **One function, with the roster** — the fold wrote the same function's roster-less answer. */
const said = computed(() =>
  props.item.claudeSignIn?.state === 'refused'
    ? expired.value
      ? 'Claude sign-in expired.'
      : "Couldn't continue with the old sign-in."
    : props.item.lostReply === undefined
      ? stopOrAsked.value
      : lostReplySentence(props.item.lostReply, props.identities ?? null),
)
/** ⚑ **685 · what a refused call was told, off its own receipt** — see `NoticeItem.told`. */
const told = computed(() => toldClause(props.item.told, props.item.toldInPart === true))
</script>

<template>
  <div
    class="notice-entry"
    :class="item.level"
    :data-cy="`notice-${item.level}`"
    :aria-live="item.claudeSignIn ? 'polite' : undefined"
  >
    <span class="dot"></span>
    <!-- ⚠️ **Not `notice-…`**: `[data-cy^="notice-"]` is how every test counts NOTICES, and a child
         hook under that prefix counted each one twice. -->
    <!-- 🔴 **672 · a notice a person has to act on is drawn WHOLE, and every notice can be read
         whole.** ⛔ `.what` was one line with an ellipsis and no title, so the stale sign-in
         notice's instruction — where to press — was cut after its first clause on every width
         this column is drawn at, before `672` rewrote it and after. ⚑ An `error` or a `warn`
         wraps (the style below); an `info` notice stays a hairline and carries its whole
         sentence on the title. -->
    <span
      class="what"
      :class="{ 'providers-words': item.providersWords === true }"
      data-cy="what-the-notice-says"
      :title="said"
      >{{ said }}<span v-if="told" class="told" data-cy="refusal-told">{{ told }}</span></span
    >
    <button
      v-if="item.claudeSignIn?.state === 'refused' && canRecoverSignIn"
      class="sign-in-action"
      type="button"
      data-cy="claude-sign-in-action"
      :disabled="recoveringSignIn"
      @click="expired ? $emit('signIn') : $emit('retrySignIn')"
    >
      {{ expired ? 'Sign in again' : 'Retry with current sign-in' }}
    </button>
    <details v-if="item.claudeSignIn" class="sign-in-details" data-cy="claude-sign-in-details">
      <summary>Details</summary>
      <div class="diagnostics">
        <p v-if="item.claudeSignIn.state === 'refused'">{{ item.text }}</p>
        <p v-for="(detail, index) in item.claudeSignIn.details" :key="index">{{ detail }}</p>
      </div>
    </details>
    <span class="time" :title="fullTime(item.at)">{{ clockTime(item.at) }}</span>
  </div>
</template>

<style scoped>
/* A hairline across the thread: present, readable, and never mistaken for something said. */
.notice-entry {
  display: flex;
  max-width: var(--measure-message);
  align-items: center;
  justify-content: center;
  margin: var(--space-1) auto var(--space-6);
  color: var(--faint);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.notice-entry::before,
.notice-entry::after {
  flex: 1;
  height: var(--border-width);
  background: linear-gradient(90deg, transparent, var(--line), transparent);
  content: '';
}

.what {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--faint);
}

.notice-entry.warn {
  color: var(--waiting);
}

.notice-entry.warn .dot {
  background: var(--waiting);
}

.notice-entry.error {
  color: var(--danger-text-notice);
}

.notice-entry.error .dot {
  background: var(--danger);
}

/* 🔴 **672 · the two levels a person acts on wrap** — see the template. ⚠️ The hairlines either
   side give way to the sentence: they are `flex: 1` and the sentence is the flexible middle. */
.notice-entry.error .what,
.notice-entry.warn .what {
  white-space: normal;
}

/* 🔴 **672 · …but the PROVIDER's words are clamped** (`NoticeItem.providersWords`). ⛔ Nothing
   bounds them on the way in, and a wrapped wall of a provider's response body is not a sentence a
   person acts on; three lines of it and the whole on the title is. The app's own sentences are not
   clamped — they are the instruction, and they are bounded by being written here. */
.notice-entry .what.providers-words {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.time {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  opacity: 0.7;
}

.sign-in-action,
.sign-in-details summary {
  color: var(--text);
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}

.sign-in-action {
  padding: var(--space-1) var(--space-2);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
}

.sign-in-action:disabled {
  cursor: default;
  opacity: 0.6;
}

.notice-entry:has(.sign-in-details[open]) {
  flex-wrap: wrap;
}
.sign-in-details[open] {
  flex-basis: 100%;
  order: 2;
}
.diagnostics {
  max-height: 280px;
  overflow: auto;
  padding: var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
