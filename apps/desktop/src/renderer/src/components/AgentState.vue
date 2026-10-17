<script lang="ts">
import compactingAvatar from '../assets/agents/compacting.png'
import idleAvatar from '../assets/agents/idle.png'
import replyingAvatar from '../assets/agents/replying.png'
import thinkingAvatar from '../assets/agents/thinking.png'
import toolAvatar from '../assets/agents/tool.png'
import workingAvatar from '../assets/agents/working.png'
import type { Doing } from '../lib/agent-state'

/**
 * The six illustrations, resolved once for the whole app.
 *
 * ⚠️ **Module scope, not `<script setup>`.** Everything in a setup block runs on every mount, and
 * this component is mounted once per rail row, once per Open-tab row, once per sub-agent card and
 * — since `593` — once per Team card —
 * a fresh six-key object each time, wrapping the same six module constants. Found in review.
 */
const AVATAR: Record<Exclude<Doing, 'unknown'>, string> = {
  idle: idleAvatar,
  working: workingAvatar,
  thinking: thinkingAvatar,
  tool: toolAvatar,
  compacting: compactingAvatar,
  replying: replyingAvatar,
}
</script>

<script setup lang="ts">
import { computed, useId } from 'vue'
import {
  accessibleName,
  beingCondition,
  isDotOnly,
  NEEDING_GLYPH,
  NEEDING_TOKEN,
  NEEDING_WORD,
  NEEDS_YOU,
  platePx,
  needsMarkOf,
  priorityDotToken,
  standingOf,
  underlineFor,
  workLeftBehind,
  type AgentFacets,
  type Being,
  type Needing,
  type SizeName,
} from '../lib/agent-state'
import type { AgentState as OneState } from '../../../shared/agent-state'
import { clockTime } from '../../../shared/clock'
// ⚑ **645 · a TYPE only**, exactly as `lib/agent-state.ts` takes it — a conversation's waits are
// `TASK_STATES`' own `waiting-on-` family, less the one said on a piece only (D-016 · commit 6),
// and this component names none of them a second time.
// ⛔ `import type` and not a value import: a value out of `shared` costs the renderer a bundle it
// does not need (`a-value-import-from-shared-costs-the-renderer-135kb`), and this one erases.
import type { ConversationWait, HeldWork } from '../../../shared/tasks'

/**
 * One live agent, drawn (081/082).
 *
 * Render three independent, optional facets on a white plate: `doing` controls the avatar, `being` its underline and `needing` its corner badge. Keeping them separate lets an error and a pending permission appear together.
 *
 * ⚠️ **A sibling of `StateBadge.vue`, not a replacement.** That one draws a DOCUMENT — lifecycle,
 * condition, outcome. This one draws an agent, and the two look nothing alike on purpose: a row
 * should never suggest a document is thinking.
 *
 * Every rule worth asserting is in `lib/agent-state.ts` rather than in this template, because the
 * renderer tests here are SSR and a template full of `v-if` is exactly what SSR cannot check
 * properly (067 is still unbuilt). What is left here is markup.
 */
