// ⚑ **636 · a conversation's waits as DATA, derived from `TASK_STATES`' own prefix** — see
// {@link everyFacetState}, which is the only reader here.
import { CONVERSATION_WAITS } from '../../../shared/tasks'
import {
  BEINGS,
  DOINGS,
  NEEDINGS,
  STANDINGS,
  standingOf,
  type AgentFacets,
  type Standing,
} from './agent-state'

/**
 * 🔴 **`384 §1.2` · the `status` decision, and what it costs.**
 *
 * `382 §9` called this *"the lossiest field in the map, and the one to settle before any geometry"*.
 * v2.3's view model carries ONE `status` string out of a flat twelve-word list. This product carries
 * `SessionStatus` (five members, in `@brobot2/shared`) crossed with three INDEPENDENT facets —
 * what an agent is DOING, what it IS, and what it NEEDS FROM YOU — which `035` split apart on
 * purpose and `378` warned against re-collapsing: *"do not use a single busy badge or broad amber
 * status for everything."*
 *
 * ## ⛔ The decision
 *
 * **The view model keeps the three facets. v2.3's `status` is a PROJECTION of them — computed at the
 * moment of drawing, stored nowhere — and it may never be the only thing on screen.**
 *
 * ⚑ **The product already had both halves and neither is new here.** `standingOf` is the projection
 * (nine words), and `AgentState` is the plate that keeps what the word drops. What 384 settles is
 * that the ARROW only ever points one way: facets → word. A `status` field on a snapshot, filled in
 * by the host and read by the renderer, would make the word the source and the facets a decoration,
 * and every surface downstream would inherit whatever that word could not say.
 *
 * ## 🔴 The cost, measured rather than asserted
 *
 * The PM's constraint for this decision was: **no state a person needs to act on may be lost**, and
 * in particular *"if a lossy projection loses amber, it is the wrong projection."*
 *
 * ⚑ **Amber survives.** Every facet state carrying a `permission` or a `question` projects to
 * `waiting` / amber, on both vocabularies — that is `standingOf`'s second branch and it outranks the
 * DOING deliberately.
 *
 * ⛔ **THREE states a person can act on do NOT survive v2.3's vocabulary, and they are the three
 * this product added BECAUSE a one-word surface was wrong.** {@link V23_HOLES}:
 *
 *  - `background`: no turn is driven here, but started work still runs and `BackgroundBar` provides Stop.
 *  - `scheduled`: no local process runs, but a schedule will wake the conversation later.
 *  - `elsewhere`: no work runs here and another conversation owes the next move; the work view and recipient conversation provide navigation.
 *
 * 🔴 **So by the constraint as it was written, the lossy projection is the wrong projection** — not
 * because of amber, which it keeps, but because `background` has a control and no word. ⚑ The answer
 * is not to widen the word: it is that the word is never alone. What a person acts on is carried by
 * the plate, the background bar and the schedule bar, and the badge is the label on top of them.
 *
 * ## ⚠️ A third loss, and it is the product's own, not v2.3's
 *
 * `being: 'silent'` — *"working, but nothing has arrived for the stall window — busy, rate-limited,
 * or stuck"* — takes `--waiting`, the amber, on the plate's underline. {@link standingOf} projects
 * it to `working`, which is blue. **That amber is already lost at every one-word surface in the
 * shipped app**, and v2.3 does not cause it. It is named here because a decision about the word
 * should not quietly inherit it: see {@link SILENT_IS_AMBER_ONLY_ON_THE_PLATE}.
 *
 * ## ⚑ Nothing imports this
 *
 * `384 §0` fences the commit: *"this dispatch may move geometry and may NOT settle a single binding
 * or a single sentence."* A decision is not a binding, so it is written as a typed, tested artefact
 * with no call site — the shape `382`'s map used for the same reason.
 */

/** v2.3's twelve-word status vocabulary, in the mock's own order. */
export const V23_STATES = [
  'ready',
  'in-flight',
  'waiting',
  'queued',
  'landed',
  'failed',
  'blocked',
  'refused',
  'finished',
  'record',
  'off',
  'unknown',
] as const
export type V23State = (typeof V23_STATES)[number]

/**
 * The colour each word takes in the mock, verbatim from its own `STATES` table.
 *
 * ⚠️ **Twelve words over seven colours** — three of them are red (`failed`, `blocked`, `refused`) and
 * two are green (`landed`, `finished`), so the vocabulary is already lossier than it looks at a
 * glance. `378`'s grammar names those seven: blue in flight, amber frozen waiting for a human,
 * violet queued, green landed, red failed or blocked, orange approvals off, grey ready.
 */
