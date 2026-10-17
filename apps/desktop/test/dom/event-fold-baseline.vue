<script setup lang="ts">
/*
 * ⛔ **`EventStream.vue` AS IT SHIPPED AT `4d771e8`, frozen** — the "before" column of `255`'s
 * measurement, and nothing else in this repo may import it.
 *
 * ⚠️ **A copy on purpose, and it must NOT be kept in sync.** `255` §2 asked for before-and-after
 * numbers on the same corpus, and a "before" measured in one process against an "after" measured in
 * another is a report about the laptop. `event-fold-scale.probe.ts` mounts this and the real
 * component ALTERNATELY in one run so both see the same machine under the same load. The moment
 * someone "fixes" this file to match the current one, the probe measures nothing.
 *
 * ⚑ **`clockTime` is inlined below** rather than imported, because `lib/clock.ts` was the other half
 * of what `255` changed: importing it would have made the "before" column half-fixed already.
 *
 * ⚠️ Not collected by any project — `vitest.dom.config.ts` includes `*.dom.test.ts` and
 * `vitest.config.ts` excludes `test/dom/**` entirely. It runs only under `pnpm run probe:event-fold`.
 */
import { computed } from 'vue'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { useStickToBottom } from '../../src/renderer/src/composables/useStickToBottom'
import { describeEvent } from '../../src/renderer/src/lib/describe-event'
import type { WindowState } from '../../src/renderer/src/lib/transcript-window'

// The pre-255 clock, inlined so the A/B measures the tab as it SHIPPED.
function clockTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at)) return ''
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/**
 * The raw stream — a tab in the one drawer since 080, an `<aside>` of its own before that.
 *
 * ⚠️ **It is no longer what the debug toggle opens, and that separation is the point of the move.**
 * `toggle-debug-mode` now means one thing only: put lifecycle notices *inline in the conversation*
 * (079 §3). This tab is the other thing it used to mean — every event there is, unfiltered — and it
 * is opened by asking for it. One control, one meaning, each with its own home.
 *
 * Unlike the conversation beside it this filters NOTHING, in either mode. That is the contract the
 * note below states in the panel itself.
 *
 * ⛔ **…and FILTERING NOTHING was never the same claim as HOLDING EVERYTHING** (237 §1, from `230`
 * H1). This panel said *"Here you always see everything"* over `record.window.entries` — the ONE
 * bounded array that also feeds the conversation (`session-record.ts`, deliberately: one bound, no
 * second copy to forget). ⚠️ **The bound is real**: 2,500 events a page, two pages held, and on
 * event 5,001 `appendLive` releases the oldest 1,251 — so a `Bash` call early in a noisy turn is
 * gone from this tab and from the transcript at once. Off the tail it is worse and cheaper: the
 * array freezes, new events go to the control tail, and the sentence went on promising everything.
 *
 * ⛔ **So the WINDOW is a prop, not the entries.** ⚑ `211 §4` put `data-category` on these rows so
 * that a filtered conversation could not blind the instrument that justified the filter; this is the
 * same argument one level up — a BOUNDED tab can blind the instrument that justifies an absence.
 * The rows and the fact about the rows now come from one object, so a reader of either cannot be
 * reading about a different moment than the other.
 */
const props = defineProps<{ window: WindowState }>()

const messages = computed(() => props.window.entries)

const { el, onScroll } = useStickToBottom(() => messages.value.length)

/**
 * A neutral colour key per event, off OUR event vocabulary — never off anything provider-shaped.
 * Lifecycle is the dim one because it is the noise the reading surface drops.
 */