const props = defineProps<{
  /** Absent ⇒ `unknown`: a faceless mark, never one of the six. */
  doing?: Doing
  /** Absent ⇒ no underline is painted (the slot stays, so nothing reflows). */
  being?: Being
  /** Absent ⇒ no corner badge. */
  needing?: Needing
  /**
   * ⛔ **The fourth facet (250) — it reaches the accessible NAME and draws nothing.**
   *
   * ⚠️ **Declared because it was already being passed and was going nowhere.** Every caller spreads
   * the whole facets object (`v-bind="row.facets"`), so the moment `sessionFacets` began returning
   * `detached: true` this component started receiving it as a fallthrough attribute — landing on the
   * root element as a stray `detached="true"` and never reaching {@link accessibleName}. The
   * screen-reader sentence 250 added was a branch no call site could produce, which is `222` §4's
   * rule (*do not add a word nothing can produce*) broken by the fix for it. Found by an adversarial
   * pass over 250's own diff.
   *
   * ⛔ **It is deliberately absent from {@link priorityDotToken}.** A dot can say ONE thing, and the
   * facets that outrank it there — an open card, a terminal ending, the provider's liveness — are
   * present in every state that can also carry this: work reaches the level set only through a live
   * session, which always has a `being`. A branch for it would be a branch nothing can reach, which
   * is the same rule from the other side.
   */
  detached?: boolean
  /**
   * 🔴 **The fifth facet (258) — and it is the SAME defect 250 had to fix here, one facet along.**
   *
   * `sessionFacets` began returning `scheduled: true`, every caller spreads the whole object, and
   * without this declaration the value landed on the root element as a stray attribute and never
   * reached {@link accessibleName} — so the screen-reader sentence 258 added was a branch no call
   * site could produce. ⚑ Found by the sweep in `agent-state.render.test.ts`, which only reaches
   * this state because a SURVIVING mutation row said its axis was missing.
   *
   * ⛔ Absent from {@link priorityDotToken} for the reason {@link detached} is.
   */
  scheduled?: boolean
  /**
   * ⛔ **The sixth facet (636/645) — and it is 250's defect for the THIRD time, one facet along.**
   *
   * `636` added `waiting` to `AgentFacets`, taught {@link accessibleName} to say it, and did
   * not declare it here. Every caller spreads the whole facets object, so the value landed on the
   * root element as a stray `waiting="waiting-on-a-worker"` and never reached the sentence — which
   * makes the clause `636` wrote **a branch no call site could produce**, `222` §4's rule broken by
   * the fix for it exactly as {@link detached} records it being broken at `250` and
   * {@link scheduled} at `258`.
   *
   * ⚠️ **It was worse than the two above, and the difference is the instruments.** `250` and `258`
   * were each caught by a sweep; this one was caught by a person reading the file at `641`.
   * ⛔ **Not because the WORD was untested** — `three-surfaces-read-the-new-field.test.ts` pins
   * `accessibleName`'s sentence for every wait, and has since `636`. 🔴 **Because a pure-function
   * pin is not a surface**: both facet cross-products hard-coded their AXES, so a sixth facet
   * joined `AgentFacets` and no census widened, and the FUNCTION stayed green while the WIRING
   * never existed.
   *
   * ⚑ **The floor those files carry guards the MEMBERS of a vocabulary, never the SET OF AXES** —
   * so `645` gave both cross-products an axis registry exhaustive over `keyof AgentFacets`, which
   * refuses to compile when a seventh facet lands.
   *
   * ## ⛔ Deliberately absent from {@link priorityDotToken}, and this is the recorded reason
   *
   * ⚠️ **NOT {@link detached}'s reason, which does not hold here.** That one is outranked in every
   * state that can carry it. This is not: `waitSummonsAPerson` raises the `waiting` STANDING in
   * `standingOf` over a bare `idle` with no `being` and no `needing`, and the dot in that
   * state would answer `--ready`.
   *
   * ⚑ **The reason it is absent is {@link priorityDotToken}'s OWN rule, the half of it that is
   * about what a dot may leave out:** *"A dot can say exactly one thing, so it says the most
   * important one and the row's own text carries the word"* (`081` §4). ⛔ **No dot draws this
   * facet**: a plate large enough for a face marks a wait on another agent with the corner's
   * hourglass, and below that the only thing that shows a sighted person a wait is a STANDING WORD. 🔴 **A dot is therefore safe exactly where it
   * REPEATS a subject whose own row says that word, or where its plate is never handed one and the
   * wait the surface does know is said on the dot's own line.**
   *
   * ⛔ **`645` stated this ruling wrongly and `651` corrected it.** It said the forest's task line
   * *"draws `forest-says` beside the mark"*; it did not — `forest-says` was on the CONVERSATION row.
   * ⚑ **668 · the forest's task line has no dot at all now**: it sits on its holder's card, under the
   * holder's plate at `compact` and its STANDING in words — `standingOf`, whose precedence is what
   * places the wait. WorkingTogether's dots are a cast card's own `facets`, and no plate on the band is ever handed a
   * wait — ⚠️ but a task's own state CAN be one, and it is said by the line's status mark: its word on
   * `title` and `aria-label`, and to the eye the ○ — its word beside it on the current piece alone;
   * `654`'s tint for a person's wait went with the given-out lines, the only ones it could fire on
   * (PM ruling, 2026-10-01). That is `631`'s ruled line grammar, and the weakest place a dot stands
   * here.
   *
   * 🔴 **What would overturn this: a dot whose subject can be in a wait and whose word is nowhere.**
   * ⛔ Then the dot would fall back to a DOING colour while a person is blocked — the one thing
   * {@link priorityDotToken}'s docblock forbids — and the branch would be `waitSummonsAPerson` only,
   * at `needing`'s rank, mirroring `standingOf`. ⚠️ **The other two waits would still get nothing**:
   * `621` §5.2 ruled they ask nobody, `STANDING_TONE.elsewhere` is blank by argument, and amber on
   * them is a count he cannot clear.
   *
   * ⚑ **Pinned rather than asserted here** ([[a-line-no-mutation-can-kill-is-not-carrying-its-rule]]),
   * in three places:
   *
   * | half | held by |
   * |---|---|
   * | the dot ignores this facet | `agent-state.test.ts`, over the whole cross-product |
   * | **every dot in the app is DECLARED**, with what it repeats and where its word is | `a-dot-says-one-thing.render.test.ts` — the parser reads every `<AgentState>`, and a new dot is red until declared, a size it cannot read red until it is made readable (`651`) |
   * | each declaration is TRUE | the same file's §3: the forest's task line draws no plate and sits in the card whose word says its holder's standing (`668`); the band's plates are wait-free with every task wait planted, and its mark says the task's wait |
   *
   * ⚠️ **Reachability is deliberately not the ruling.** The tags that can receive this facet today
   * all draw at or above `PLATE_FLOOR` — the rail's open rows and the header at `compact`, the
   * drawer's bot at 77 — but that is one template edit from false, and a ruling resting on a call
   * site's spelling is a description ([[a-description-hardens-into-a-ruling-in-the-docblock-it-leaves]]).
   * ⛔ Named as a set, never counted: a number here would be the next stale one.
   */
  waiting?: ConversationWait
  /**
   * 🔴 **D-006 · the SEVENTH facet: where the work it holds stands** — see
   * {@link AgentFacets.work}. ⚑ It reaches the accessible name and nothing else, on
   * {@link waiting}'s ruling: the dot keeps its DOING colour (`STANDING_TONE.stalled` and
   * `.answered` are blank by argument), and the word is on the row beside it.
   */
  work?: HeldWork
  /**
   * 🔴 **F036 · the EIGHTH facet: who waits on an answer from it** — see {@link AgentFacets.owes}. ⚑ It
   * reaches the accessible name and nothing else, on {@link waiting}'s ruling.
   */
  owes?: readonly [string, ...string[]]
  /** The one state, where the caller holds it: it names who a wait is on, for the corner's mark. */
  state?: OneState
  /**
   * Absent ⇒ the dense default, decided by `platePx` rather than by a default here. One place
   * chooses it, and that place is the one the tests can reach.
   */
  size?: SizeName | number
  /** Drawn on top. Optional, scales with the plate, inherits the surface's ink. */
  title?: string
  /** Drawn below the line. Same rules. */
  subtitle?: string
  /**
   * ⚠️ **Given, never counted.** The header already ticks this off `liveness.since` once a second;
   * a second clock in here would be a second answer to the same question, which is the class of
   * defect 074 removed six places of. It reaches the accessible name and nothing else — the visible
   * number, when a caller wants one, is that caller's own `subtitle`.
   */
  silentSeconds?: number
  /** The accessible name's subject. Renames the agent; never re-hues it (mirrors StateBadge). */
  label?: string
}>()

