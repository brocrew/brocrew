<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { CapabilityStatus } from '../../../shared/runtime-ipc'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import {
  COMPACT_IT,
  COMPACT_LINE,
  COMPACT_NOW,
  KEEP_EVERYTHING,
  compactHeading,
  compactionOffer,
  type CompactionFacts,
} from '../lib/compaction-offer'
import {
  barFraction,
  compactions,
  formatTokens,
  groupTokens,
  isRedline,
  percentText,
  reclaimed,
} from '../lib/context-meter'
import { ROLE_PROPERTIES } from '../lib/text-roles'
import type { TranscriptState } from '../lib/transcript'
import { isVisibleIn, type TranscriptMode } from '../lib/transcript-mode'

/**
 * **The context meter** — the Context popup's body (087, designed in 086).
 *
 * The card's context figure opens this complete reading in `ContextDialog`.
 *
 * A live gauge: how much of the model's context window this conversation is using, what the provider
 * actually said, every compaction so far, and — since `718` (`R60`) — a control that compacts it
 * after a confirm, or says why it cannot now. The
 * durable half of the feature is elsewhere — one boundary row per compaction, in the transcript,
 * where history is read (`CompactionEntry.vue`). They cross-reference: the rows here jump to the
 * boundaries, and the tally here IS the number of boundaries, because both read the same items.
 *
 * ⚠️ **Amber appears nowhere in this component, and that is the point rather than a detail.**
 * 063/080 built five attention traces so a waiting question can never hide; a full context window is
 * not a question, and if pressure lit the same channel the one signal that must never be ignored
 * would become the signal that is always on. Pressure is read as *how full the bar is*, plus a
 * `--danger` redline — a fuel-gauge reading, unmistakably not the amber summons. `context-tab.dom`
 * and `session-context.test.ts` assert that `--waiting` is absent and that no trace is raised.
 */
const props = defineProps<{
  /** The CONTROL projection (064) — the live meter, never the fold the reader is scrolled to. */
  state: TranscriptState
  /** The fold on screen, when it differs. Reachability of the jump targets only. */
  shown?: TranscriptState
  mode: TranscriptMode
  /** The provider's display name, for the source line. */
  provider: string
  /**
   * `requestCompaction` (039), or null when the capabilities read has not arrived or failed.
   *
   * ⚠️ **It is one of the two things the control needs, and never the only one** — see
   * `compaction-offer.ts`: `available` says the provider CAN be asked; {@link conversation} says
   * whether THIS conversation can be sent to now.
   */
  capability: CapabilityStatus | null
  /**
   * 🔴 **718 · `R60` — the conversation's own send facts**, as its pane reads them for the composer
   * ({@link CompactionFacts}). ⚠️ Optional, and absent means *no conversation behind this view*: a
   * drawer mounted alone offers nothing, and says so.
   */
  conversation?: CompactionFacts | null
}>()

const emit = defineEmits<{
  navigate: [itemId: string]
  /**
   * 🔴 **718 · `R60` — the person answered the confirm: send their `/compact`**, now or after the
   * running turn (`CompactionOffer.intent`). ⚑ The press is a MESSAGE (`713` §3), so it goes up to
   * the screen's send door and nowhere else.
   */
  compactNow: [intent: 'now' | 'queue']
}>()

const reading = computed(() => props.state.meter.reading)

/** The gauge's shape. Three, and `unknown` is one of them rather than the absence of the others. */
const shape = computed(() => reading.value.kind)
const limit = computed(() => isRedline(reading.value))
/**
 * The fill width — **`null` for a `tokens` reading, and that null is review finding 2.**
 *
 * `barFraction` returns 0 without a window, so this used to bind `width: 0.00%` inline on every
 * Claude session. An inline style beats a class rule, so it silently overrode
 * `.meter.m-tokens .gauge-fill { width: 100% }` and the magnitude bar was **invisible for half the
 * app** — the dashed unbounded edge floating with nothing before it. The CSS owns the tokens case;
 * this owns the proportional one, and they no longer fight.
 */