function kindOf(event: TranscriptEvent): string {
  switch (event.type) {
    case 'permission_request':
    case 'user_input_request':
    case 'user_decision':
      return 'k-perm'
    case 'tool_call':
    case 'tool_result':
      return 'k-tool'
    case 'error':
      return 'k-error'
    case 'unknown':
      return 'k-unknown'
    // `message_queued`/`message_unqueued` are a queued message's own lifecycle (077): it waits,
    // then it is sent, cancelled or abandoned. Lifecycle rather than content — the CONTENT is the
    // `user_turn` it eventually becomes, or nothing at all if it never gets there.
    //
    // `user_command` (097) is lifecycle for the same reason: it is what a control DID, not what the
    // conversation said. It is dim here on purpose — you go looking for it, and when you are looking
    // for it this tab is where it is, because this tab filters nothing.
    // `conversation_reset` (199) is lifecycle HERE and content in the transcript, and that is not a
    // contradiction: this tab filters nothing, so its classes are about how loudly a raw frame is
    // drawn, while `transcript-mode.ts` decides what a reader is allowed to miss. A reset is quiet
    // in a stream that shows everything and unmissable in a view that shows some of it.
    case 'conversation_reset':
    case 'session':
    case 'turn':
    case 'status':
    case 'request_resolved':
    case 'message_queued':
    case 'message_unqueued':
    case 'user_command':
      return 'k-lifecycle'
    default:
      return ''
  }
}

/**
 * ⛔ **How an unmapped payload was CLASSIFIED, on the row — or absent for everything else** (211 §4).
 *
 * ⚑ **This tab is where a category can still be counted, and 211 is why that matters.** The
 * lifecycle toggle used to draw every recognized whisper in the conversation, so the live smoke
 * could read `reasoning`/`plan`/`activity` off `chatter-entry`'s own `data-category` and say the 049
 * split was working. 211 §4 stopped the conversation drawing them — correctly — and that would have
 * left the classification measurable nowhere: *"no plan chatter on screen"* and *"no plan chatter at
 * all"* would read the same. ⚠️ **Measure upstream of the filter, or the filter blinds the
 * instrument that justifies it.**
 *
 * A `data-` attribute bound to `undefined` is not rendered, so a row that is not an `unknown` simply
 * has no category — which is the honest shape: `session` and `turn` frames have no category, and
 * writing `''` on them would put an empty answer where there is no question.
 */
function categoryOf(event: TranscriptEvent): string | undefined {
  return event.type === 'unknown' ? event.category : undefined
}

const count = computed(() => messages.value.length)

/**
 * ⛔ **Whether what is on screen IS the session, or a window onto it** (237 §1).
 *
 * ⚠️ **Both halves, because they fail differently.** `hasOlder` is the release: the ledger holds
 * events before the first one drawn here. `atTail` is the reader having scrolled back far enough
 * that the newest events are no longer in this array at all — and that state is cheaper to reach,
 * freezes the list silently, and would otherwise look identical to a session that had gone quiet.
 *
 * ⛔ **It is the two EDGES, and it cannot see a hole in the middle.** A window that lost an event to
 * an ordinal gap still reports `true` here, and deliberately: a gap is a different fault with a
 * different owner — `SessionRecord.nextOrdinal` is what notices one, and `session-record.ts` says it
 * is *"reported, not hidden"*. Claiming this attribute covered it would be the wider lie.
 */
const whole = computed(() => !props.window.hasOlder && props.window.atTail)

/**
 * The sentence, which is now a report rather than a promise.
 *
 * ⚑ **The old one — *"Here you always see everything"* — was FALSE in exactly the state a reader
 * most needs it to be true**, and the count beside it made it worse: `messages.length` reads as a
 * total to anyone who has not read `transcript-window.ts`.
 */
const reach = computed(() => {
  if (whole.value) return 'This is the whole ledger — every event this session has recorded.'
  const parts: string[] = []
  if (props.window.hasOlder) {
    parts.push(
      `this is a WINDOW onto the ledger, beginning at ordinal ${props.window.from}` +
        (props.window.turnAligned ? '' : ' — cut mid-turn'),
    )
  }
  if (!props.window.atTail) {
    parts.push(
      props.window.behind > 0
        ? props.window.behind === 1
          ? '1 newer event has arrived and is not in this list'
          : `${props.window.behind} newer events have arrived and are not in this list`
        : 'it no longer holds the newest event',
    )
  }
  return `Not everything: ${parts.join(', and ')}.`
})
</script>