const px = computed(() => platePx(props.size))
const dotOnly = computed(() => isDotOnly(px.value))

const avatar = computed(() =>
  props.doing && props.doing !== 'unknown' ? AVATAR[props.doing] : null,
)
const condition = computed(() => beingCondition(props.being))
/**
 * ⚑ **F023 · a mark for the work it left behind** — a clock for a scheduled wake-up, a terminal for
 * a command running in the background, read off the same two facets the standing word is and ranked
 * by the same one order (`workLeftBehind`). ⚠️ Visual only: the words are the row's and the
 * plate's, and the sentence a screen reader hears already names both, so the mark is hidden from it.
 */
const workLeft = computed(() => workLeftBehind(props))
const WORK_MARK = { background: '#i-terminal', scheduled: '#i-clock' } as const
const workMark = computed(() => (workLeft.value === null ? null : WORK_MARK[workLeft.value]))
const underline = computed(() => (props.being ? underlineFor(props.being) : null))
/** What the attention corner draws: see `needsMarkOf`. */
const needsMark = computed(() => needsMarkOf(facets.value))
/** The mark's own words, for its hover: the kind where it is known, else that it needs a person. */
const needsSays = computed(() =>
  props.needing ? NEEDING_WORD[props.needing] : needsMark.value ? NEEDS_YOU : undefined,
)
const dotToken = computed(() => priorityDotToken(facets.value))
const facets = computed<AgentFacets>(() => ({
  ...(props.doing ? { doing: props.doing } : {}),
  ...(props.being ? { being: props.being } : {}),
  ...(props.needing ? { needing: props.needing } : {}),
  // ⛔ **The one place these three props go** (250, 258, 645) — see their declarations for why
  // they go nowhere else, and {@link waiting}'s for the dot decision that keeps it off the line
  // above.
  ...(props.detached ? { detached: true } : {}),
  ...(props.scheduled ? { scheduled: true } : {}),
  ...(props.waiting !== undefined ? { waiting: props.waiting } : {}),
  ...(props.work !== undefined ? { work: props.work } : {}),
  ...(props.owes !== undefined ? { owes: props.owes } : {}),
}))
const ariaLabel = computed(() =>
  accessibleName({
    ...facets.value,
    ...(props.label !== undefined ? { label: props.label } : {}),
    ...(props.silentSeconds !== undefined ? { silentSeconds: props.silentSeconds } : {}),
  }),
)