const fill = computed(() =>
  reading.value.kind === 'proportional'
    ? `${(barFraction(reading.value) * 100).toFixed(2)}%`
    : null,
)

/**
 * The big number.
 *
 * ⚠️ **An em-dash when there is no reading — never a zero.** A fresh conversation, a resumed one
 * that has not spoken and an imported read-only session all land here, and `0%` would be a
 * measurement we do not have, stated as one. This is 081's `unknown` vocabulary reused verbatim
 * rather than a second way of saying "we don't know".
 */
const figure = computed(() => {
  const value = reading.value
  if (value.kind === 'unknown') return '—'
  if (value.kind === 'tokens') return formatTokens(value.used)
  return percentText(value) ?? '—'
})

/** The unit beside the figure. `%` only where a percentage is real. */
const unit = computed(() => (shape.value === 'proportional' ? '%' : ''))

/** The caption at the right of the head — the exact numbers, spelled out, or what is missing. */
const caption = computed(() => {
  const value = reading.value
  if (value.kind === 'unknown') return null
  if (value.kind === 'tokens') return { top: 'window size', strong: 'not reported' }
  return { top: `${groupTokens(value.used)} of`, strong: `${groupTokens(value.window)} tokens` }
})

/**
 * Every compaction this session, in order — the same objects the transcript rows are built from.
 *
 * ⚠️ **Read off `state` (the control projection), NOT `shown`** — and review findings 15/16 are
 * right that the two can differ. When the reader pages back (054), `shown` is a window over old
 * history and may hold fewer boundaries than the session has. The tally stays the session's true
 * count on purpose: "3 compactions this session" is the fact worth knowing, and a number that
 * shrank as you scrolled would be a worse answer. What the divergence must never do is offer a jump
 * that goes nowhere — and it does not: `reachable` is computed from `shown`, so a row whose boundary
 * is off screen is disabled and says "off screen" rather than doing nothing when pressed.
 *
 * The related half — `TranscriptView`'s fade counting from the newest boundary IN `shown`, so a
 * reader paged back past every boundary sees no fade at all — is a real gap and is NOT fixed here;
 * it is named in the response, because closing it means giving that component the control
 * projection it deliberately does not have.
 */
const history = computed(() => compactions(props.state))
const latest = computed(() => history.value.at(-1) ?? null)
const reclaim = computed(() => (latest.value ? reclaimed(latest.value) : null))

/**
 * The one-line reading, and it is written from the SHAPE rather than from the provider.
 *
 * The `tokens` line is not an apology. Claude never reports a window at our pin, so this is the
 * ordinary Claude sentence, and it says what we know and what we refuse to guess.
 */
const line = computed(() => {
  const value = reading.value
  if (value.kind === 'unknown')
    return {
      icon: '#i-info',
      text: 'No context reading yet. The provider reports usage once the agent has spoken — a fresh, resumed, or imported session shows nothing until then.',
    }
  if (value.kind === 'tokens')
    return {
      icon: '#i-info',
      text: 'We know the token count but not the window size, so there is no percentage to draw. This is the number the provider gave, not a guessed proportion.',
    }
  if (limit.value)
    return {
      icon: '#i-alert',
      text: 'Near the limit. A compaction is likely soon — earlier turns will be summarized and a boundary will appear in the transcript.',
    }
  if (latest.value)
    return {
      icon: '#i-compact',
      text: 'Room to work. The last compaction is recorded in the transcript, where history is read.',
    }
  return { icon: '#i-check', text: 'Plenty of headroom. A compaction is unlikely this turn.' }
})

/**
 * The source line — **what the provider said, labelled**, rather than a tidy shared axis.
 *
 * ⚠️ `reports` shows the provider's own signal name (`thread/tokenUsage/updated`, `message_start`)
 * rather than 086's proposed "streamed vs on-result". That distinction was a guess about a wire
 * nobody had measured, and the measurement says BOTH providers stream: Codex on a notification,
 * Claude on the message frames. The signal name is strictly more informative and cannot go stale
 * against the adapter, because the adapter is what stamps it.
 */
