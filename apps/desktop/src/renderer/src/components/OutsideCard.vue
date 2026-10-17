<script setup lang="ts">
/**
 * # 🔴 658 · The card a row sits in when it is not the conversation's own two voices
 *
 * Frame incoming messages from outside this conversation in a discreet card shifted right. `lib/from-outside.ts` classifies the rows; this component draws them, including incoming work messages.
 *
 * ## ⛔ Two properties, and they answer two different questions
 *
 * | | question | |
 * |---|---|---|
 * | the CARD | *is this row outside the two-party flow?* | every row from outside, every row about a task, and every call of this app's two messaging tools |
 * | `shifted` | *did these words come from a conversation that has not read this one?* | only rows from outside |
 * | `held` | *have these words been delivered yet?* | a held row — the edge goes dashed |
 *
 * ⚠️ **So a task that also came from outside is one card, shifted — never a card in a card** — and the
 * app's own notice about a task (a stall) is a card that is NOT shifted: nobody outside wrote it.
 *
 * ## ⚠️ Discreet, on purpose — and it reverses a ruling
 *
 * Until `658` the relayed row, the work report and the go-ahead shared the PERSON's frame on purpose:
 * `RelayedEntry`'s docblock called three app-delivered rows that sat differently *"three different
 * kinds of thing arriving"*. ⛔ **That frame was the false claim**: it drew another conversation's
 * agent at a participant's weight, in a participant's column. ⚑ So the card is QUIETER than a message —
 * a washed surface, a hairline, a small heading, no avatar — and the row's own component still draws its
 * words and facts inside it.
 *
 * ⛔ **The indent is measured in pixels by `an-incoming-message-says-whom-it-is-to.dom.test.ts`** — a
 * class name is not a layout.
 */
import { computed, ref, useId } from 'vue'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import { plainChatPreview } from '../lib/markdown'
import type { WorkIsWith } from '../lib/where-the-work-is'

const props = withDefaults(
  defineProps<{
    /** Whether these words came from another conversation; compact cards share one edge. */
    shifted: boolean
    exchange?: {
      from?: string
      to?: string
      kind?: string
      label?: string | null
      text: string
      at?: number
      state?: string | null
      stateDetail?: string
      where?: WorkIsWith | null
      question?: string
      /** The whole heading, for a card that is not words from one party to another. */
      heading?: string
      /** Start opened, for a card that holds something a person has to act on. */
      open?: boolean
    }
    /**
     * ⚑ **Whether the words are HELD, not yet delivered** — the edge goes dashed.
     *
     * ⛔ `077`'s grammar, kept on the card: a held row is *"visibly a different thing"* from the row
     * it becomes once sent — *"dashed rather than solid"*. ⚠️ The held row used to carry that on its
     * avatar; `658` removed the avatar from every card, so the card's own edge carries it now.
     */
    held?: boolean
  }>(),
  { held: false },
)
const emit = defineEmits<{ openConversation: [sessionId: string]; focusItem: [itemId: string] }>()
// A fold keeps its state while this card stays mounted.
const expanded = ref(props.exchange?.open === true)
const revealed = ref(expanded.value)
function toggle(): void {
  expanded.value = !expanded.value
  if (expanded.value) revealed.value = true
  if (props.exchange?.question) emit('focusItem', props.exchange.question)
}
const bodyId = useId()
const preview = computed(() => plainChatPreview(props.exchange?.text ?? ''))
const heading = computed(() => {
  const one = props.exchange
  if (one?.heading !== undefined) return one.heading
  return one
    ? `${one.from ?? ''} → ${one.to ?? ''} · ${one.kind ?? ''}${one.label ? ` · ${one.label}` : ''}`
    : ''
})
</script>