/** "Ali", "Ali and Ada", "Ali, Ada and Bo". */
function namesWords(names: readonly string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
}

/**
 * An hourglass in the corner while the standing is waiting on another agent (`elsewhere`, ranked by
 * the one order, so it takes the corner exactly when the word under the plate says the wait). Its
 * description names who, from the one state when the caller holds it, and since when where the
 * host gave the wait's start.
 */
const waitSays = computed<string | null>(() => {
  if (standingOf(facets.value) !== 'elsewhere') return null
  const state = props.state
  if (state?.is === 'waiting-on-a-worker')
    return `Waiting on ${namesWords(state.on)}${since(state.since)}.`
  if (state?.is === 'waiting-on-an-answer') {
    return `Waiting on an answer from ${state.from}${since(state.since)}.`
  }
  return props.waiting === 'waiting-on-an-answer'
    ? 'Waiting on an answer from another agent.'
    : 'Waiting on another agent.'
})
/**
 * A speech bubble in the same corner while the standing is *owes an answer*: another agent asked
 * it something it hasn't answered. One corner, one mark: the one order picks it, as it picks the
 * word under the plate, so a plate that also waits on an answer wears the hourglass (that wait
 * ranks first) and one that also waits on a worker, or left work running, wears this.
 */
const owesSays = computed<string | null>(() => {
  if (standingOf(facets.value) !== 'owes') return null
  const state = props.state
  const to = state?.is === 'owes-an-answer' ? state.to : props.owes
  const began = state?.is === 'owes-an-answer' ? state.since : undefined
  return to === undefined ? null : `Owes an answer to ${namesWords(to)}${since(began)}.`
})
/** " since 10:42", on the Mac's clock, or nothing. */
function since(at: number | null | undefined): string {
  const time = at == null ? '' : clockTime(at)
  return time === '' ? '' : ` since ${time}`
}
const cornerSays = computed(() => waitSays.value ?? owesSays.value)
const cornerId = useId()
const cornerMark = computed(() =>
  waitSays.value !== null ? '#i-hourglass' : owesSays.value !== null ? '#i-chat' : workMark.value,
)
const cornerKind = computed(() =>
  waitSays.value !== null ? 'waiting' : owesSays.value !== null ? 'owes' : workLeft.value,
)
</script>