const source = computed(() => {
  const meter = props.state.meter
  const rows: { k: string; v: string }[] = [{ k: 'provider', v: props.provider }]
  rows.push({ k: 'reports', v: meter.source ?? 'nothing yet' })
  rows.push({
    k: 'window',
    v: reading.value.kind === 'proportional' ? `${groupTokens(reading.value.window)} tok` : '—',
  })
  if (meter.at !== null) rows.push({ k: 'updated', v: clockTime(meter.at) })
  return rows
})

/**
 * Which history rows a click could actually reach — the idiom `SessionPanel.vue` established.
 *
 * A row whose boundary is not in the rendered fold has nowhere to scroll to, and a control that
 * silently does nothing when pressed is the thing this codebase keeps deleting. So it is disabled
 * and says why, rather than looking live.
 */
const reachable = computed(() => {
  const found = new Set<string>()
  for (const item of (props.shown ?? props.state).items) {
    if (item.kind === 'compaction' && isVisibleIn(props.mode, item)) found.add(item.id)
  }
  return found
})

/**
 * 🔴 **718 · `R60` — whether "Compact now…" is live, and the sentence under it** — one pure answer
 * (`compaction-offer.ts`), so the enablement and the words cannot describe two different states.
 *
 * ⛔ **Until `718` this was `why` alone and the button was hard-coded `disabled`**: *"still not
 * offered here: compaction is irreversible and this control has no confirm step yet."* ⚑ The
 * confirm is the door below; the sentence now says what the press does, or why it cannot now.
 */
const offer = computed(() => compactionOffer(props.capability, props.conversation ?? null))

/**
 * ⚑ **The confirm, open or shut** — the button OPENS the question and never acts; only
 * {@link compactIt} sends.
 *
 * ⚠️ **Shut whenever the offer is withdrawn under it** — the conversation ended, a card arrived, a
 * message was queued — so an answer given to a stale question sends nothing. ⛔ And a DIFFERENT
 * conversation cannot inherit it: `SessionPanel` shuts the popup when the conversation changes, so
 * it is opened again shut (W4.208; the Events tab's rule, kept).
 */
const confirming = ref(false)
// ⚑ **Shut whenever what the answer would DO changes under it** — the offer withdrawn (its intent
// reads `null`), or a question asked as *now* on an idle conversation that would be answered with a
// compaction queued behind a turn that started while the door was open (`718`'s review). ⛔ The
// person is asked again, in the words for what it will do. One watch: withdrawal is a change of
// intent too, and a second watch for it alone measured as redundant (`718`'s second round).
watch(
  () => (offer.value.offered ? offer.value.intent : null),
  (intent, before) => {
    if (intent !== before) confirming.value = false
  },
)

/** The question the door asks — {@link compactHeading}, for the press the offer would make now. */
const heading = computed(() => (offer.value.offered ? compactHeading(offer.value.intent) : ''))

/** ⚑ The door's element, so a press can bring it on screen. */
const theDoor = ref<HTMLElement | null>(null)

/**
 * ⚑ **The press opens the question, and brings it on screen** — the foot is the last thing on a tab
 * whose history can fill the drawer, so on a long one the question could open below the fold and
 * the press would look like it did nothing (`106`: a control must visibly act).
 */
function press(): void {
  if (!offer.value.offered) return
  confirming.value = true
  void nextTick(() => theDoor.value?.scrollIntoView({ block: 'nearest' }))
}

function compactIt(): void {
  const now = offer.value
  // ⛔ **Read BEFORE the door is shut**, `EndingGate.answer`'s rule: the answer reports the state the
  // person was in, and an answer with no open question — or a withdrawn offer — sends nothing.
  const open = confirming.value
  confirming.value = false
  if (open && now.offered) emit('compactNow', now.intent)
}
</script>

