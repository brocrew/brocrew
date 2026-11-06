<script setup lang="ts">
import SystemTranscriptEntryFrame from './SystemTranscriptEntryFrame.vue'
import ModelGotSwitch from './ModelGotSwitch.vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { GO_AHEAD_AUTHORSHIP, GO_AHEAD_SENDER } from '../lib/plan-mode'
import type { ContinuationItem, TranscriptItem } from '../lib/transcript'

/**
 * 🔴 **A message BroBot sent, drawn as BroBot's** (278 §1, from 276).
 *
 * Start work on this plan sends `Go ahead with this plan.` as app-authored words. The person's button press does not mean they typed that sentence.
 *
 * ⛔ **The message stays. Only the authorship changes.** 276 measured the alternative: with the
 * mode switch alone and nothing sent, real Codex started **0/2** turns and produced **0/2** work.
 * Deleting the sentence would not be honesty, it would be a plan-mode button that does nothing.
 *
 * ⚠️ **Its own component, never `UserMessage.vue` with a badge**, on the reasoning `QueuedMessage`
 * already carries: a message the person WROTE and a message BroBot wrote for them must not be
 * distinguishable only by a footnote somebody has to notice. `214` removed 12,646 messages that
 * rendered injected material as *"You"*; a "You" heading with a disclaimer under it is that defect
 * wearing a label. So the heading is {@link GO_AHEAD_SENDER}, the avatar is the bot, and the row
 * reads as what it is.
 *
 * Show the injected words in full. The composer discloses them before the click and this entry shows them afterward; both read `GO_AHEAD_MESSAGE` so the displayed and sent values stay aligned.
 */
defineProps<{ item: ContinuationItem & Pick<TranscriptItem, 'at' | 'ordinal'> }>()
</script>

<template>
  <SystemTranscriptEntryFrame data-cy="continuation">
    <template #meta>
      <!-- Never "You". The whole entry exists because this was "You" and should not have been. -->
      <strong data-cy="continuation-sender">{{ GO_AHEAD_SENDER }}</strong>
      <span class="on-your-behalf system-entry-mark" data-cy="continuation-mark">sent for you</span>
      <!-- In the META row, never inside the body — 001's rule: `textContent` of the message has to
             be exactly what went to the provider, which is what a copy, a search or an assertion
             gets. Putting the clock in the body once turned "PINGPONG" into "PINGPONG00:55". -->
      <span class="time">{{ clockTime(item.at) }}</span>
    </template>
    <div
      class="msg-body"
      data-cy="continuation-message"
      :data-at="clockTime(item.at)"
      :title="fullTime(item.at)"
    >
      {{ item.text }}
    </div>
    <ModelGotSwitch
      :words="item.text"
      :sent="item.sent ?? item.text"
      :together="item.sentWithOthers === true"
      :go-ahead="true"
      :ordinal="item.ordinal"
    />
    <!-- Why a message nobody typed is in the conversation, said HERE rather than in a tooltip:
           the causality is the thing 276 argued must survive a reload, and a hover affordance is
           not a durable transcript. Quiet, because it is an explanation and not a warning —
           nothing went wrong. -->
    <p class="why" data-cy="continuation-why">{{ GO_AHEAD_AUTHORSHIP }}</p>
  </SystemTranscriptEntryFrame>
</template>

<style scoped>
/* Under the body, never inside it, exactly as `UserMessage.vue` keeps BroBot's attached paths out
   of the person's quoted words — the same rule pointed the other way. */
.why {
  margin: var(--space-2) 0 0;
  color: var(--faint);
  font-size: var(--type-caption);
  line-height: 1.5;
}
</style>
