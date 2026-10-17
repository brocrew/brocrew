<script setup lang="ts">
import ModelGotSwitch from './ModelGotSwitch.vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { APP_NOTICE_MARK, THE_APP_IS_THE_AUTHOR } from '../../../shared/app-notice'
import type { AppNoticeItem, TranscriptItem } from '../lib/transcript'

/**
 * 🔴 **A message this app wrote to report something it observed** (624, `HO-095` §6.1).
 *
 * An approval carrier is an app notice, not words the person typed or a plan go-ahead. Give it its own entry so its avatar and caption reflect that origin before and after it flushes.
 *
 * ⛔ **Its own component, never `ContinuationEntry.vue` with a different caption.** That entry
 * means *BroBot sent this FOR you, because you pressed something*; this one means *the software
 * put this here, and nobody pressed anything* — `RelayedEntry`'s own argument, and `395`'s ruling
 * behind both: one entry making two different claims is one word answering two questions.
 *
 * ⚑ **The heading is {@link THE_APP_IS_THE_AUTHOR} and deliberately not `BroBot`** — the PO's
 * own correction, *"the app sent it, not BroBot"*: BroBot is an agent, and this row lands in
 * BroBot's conversation. See that constant for the argument.
 *
 * Show the complete sentence composed by the app and sent to the provider, as `ContinuationEntry` does. The person must be able to see the custom text the model received.
 *
 * ⛔ **No controls.** There is nothing for a person to cancel or take back — the fact is already
 * durable and these words are the only copy of it that reaches the model — and
 * `RuntimeHost.cancelQueuedMessage` refuses one at the door rather than leaving the rule to a
 * hidden button (`HO-095` §6.2, `a-conditional-override-is-not-a-bound`).
 */
defineProps<{ item: AppNoticeItem & Pick<TranscriptItem, 'at' | 'ordinal'> }>()
</script>

<template>
  <article class="msg app" data-cy="app-notice">
    <div class="msg-avatar">
      <svg class="icon"><use href="#i-bot" /></svg>
    </div>
    <div class="msg-column">
      <div class="msg-meta">
        <!-- Never "You". The whole entry exists because this was "You" and should not have been. -->
        <strong data-cy="app-notice-sender">{{ THE_APP_IS_THE_AUTHOR }}</strong>
        <span class="about" data-cy="app-notice-mark">{{ APP_NOTICE_MARK }}</span>
        <!-- In the META row, never inside the body — 001's rule: `textContent` of the message has
             to be exactly what went to the provider. -->
        <span class="time">{{ clockTime(item.at) }}</span>
      </div>
      <div
        class="msg-body"
        data-cy="app-notice-message"
        :data-at="clockTime(item.at)"
        :title="fullTime(item.at)"
      >
        {{ item.text }}
      </div>
      <ModelGotSwitch
        :words="item.text"
        :sent="item.sent"
        :together="item.sentWithOthers === true"
        :ordinal="item.ordinal"
      />
    </div>
  </article>
</template>

<style scoped>
.msg {
  display: grid;
  max-width: var(--measure-message);
  margin: 0 auto var(--space-10);
  gap: var(--space-5);
  grid-template-columns: var(--avatar) minmax(0, 1fr);
}

.msg-column {
  min-width: 0;
}

/* Dashed, where the user's avatar is solid — the same "this is not the person" signal the row's
   heading gives, available at a glance to someone scrolling past without reading. */
.msg-avatar {
  display: grid;
  width: var(--avatar);
  height: var(--avatar);
  border: var(--border-width) dashed var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--muted);
  place-items: center;
}

.msg-avatar .icon {
  width: 15px;
  height: 15px;
}

.msg-meta {
  display: flex;
  height: 22px;
  align-items: center;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
}

.msg-meta strong {
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

/* Permanently visible, not a hover affordance — 074's rule for the attribution mark, and for the
   same reason: who a message is attributed to is part of reading it. */
.about {
  color: var(--faint);
  font-size: var(--type-caption);
}

.time {
  margin-left: auto;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
  opacity: 0.55;
  transition: opacity var(--dur-fast) ease;
}

.msg:hover .time {
  opacity: 1;
}

.msg-body {
  padding-top: var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-reading);
  line-height: var(--leading-reading);
  white-space: pre-wrap;
}
</style>