<template>
  <div class="session-context" :style="ROLE_PROPERTIES" data-cy="session-context">
    <!-- 🔴 **529 · the note leads with the consequence, because the tab does** (`HO-050` §1.3).
         ⛔ It opened *"How much of the model's context window this conversation is using"* — the
         measurement, which is the framing the PO refused the NAME for. ⚠️ A tab called `Dropped`
         over a sentence about window arithmetic is half a rename: the reader is told the word
         means one thing by the strip and another by the first line under it. -->
    <p class="ctx-note">
      When this conversation runs out of room the provider drops earlier turns and summarises them,
      and the agent loses the detail. The gauge is how close it is to the next one; the
      <b>compaction boundary</b> that records each one lives in the transcript, where history is
      read.
      <template v-if="latest">
        Last compaction:
        <b data-cy="context-last-compaction">{{ clockTime(latest.at) }}</b> — see the transcript.
      </template>
    </p>

    <div class="meter" :class="`m-${shape}`" :data-shape="shape" :data-limit="limit">
      <div class="meter-head">
        <span class="meter-figure" data-cy="context-figure"
          >{{ figure }}<span v-if="unit" class="u">{{ unit }}</span></span
        >
        <span v-if="caption" class="meter-caption" data-cy="context-caption"
          >{{ caption.top }} <b>{{ caption.strong }}</b></span
        >
        <span v-else class="meter-caption">no reading yet</span>
      </div>

      <div class="gauge">
        <div class="gauge-track">
          <!-- No fill at all when there is nothing to fill it from. A zero-width bar and a dashed
               empty ring are different statements, and only the second one is true. -->
          <div
            v-if="shape !== 'unknown'"
            class="gauge-fill"
            data-cy="context-fill"
            :style="fill ? { width: fill } : undefined"
          ></div>
          <!-- The tokens-only cap: the bar fades open at the right and ends in a dashed edge. There
               is no denominator, so there is no end — and the drawing says so. -->
          <div v-if="shape === 'tokens'" class="gauge-open"></div>
        </div>
        <div class="gauge-scale">
          <span>0</span>
          <span v-if="reading.kind === 'proportional'">{{ formatTokens(reading.window) }}</span>
          <span v-else-if="shape === 'tokens'" class="open">? · unbounded</span>
          <span v-else>window</span>
        </div>
      </div>

      <p class="meter-read" data-cy="context-reading-line">
        <svg class="icon"><use :href="line.icon" /></svg>
        <span>{{ line.text }}</span>
      </p>

      <!-- Green because it is the good thing that just happened: headroom came back. Keyed off the
           newest boundary's own numbers, so it exists only where the provider gave both ends —
           never for Codex, which gives neither. -->
      <p v-if="reclaim !== null" class="reclaimed" data-cy="context-reclaimed">
        <svg class="icon"><use href="#i-check" /></svg>
        <!-- The time is a clause, not a suffix: `clockTime(undefined)` is an empty string, so an
             untimed compaction used to render "…reclaimed at " with nothing after it (finding 22). -->
        ≈{{ formatTokens(reclaim) }} reclaimed<template v-if="latest?.at !== undefined">
          at {{ clockTime(latest.at) }}</template
        >
      </p>
    </div>

    <div class="ctx-source" data-cy="context-source">
      <div v-for="row in source" :key="row.k" class="row">
        <span class="k">{{ row.k }}</span>
        <span class="v">{{ row.v }}</span>
      </div>
    </div>

    <div class="ctx-hist">
      <div class="h">
        Compactions
        <!-- The tally and the rows are the same array, and the rows and the transcript boundaries
             are the same items. There is no second count to drift. -->
        <span class="tally" data-cy="context-tally">{{ history.length }}</span>
      </div>
      <button
        v-for="entry in history"
        :key="entry.id"
        type="button"
        class="hist-row"
        :data-cy="`context-compaction-${entry.id}`"
        :disabled="!reachable.has(entry.id)"
        :title="
          reachable.has(entry.id)
            ? 'Jump to it in the transcript'
            : 'Not in the part of the conversation on screen'
        "
        @click="emit('navigate', entry.id)"
      >
        <svg class="icon"><use href="#i-compact" /></svg>
        <span class="when" :title="fullTime(entry.at)">{{ clockTime(entry.at) }}</span>
        <span v-if="entry.before !== undefined && entry.after !== undefined" class="amt">
          ≈{{ formatTokens(entry.before) }} → {{ formatTokens(entry.after) }}
        </span>
        <!-- No magnitude is a real outcome, not a blank to be filled. -->
        <span v-else class="amt">no size reported</span>
        <span class="jump">
          {{ reachable.has(entry.id) ? 'jump to it' : 'off screen' }}
          <svg v-if="reachable.has(entry.id)" class="icon arrow"><use href="#i-arrow" /></svg>
        </span>
      </button>
      <p v-if="history.length === 0" class="none">None yet this session.</p>
    </div>

    <div class="ctx-defer">
      <!--
        🔴 **718 · `R60` — live, after a confirm, on both providers.** ⛔ It was hard-coded
        `disabled` from 087 until the two things it waited on were both true: the asymmetry between
        the providers resolved (`713`: both declare `available`, each through the person's own
        `/compact`) AND a confirm, because there is no undo. ⚑ The confirm is the door below, and
        `compaction-offer.ts` is the gate in front of it — the capability AND this conversation's
        own send facts, never the capability alone.
      -->
      <button
        class="act"
        type="button"
        :disabled="!offer.offered"
        :aria-expanded="confirming"
        data-cy="context-compact-now"
        @click="press"
      >
        <svg class="icon"><use href="#i-compact" /></svg>
        {{ COMPACT_NOW }}
      </button>
      <!-- ⚑ **The question, under the press that asked it** — `SessionHeader`'s ending door, one
           tab over. ⛔ Never amber: this tab's rule is that pressure is not the attention channel,
           and a confirm is not a summons. -->
      <div
        v-if="confirming && offer.offered"
        ref="theDoor"
        class="compact-door"
        role="group"
        :aria-label="heading"
        data-cy="compact-door"
      >
        <p class="door-copy">
          <strong data-cy="compact-heading">{{ heading }}</strong>
          <small data-cy="compact-line">{{ COMPACT_LINE }}</small>
        </p>
        <div class="door-acts">
          <button
            type="button"
            class="door-keep"
            data-cy="compact-keep"
            @click="confirming = false"
          >
            {{ KEEP_EVERYTHING }}
          </button>
          <button type="button" class="door-compact" data-cy="compact-it" @click="compactIt">
            {{ COMPACT_IT }}
          </button>
        </div>
      </div>
      <p class="why" data-cy="context-compact-why">
        <svg class="icon"><use href="#i-info" /></svg>
        <span
          ><b v-if="!offer.offered">{{ offer.lead }}</b> {{ offer.why }}</span
        >
      </p>
    </div>
  </div>