export const V23_COLOUR: Record<V23State, string> = {
  ready: 'grey',
  'in-flight': 'blue',
  waiting: 'amber',
  queued: 'violet',
  landed: 'green',
  failed: 'red',
  blocked: 'red',
  refused: 'red',
  finished: 'green',
  record: 'grey',
  off: 'orange',
  unknown: 'grey',
}

/**
 * ⛔ **The THREE product standings v2.3 has no word for**, and the reason the projection below
 * returns `null` for them rather than picking the nearest.
 *
 * ⚠️ **Every candidate is a lie in a different direction**, which is why there is no honest default:
 * `in-flight` claims the agent is taking a turn, `ready` claims nothing is happening, `queued`
 * claims it has not begun. `081`'s rule for a one-word surface is that it says the most important
 * TRUE thing; there is no true one available here.
 *
 * 🔴 **636 · the third, and the list said *two* until it arrived.** ⛔ `elsewhere` is the same
 * shape as the two beside it — a fact that is true WHILE the conversation is idle — and v2.3's
 * `waiting` is the nearest word and the worst one: it is *a person must act*, and the whole ground
 * for this standing is that nobody at this machine can move it (`621` §5.2).
 */
export const V23_HOLES: readonly Standing[] = ['background', 'scheduled', 'elsewhere']

/**
 * ⚑ **The `silent` amber, and where it survives.** Named as an export so a later dispatch that widens
 * the word cannot do it without meeting this: the plate draws `silent` as a dotted `--waiting`
 * underline, and every one-word surface in the app calls it `working`.
 */
export const SILENT_IS_AMBER_ONLY_ON_THE_PLATE = true

/**
 * The projection: three facets → one of v2.3's twelve words, or `null` where the design has no word.
 *
 * ⛔ **It goes through {@link standingOf} rather than reading the facets again.** A second derivation
 * of one fact is what `099` spent a dispatch removing — the rail said `idle` while the pane said
 * `working` about one session — so this is a rename of the product's answer, never a re-decision of
 * it. Adding a branch here that `standingOf` does not have is the defect this note exists to stop.
 */
export function v23StateOf(facets: AgentFacets): V23State | null {
  const standing = standingOf(facets)
  switch (standing) {
    case 'idle':
      return 'ready'
    case 'unknown':
      return 'unknown'
    case 'working':
      return 'in-flight'
    case 'waiting':
      return 'waiting'
    default:
      return null
  }
}

/**
 * ⛔ **The pairs of product standings that v2.3 cannot tell apart**, stated as data so the loss is
 * countable rather than argued. ⚑ **D-017b · none now**: the one pair there was — *not started* and
 * *idle* — went with the standing that said whether a process runs (`05` rule 5).
 */
export const COLLAPSED: readonly (readonly [Standing, Standing])[] = []

/**
 * Every facet combination this app can hold — the space the loss is measured over.
 *
 * ⛔ **636 · the sixth axis is {@link CONVERSATION_WAITS} and it is READ, never listed** — the
 * roster is derived from `TASK_STATES`' `waiting-on-` prefix (`609`), so a new wait joins this
 * enumeration in the edit that adds it. ⚑ **D-016 · commit 6 · less the one said on a piece
 * only** (*waiting on you*, plan ruling 9): no conversation can be in it, so no facet holds it.
 * ⚠️ **A literal `['waiting-on-a-worker', …]` here would be a second list** —
 * `a-loop-over-a-literal-variant-list-is-not-exhaustive`, which is the exact failure this function
 * exists to prevent for the five axes above it.
 */
export function everyFacetState(): AgentFacets[] {
  const doings = [undefined, ...DOINGS] as const
  const beings = [undefined, ...BEINGS] as const
  const needings = [undefined, ...NEEDINGS] as const
  const waits = [undefined, ...CONVERSATION_WAITS] as const
  const out: AgentFacets[] = []
  for (const doing of doings)
    for (const being of beings)
      for (const needing of needings)
        for (const detached of [false, true])
          for (const scheduled of [false, true])
            for (const waiting of waits)
              out.push({
                ...(doing ? { doing } : {}),
                ...(being ? { being } : {}),
                ...(needing ? { needing } : {}),
                ...(detached ? { detached } : {}),
                ...(scheduled ? { scheduled } : {}),
                ...(waiting ? { waiting } : {}),
              })
  return out
}

/** The product's nine words, for a reader comparing the two vocabularies side by side. */
export const PRODUCT_STANDINGS = STANDINGS