<template>
  <div class="event-stream" data-cy="event-stream">
    <p class="stream-note" :class="{ windowed: !whole }" data-cy="event-log-note">
      <strong>{{ count }} event{{ count === 1 ? '' : 's' }}</strong> — raw normalized
      <code>RuntimeEvent</code>s, unfiltered and in arrival order with the host's ordinal. This is
      not the lifecycle toggle: that one puts session starts and turn boundaries
      <em>in the conversation</em>. Nothing here is filtered out.
      <!-- ⛔ 237 §1: what is DRAWN and what is HELD are two facts, and this tab used to state only
           the first while promising the second. -->
      <span data-cy="event-log-reach">{{ reach }}</span>
    </p>
    <!--
      ⛔ **The completeness fact rides on the list itself** (237 §1). ⚠️ Anything that reads these
      rows — a person, or the live smoke concluding *"the model never called Bash"* — is reading one
      array, and whether that array is the whole ledger is a property OF THAT READ. On a sibling
      element it could describe a different moment; in main it would be a different process
      answering a different question. Here it cannot disagree with what it describes.
    -->
    <ol
      ref="el"
      class="stream-list"
      data-cy="event-log"
      :data-whole="whole ? 'true' : 'false'"
      :data-from="props.window.from"
      :data-has-older="props.window.hasOlder ? 'true' : 'false'"
      :data-at-tail="props.window.atTail ? 'true' : 'false'"
      :data-behind="props.window.behind"
      @scroll="onScroll"
    >
      <li
        v-for="message in messages"
        :key="message.ordinal"
        class="raw-event"
        :class="kindOf(message.event)"
        :data-type="message.event.type"
        :data-category="categoryOf(message.event)"
        :data-ordinal="message.ordinal"
      >
        <span class="rts">{{ clockTime(message.at) }}</span>
        <span class="rbody">
          <span class="rtype">{{ message.event.type }}</span>
          <span class="rdetail">{{ describeEvent(message.event) }}</span>
        </span>
      </li>
      <li v-if="messages.length === 0" class="empty">nothing yet</li>
    </ol>
  </div>
</template>

<style scoped>
/* The tab body scrolls, so this fills it and the list inside takes the overflow — the same shape
   the drawer's other panels have, minus the head the tab strip now provides. */
.event-stream {
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.stream-note {
  margin: 0;
  padding: var(--space-4) var(--space-7);
  border-bottom: 1px solid var(--line);
  color: var(--faint);
  font-size: var(--text-6xs);
  line-height: 1.5;
}

.stream-note strong {
  color: var(--muted);
}

/* A window is not an error, so it is not red — but it must not read like the ordinary case either,
   because the ordinary case is what a person assumes when nothing says otherwise (237 §1). */
.stream-note.windowed {
  border-bottom-color: var(--line-strong);
  color: var(--waiting-text-label);
}

.stream-note code {
  font-family: var(--font-mono);
}

.stream-list {
  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  scrollbar-color: var(--scrollbar-thumb) transparent;
  scrollbar-width: thin;
}

.raw-event {
  display: grid;
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--line);
  color: var(--mono-text-dim);
  font: var(--text-6xs) / 1.5 var(--font-mono);
  gap: var(--space-4);
  grid-template-columns: 46px minmax(0, 1fr);
}

.rbody {
  min-width: 0;
}

.rts {
  color: var(--faint);
}

.rtype {
  color: var(--mono-text);
}

.rdetail {
  display: block;
  overflow: hidden;
  color: var(--faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.raw-event.k-lifecycle .rtype {
  color: var(--faint);
}

.raw-event.k-perm .rtype {
  color: var(--waiting-text-label);
}

.raw-event.k-tool .rtype {
  color: var(--accent-text-soft);
}

.raw-event.k-error .rtype {
  color: var(--danger-text);
}

.raw-event.k-unknown .rtype {
  color: var(--neutral-glyph);
}

.empty {
  padding: var(--space-5) var(--space-6);
  color: var(--faint);
  font-size: var(--text-5xs);
}
</style>