</template>

<style scoped>
/* 🔴 **529 · every size in this stylesheet names a ROLE** (`lib/text-roles.ts`), and the one that
   does not is `.meter-figure` — see its rule. ⛔ Nothing in `tokens.css` moved; what moved is
   which token the prose takes. `525` measured this tab's explanatory and source prose at 8.5/8 px
   against a scale whose §9 reserves under 9 px for micro-labels and badges.

   ⚑ **`--ctx-line` is `526`'s lever, applied to the two places this tab repeats a row.** A row
   whose line box is a fixed LENGTH costs the same whatever size the text inside it is — 12 px,
   which is `768/64` and therefore lands exactly on a layout unit — so the source rows and the
   compaction rows did not grow when their text did. */
.session-context {
  /* Rounded to a whole pixel, so a repeated row's height is exact at any type size. */
  --ctx-line: round(nearest, calc(var(--leading-tight) * var(--type-caption)), 1px);

  display: flex;
  min-height: 0;
  flex-direction: column;
}

.ctx-note {
  margin: 0;
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: var(--leading-relaxed);
}

.ctx-note b {
  color: var(--text-soft);
  font-weight: var(--fw-semibold);
}

.meter {
  padding: var(--space-8) var(--space-7) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
}

.meter-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
}

/* The primary quantity stays larger than prose, using the shared display role.
 * drawer-tab-roles.ts retains its existing off-scale roster entry for Hana to review. */
.meter-figure {
  color: var(--text);
  font-size: var(--type-display);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-tight);
  line-height: 1;
}