<template>
  <span
    class="agent-state"
    role="img"
    :aria-label="ariaLabel"
    :aria-describedby="!dotOnly && cornerSays ? cornerId : undefined"
    :style="{ '--sz': `${px}px` }"
    data-cy="agent-state"
    :data-doing="props.doing ?? 'unknown'"
    :data-being="props.being"
    :data-needing="props.needing"
    :data-size="px"
    :data-dot="dotOnly"
  >
    <!-- Below the floor a 420px illustration is mud, so it degrades to ONE dot in the single most
         important colour and the row's own text carries the word (081 §4). The dot is NOT inside
         the plate — there is no plate down here, so it takes the surrounding surface's tokens like
         every other mark drawn straight on the app. -->
    <span
      v-if="dotOnly"
      class="doing-dot"
      :class="{ 'needing-dot': needsMark }"
      :style="{ '--_c': `var(${dotToken})` }"
      :title="needsSays"
      data-cy="agent-dot"
    >
      <!-- A dot that needs a person carries the glyph too: its colour alone would not say it. -->
      <svg v-if="needsMark" class="g" viewBox="0 0 24 24" aria-hidden="true">
        <use :href="NEEDING_GLYPH[needsMark]" />
      </svg>
    </span>

    <template v-else>
      <span v-if="props.title" class="as-title" data-cy="agent-title">{{ props.title }}</span>

      <!-- `data-on-white` is the light island (tokens.css §14). It is on the PLATE and not on the
           root, so the badges sitting on white get the paper values while the underline below keeps
           the surrounding surface's. -->
      <span class="plate" data-on-white data-cy="agent-plate">
        <img v-if="avatar" class="avatar" :src="avatar" alt="" data-cy="agent-avatar" />
        <span v-else class="doing-unknown" data-cy="agent-unknown"></span>

        <!-- The attention corner. NEEDING owns it (081 collision A). -->
        <span
          v-if="needsMark"
          class="badge needing"
          :style="{ '--_c': `var(${NEEDING_TOKEN[needsMark]})` }"
          :title="needsSays"
          data-cy="agent-needing"
        >
          <svg class="g" viewBox="0 0 24 24"><use :href="NEEDING_GLYPH[needsMark]" /></svg>
        </span>

        <!-- ⚑ **F023** · the corner the other two leave free: what it left scheduled or running,
             the other agent it waits on, or the one it owes an answer. -->
        <span
          v-if="cornerMark"
          class="badge work-mark"
          :data-mark="cornerKind"
          :title="cornerSays ?? undefined"
          aria-hidden="true"
        >
          <svg class="g" viewBox="0 0 24 24"><use :href="cornerMark" /></svg>
        </span>
        <span v-if="cornerSays" :id="cornerId" hidden>{{ cornerSays }}</span>

        <!-- The opposite corner, so `errored + permission` draws both facts. -->
        <span
          v-if="condition"
          class="badge being-cond"
          :style="{ '--_c': `var(${condition.token})` }"
          data-cy="agent-condition"
        >
          <svg class="g" viewBox="0 0 24 24"><use :href="condition.glyph" /></svg>
        </span>
      </span>

      <!-- Always rendered, hidden when there is no BEING: a facet arriving must not make the row
           taller. -->
      <span
        class="underline"
        :class="{ dotted: underline?.dotted, pulse: underline?.pulse, none: !underline }"
        :style="underline ? { '--_u': `var(${underline.token})` } : undefined"
        data-cy="agent-underline"
      ></span>

      <span v-if="props.subtitle" class="as-sub" data-cy="agent-subtitle">{{
        props.subtitle
      }}</span>
    </template>
  </span>