<template>
  <div class="outside-lane">
    <article
      class="outside"
      :class="{ shifted, held, compact: exchange }"
      data-cy="outside-card"
      :data-shifted="shifted"
      :data-held="held"
    >
      <header
        v-if="exchange"
        class="exchange-head"
        :class="{ explained: exchange.stateDetail }"
        data-cy="exchange-head"
      >
        <button
          class="exchange-toggle"
          type="button"
          data-cy="exchange-toggle"
          :aria-expanded="expanded"
          :aria-controls="bodyId"
          :aria-label="`${expanded ? 'Hide' : 'Show'} ${heading}`"
          :aria-description="exchange.stateDetail"
          @click="toggle"
        >
          <svg class="chev" :class="{ down: expanded }" aria-hidden="true">
            <use href="#i-chevron" />
          </svg>
          <strong class="exchange-heading" :title="heading">{{ heading }}</strong>
          <span class="exchange-preview" data-cy="exchange-preview">{{ preview }}</span>
        </button>
        <span
          v-if="exchange.state"
          class="exchange-state"
          :class="{ explained: exchange.stateDetail }"
          data-cy="exchange-state"
          :title="exchange.stateDetail ?? exchange.state ?? undefined"
          :aria-description="exchange.stateDetail"
          >{{ exchange.state }}</span
        >
        <span class="exchange-time" :title="fullTime(exchange.at)">{{
          clockTime(exchange.at)
        }}</span>
        <button
          v-if="exchange.question"
          class="exchange-link"
          type="button"
          data-cy="answer-question-link"
          @click="emit('focusItem', exchange.question)"
        >
          Go to question
        </button>
        <button
          v-if="exchange.where"
          class="exchange-link"
          type="button"
          data-cy="exchange-where"
          @click="emit('openConversation', exchange.where.conversation)"
        >
          {{ exchange.where.action }}
        </button>
      </header>
      <div
        v-show="!exchange || expanded"
        :id="bodyId"
        :class="{ 'exchange-body': exchange }"
        data-cy="exchange-body"
      >
        <slot v-if="!exchange || revealed" />
      </div>
    </article>
  </div>
</template>

<style scoped>
/* ⚑ **The lane is the conversation's own column** — the same measure and centring every message
   uses — so the card's shift is measured from where the person's and the agent's rows begin, not from
   the pane's edge. */
.outside-lane {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-10);
}

/* ⚑ **The card vocabulary, by its TOKENS** — `SessionWork`'s row and its quiet `.gap` box: a hairline,
   the medium radius, a washed surface. ⛔ Not by its class: a scoped class from another component
   matches nothing here. */
.outside {
  padding: var(--space-5) var(--space-6);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-md);
  background: var(--wash-1);
}

/*
 * Shift incoming cards past the avatar column (`--avatar` plus its gap) and slightly beyond the conversation's words so they read as arriving from outside.
 */
.outside.shifted {
  margin-left: calc(var(--avatar) + var(--space-5) + var(--space-10));
}

/* ⚑ **Held words are dashed** — `077`'s *"dashed rather than solid"*, on the card's edge. */
.outside.held {
  border-style: dashed;
}

/* Compact cards retain incoming provenance without an indent. */
.outside.compact.shifted {
  width: 100%;
  box-sizing: border-box;
  margin-left: 0;
}
.exchange-head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
}
.exchange-head.explained {
  flex-wrap: wrap;
  row-gap: var(--space-2);
}
.exchange-toggle {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  gap: var(--space-3);
  text-align: left;
  cursor: pointer;
}
.exchange-heading {
  overflow: hidden;
  max-width: 65%;
  flex: 0 1 auto;
  font-weight: var(--fw-bold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exchange-preview {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: var(--text-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  width: 9px;
  height: 9px;
  flex: none;
  transition: transform var(--dur-fast) var(--ease-out);
}
.chev.down {
  transform: rotate(90deg);
}
.exchange-state {
  overflow: hidden;
  max-width: 25%;
  color: var(--faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exchange-state.explained {
  max-width: 100%;
  flex-basis: 100%;
  flex-shrink: 0;
  order: 1;
  white-space: normal;
}

.exchange-time {
  flex: none;
  color: var(--faint);
  font: var(--type-caption) / 1 var(--font-mono);
}
.exchange-link {
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  cursor: pointer;
}
.exchange-toggle:hover,
.exchange-link:hover {
  color: var(--text-soft);
}
.exchange-body {
  padding-top: var(--space-4);
}
</style>