.meter-figure .u {
  margin-left: var(--space-1);
  color: var(--muted);
  font-size: var(--role-label);
  font-weight: var(--fw-semibold);
}

.meter-caption {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--role-value);
  line-height: var(--leading-tight);
  text-align: right;
}

.meter-caption b {
  color: var(--text-soft);
}

.gauge {
  margin-top: 13px;
}

.gauge-track {
  position: relative;
  overflow: hidden;
  height: 10px;
  /* `--wash-3`, NOT `--wash-4`: 086 caught that `--wash-4` is never redeclared in the light scope,
     so a `--wash-4` track inherits the dark near-transparent white and vanishes on paper. */
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--wash-3);
}

.gauge-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  border-radius: var(--radius-pill);
  background: var(--accent);
  transition: width var(--dur-medium) var(--ease-out);
}

/* Nothing pulses and nothing loops. The only motion in this feature is the fill changing width, and
   a reader who has asked for less of it gets a number that simply updates. */
@media (prefers-reduced-motion: reduce) {
  .gauge-fill {
    transition: none;
  }
}

/* UNKNOWN — 081's vocabulary, reused verbatim: a dashed `--faint` ring and no fill. */
.meter.m-unknown .gauge-track {
  border: 1.5px dashed var(--faint); /* raw: glyph stroke, drawn at its own width */
  background: transparent;
}

.meter.m-unknown .meter-figure {
  color: var(--faint);
  font-size: var(--type-title);
}

/* TOKENS-ONLY — a magnitude, not a proportion. The bar runs the whole track and fades out at the
   right, capped with a dashed edge: there is no denominator, so there is no end to draw. */
.meter.m-tokens .gauge-fill {
  width: 100%;
  border-radius: var(--radius-pill) 0 0 var(--radius-pill);
  background: linear-gradient(90deg, var(--accent) 0 62%, var(--accent-alpha-22) 100%);
}

.gauge-open {
  position: absolute;
  top: -2px;
  right: 0;
  bottom: -2px;
  width: 0;
  border-right: 1.5px dashed var(--faint); /* raw: glyph stroke, drawn at its own width */
}

/* REDLINE — `--danger`, and this is the only red in the feature. Red is a fuel-gauge reading; amber
   is the attention channel's and appears nowhere here. */
.meter[data-limit='true'] .gauge-fill {
  background: var(--danger);
}

.meter[data-limit='true'] .meter-figure {
  color: var(--danger-text-pale);
}

.meter[data-limit='true'] .meter-read {
  color: var(--danger-text);
}

.meter[data-limit='true'] .meter-read .icon {
  color: var(--danger);
}

.gauge-scale {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-3);
  color: var(--faint);
  font-family: var(--font-mono);
  /* `meta` — the axis is ABOUT the gauge rather than in it, the same role the clock wears. */
  font-size: var(--role-meta);
}

.meter-read {
  display: flex;
  align-items: flex-start;
  margin: var(--space-5) 0 0;
  color: var(--muted);
  font-size: var(--role-prose);
  line-height: var(--leading-relaxed);
  gap: var(--space-3);
}

.meter-read .icon {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--muted);
}

.reclaimed {
  display: inline-flex;
  align-items: center;
  margin: var(--space-5) 0 0;
  padding: var(--space-2) var(--space-4);
  border: var(--border-width) solid var(--success-border);
  border-radius: var(--radius-sm);
  background: var(--success-bg);
  color: var(--success-text);
  font-size: var(--role-value);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
}

.reclaimed .icon {
  width: 12px;
  height: 12px;
  color: var(--success);
}

.ctx-source {
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
  color: var(--faint);
  /* ⚑ A LENGTH, so four rows cost the same after their values went up a step. */
  line-height: var(--ctx-line);
}

.ctx-source .row {
  display: flex;
  gap: var(--space-4);
}

.ctx-source .k {
  min-width: 66px;
  color: var(--muted);
  /* `field` — the name of a field, which is what this column is. */
  font-size: var(--role-field);
}

.ctx-source .v {
  min-width: 0;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--role-value);
  overflow-wrap: anywhere;
}