</template>

<style scoped>
.agent-state {
  display: inline-flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  gap: calc(var(--sz) * 0.09);
}

/*
 * Use a circular plate so the round status badge has no square corner to clash with.
 */
.plate {
  position: relative;
  display: grid;
  width: var(--sz);
  height: var(--sz);
  flex: 0 0 auto;
  border: var(--border-width) solid var(--paper-line);
  border-radius: var(--radius-pill);
  /* The plate's own white, and the paper's own edge. Both are theme-invariant BY DESIGN: this is a
     piece of paper, and 010's paper looks the same in both modes. It is also why 081's two
     per-surface edge treatments collapsed into one — a hairline plus this shadow reads as a
     deliberate chip on near-black and as a card on paper, and the alternative was a second token
     for a difference nobody can see. */
  background: var(--badge-ink);
  /*
 * Keep the hairline to distinguish the plate on dark and paper surfaces. Repeated avatars use no shadow, avoiding visual noise across strips and task rows.
 */
  place-items: center;
}

.avatar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-pill);
  object-fit: contain;
  -webkit-user-drag: none;
}

/* No face, because we have no DOING to claim. */
.doing-unknown {
  width: 52%;
  height: 52%;
  border: 2px dashed var(--faint); /* raw: glyph stroke, drawn at its own width */
  border-radius: var(--radius-pill);
}

.badge {
  position: absolute;
  display: grid;
  width: calc(var(--sz) * 0.34);
  min-width: 11px;
  height: calc(var(--sz) * 0.34);
  min-height: 11px;
  border-radius: var(--radius-pill);
  /* The ring is the plate showing through, which is what separates the disc from the art under it. */
  background: var(--_c);
  box-shadow: 0 0 0 2px var(--badge-ink); /* raw: ring that separates a dot from what is under it */
  place-items: center;
  transform: translate(-50%, -50%);
}

.needing {
  top: 15%;
  left: 85%;
}

.being-cond {
  top: 85%;
  left: 85%;
}
/* ⚑ F023 · the top-left corner, in the accent: work the agent left behind, not a thing it needs. */
.work-mark {
  top: 15%;
  left: 15%;
  background: var(--accent);
}

/* Not `.icon` — that class is 16px and `currentColor`, and this glyph is neither: it is the plate's
   own white on a solid state disc, at whatever fraction of the plate the badge is. */
.g {
  width: 62%;
  height: 62%;
  fill: none;
  stroke: var(--badge-ink);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.6;
}

/* Outside the plate's footprint, so it never crosses the art. */
.underline {
  width: var(--sz);
  height: 3px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--_u);
}

.underline.dotted {
  background: repeating-linear-gradient(90deg, var(--_u) 0 4px, transparent 4px 8px);
}

.underline.pulse {
  animation: agent-underline 1.4s ease-in-out infinite;
}

/* `visibility`, not `display`, so the row's height is the same with and without a BEING. */
.underline.none {
  visibility: hidden;
}

.doing-dot {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border-radius: var(--radius-pill);
  background: var(--_c);
}

/* Large enough to hold its glyph, and still inside the smallest plate's box. */
.needing-dot {
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
}

.needing-dot .g {
  width: 72%;
  height: 72%;
}

.as-title {
  max-width: calc(var(--sz) * 2.6);
  overflow: hidden;
  margin-bottom: calc(var(--sz) * 0.05);
  color: currentcolor;
  font-size: max(var(--type-caption), calc(var(--sz) * 0.22));
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  line-height: 1.1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.as-sub {
  max-width: calc(var(--sz) * 2.8);
  overflow: hidden;
  margin-top: calc(var(--sz) * 0.06);
  color: currentcolor;
  font-size: max(var(--type-caption), calc(var(--sz) * 0.17));
  line-height: 1.2;
  opacity: 0.62;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes agent-underline {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

/* The only motion this component has, and the one setting nobody tests by hand. */
@media (prefers-reduced-motion: reduce) {
  .underline.pulse {
    animation: none;
  }
}
</style>