.ctx-hist {
  padding: var(--space-5) var(--space-7);
  border-bottom: var(--border-width) solid var(--line);
}

.ctx-hist .h {
  display: flex;
  align-items: center;
  color: var(--muted);
  font-size: var(--role-field);
  font-weight: var(--fw-bold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.ctx-hist .tally {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--role-value);
  letter-spacing: 0;
  text-transform: none;
}

/* ⚑ **`526`'s lever.** The line box is a LENGTH, so a compaction row costs what it costs whatever
   size the text on it is — which is what let the jump affordance go up to `label` without the
   history getting taller. */
.hist-row {
  display: flex;
  width: 100%;
  align-items: center;
  line-height: var(--ctx-line);
  margin-top: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--border-width) solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--wash-1);
  color: var(--text-soft);
  gap: var(--space-4);
  text-align: left;
}

.hist-row:hover:not(:disabled) {
  border-color: var(--accent-border);
  background: var(--wash-5);
}

.hist-row:disabled {
  color: var(--faint);
  cursor: default;
}

.hist-row .icon {
  width: 13px;
  height: 13px;
  color: var(--muted);
}

.hist-row .when {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--role-meta);
}

.hist-row .amt {
  color: var(--faint);
  font-size: var(--role-value);
}

.hist-row .jump {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  color: var(--accent-text-soft);
  font-size: var(--role-label);
  font-weight: var(--fw-bold);
  gap: var(--space-2);
  white-space: nowrap;
}

.hist-row:disabled .jump {
  color: var(--faint);
}

.hist-row .jump .arrow {
  width: 11px;
  height: 11px;
  color: var(--accent);
}

.ctx-hist .none {
  margin: var(--space-3) 0 0;
  color: var(--faint);
  font-size: var(--role-prose);
}

.ctx-defer {
  padding: var(--space-6) var(--space-7);
}

.act {
  display: flex;
  width: 100%;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--text-soft);
  cursor: pointer;
  font-size: var(--role-label);
  font-weight: var(--fw-semibold);
  gap: var(--space-3);
}

.act:hover:not(:disabled) {
  border-color: var(--accent-border);
  background: var(--wash-5);
}

/* ⚑ **The look it had as a deferred control from 087 to 718** — dashed, faint, not-allowed — kept
   for the states in which it still cannot act (`compaction-offer.ts`). */
.act:disabled {
  border-style: dashed;
  background: var(--wash-1);
  color: var(--faint);
  cursor: not-allowed;
}

/* 🔴 **718 · the confirm** — in this tab's neutral register rather than a danger one: red here is
   the redline's, and a confirm is not a reading. */
.compact-door {
  margin-top: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
}

.door-copy {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: var(--space-1);
}

.door-copy strong {
  color: var(--text);
  font-size: var(--role-label);
  font-weight: var(--fw-semibold);
}

.door-copy small {
  color: var(--muted);
  font-size: var(--role-prose);
  line-height: var(--leading-relaxed);
}

.door-acts {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
  gap: var(--space-3);
}

.door-acts button {
  height: 26px;
  padding: 0 var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-1);
  color: var(--muted);
  cursor: pointer;
  font-size: var(--role-label);
  font-weight: var(--fw-semibold);
}

.door-acts .door-keep:hover {
  background: var(--wash-5);
  color: var(--text-soft);
}

/* ⛔ **The two answers must not look alike** — `SessionHeader`'s measured lesson (*a confirmation
   whose two answers look the same has stopped asking anything*). ⚑ The Send button's own fill,
   because the answer IS a send: the person's `/compact`, through the composer's door. */
.door-acts .door-compact {
  border-color: var(--accent);
  background: var(--accent-solid-bg);
  color: var(--accent-ink);
}

.act .icon {
  width: 13px;
  height: 13px;
}

.why {
  display: flex;
  margin: var(--space-4) 0 0;
  color: var(--faint);
  font-size: var(--role-prose);
  line-height: var(--leading-relaxed);
  gap: var(--space-3);
}

.why .icon {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  margin-top: 1px;
}

.why b {
  color: var(--muted);
  font-weight: var(--fw-semibold);
}
</style>
