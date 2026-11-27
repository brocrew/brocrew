import { computed, type ComputedRef } from 'vue'
import type { AgentState } from '../../../shared/agent-state-contracts'
import { scheduleHeld, somethingRunning } from '../../../shared/agent-state'
import {
  activityLine,
  facetsOfState,
  forAPerson,
  needingFor,
  parkedOnAnotherAnswer,
  sessionFacets,
  stateForRecord,
  facetsForRecord,
  type SessionFacetInput,
} from '../lib/agent-state'
import { whoItOwesIn } from '../lib/conversation-waits'
import {
  lastReportAt,
  turnsTakenWithoutThisWindow,
  whoIsIn,
  type SessionRecord,
} from '../lib/session-record'
import type { SessionPanel } from '../lib/session-panel'
import { providerLimitDisplay } from '../lib/provider-limit-status'
import { useMinuteClock } from './useMinuteClock'
import { useStillThinking } from '../lib/still-thinking'
import type { ConversationPaneProps } from '../lib/conversation-pane-props'

/**
 * Who this conversation is and the one state its header, plate and pill draw (moved out of
 * `ConversationPane.vue` unchanged).
 */
export function usePaneAgentState(
  props: Pick<
    ConversationPaneProps,
    'heldWork' | 'identities' | 'launching' | 'listedState' | 'providerBlock' | 'record' | 'waiting'
  >,
  control: ComputedRef<SessionRecord['control']>,
  panel: ComputedRef<SessionPanel>,
) {
  /**
   * All speaker labels use the recorded agent identity. Until it is known, say Assistant.
   * The header names the provider separately.
   */
  const who = computed(() => ownAgent.value ?? 'Assistant')

  /**
   * 🔴 **667 · this conversation's own agent by NAME, or `null`** — what a card puts on its own side of
   * *"Ada to BroBot"*, and what {@link who} is derived FROM, so the card and the agent's replies
   * cannot name one agent two ways (`658`).
   *
   * ⚠️ **`null` is the record with no `meta`** — {@link who} answers it *Assistant*, which is a word
   * for the absence and not a name, so a card is handed the absence and says *this conversation*.
   *
   * ## ⛔ Asked in ONE spelling — `658`'s G5, both halves of a heading alike
   *
   * ⚠️ **`meta.profileId` is `provider_session.profile_id`, the DIRECTORY spelling** — whatever case a
   * person typed at launch — and {@link agentName} folds its lookup key but NOT its fallback (`610`),
   * while every name on the OTHER half of a card is canonical. So an identity nobody has named read
   * *"dev to Dev"* on one card. `667` folded it here first, and in the rail, the drawer's plate and
   * the closed-thread list, with a renderer `oneSpelling`.
   * ⚑ **678 · `agentName` folds its fallback itself since `671`** (`667` G5a, handed back and closed),
   * so the four renderer folds were a second fold of an already-folded name and are gone — ⛔ one
   * owner for the spelling, in `shared/`, that a fifth caller cannot forget.
   */
  const ownAgent = computed((): string | null => {
    const meta = props.record.meta
    if (!meta) return null
    // ⚑ **D-017b · {@link whoIsIn}** — a conversation this app ran as nobody is its provider's, never
    // BroBot's.
    return whoIsIn(meta, props.identities ?? null)
  })

  /**
   * Whether this conversation is waiting for a go-ahead (060) — read from the session, never from
   * anything this component decides. `?? false` covers the frames before the host has described the
   * session: a bar that flickered on during opening would be offering to release a plan that does
   * not exist yet.
   */
  const needsGoAhead = computed(() => props.record.meta?.planNeedsGoAhead ?? false)

  /**
   * ⚑ **D-017 · R19 — the cards on the panel a PERSON owes an answer to**: all but those routed to
   * another conversation, which that one answers — the panel still lists them, and a person may still
   * answer them here.
   */
  const cardsForAPerson = computed(() =>
    forAPerson(
      { permissions: panel.value.permissions.length, questions: panel.value.questions.length },
      control.value.routedAway,
    ),
  )

  /**
   * The agent, as the header's plate draws it (082).
   *
   * Built HERE because this is the only place that holds all three sources at once — the control
   * projection for what it is doing, the session's liveness for what it is, and the panel this
   * component already computed for what it needs. The header is handed the answer rather than half of
   * it plus a guess.
   *
   * ⚠️ **The NEEDING badge and the drawer's waiting BADGE are counted from different things, and that
   * is deliberate.** The count is `panel.waiting` — permissions and questions, the two that block —
   * and it is what 079 §5's attention guarantee is written about. `plan` is in here as well, because
   * a plan waiting for a go-ahead is genuinely waiting on you; it blocks nothing, so it must not
   * inflate a count that means "frozen", but a badge that shows it is more information, not less.
   */
  const facetInput = computed<SessionFacetInput>(() => ({
    phase: props.record.phase,
    status: control.value.status,
    activity: control.value.activity,
    streaming: control.value.streamingId !== null,
    liveness: props.record.meta?.liveness.state ?? null,
    // `needingFor` returns undefined when nothing waits, and `sessionFacets` already drops an
    // undefined `needing` — so passing it straight through is the same object with less machinery.
    // ⚑ **D-017 · R19 — {@link cardsForAPerson}**, never the cards routed to another conversation.
    needing: needingFor({
      ...cardsForAPerson.value,
      planNeedsGoAhead: needsGoAhead.value,
    }),
    // ⚑ **D-017 · R19 — and a turn parked only on those is waiting on another conversation's answer**.
    parkedOnAnotherAnswer: parkedOnAnotherAnswer(cardsForAPerson.value, control.value.routedAway),
    // ⛔ **The fourth facet, from the SAME `control` every field above is read from** (250). The
    // registry this asks is the one {@link BackgroundBar} renders a few lines down in this very
    // template — so the pill above the conversation and the list above the composer are two readings
    // of one object rather than two opinions, which is the whole of 099.
    detached: somethingRunning(control.value.background),
    // Read scheduled state from the same `control.schedule` registry that {@link ScheduleBar} renders. Background work alone cannot identify a conversation that has a cron but nothing currently running.
    scheduled: scheduleHeld(control.value.schedule),
    // 🔴 **The SIXTH facet, and the only one on this list that is NOT read off `control`** (636) —
    // see {@link ConversationPane.waiting}. ⛔ It is what makes the header pill, the plate under the
    // avatar and the screen-reader sentence say something other than *idle* about a conversation
    // whose work is out with another agent — `HO-095` §5.1's three surfaces, two of which are drawn
    // from this one object.
    //
    // ⚠️ **`?? undefined`, because `null` is not a value this facet has.** The prop's `null` is
    // *nobody has looked*; the facet's absence is the same thing, and {@link sessionFacets} drops
    // an absent key rather than carrying it.
    waiting: props.waiting ?? undefined,
    // 🔴 **D-006 · the SEVENTH facet**, beside the sixth and on its `?? undefined` rule — so the pill
    // and the plate say *answered* or *not being worked on* about an idle agent's work.
    work: props.heldWork ?? undefined,
    // ⚑ **F036 · the EIGHTH facet** — another agent waits on its answer, as the host's state of it says.
    owes: whoItOwesIn(props.listedState),
  }))

  /**
   * ⚑ **D-017b · a view drawn from its ledger draws the host's state** ({@link listedState}), as its
   * row in the one list does: its own fold is a page, not the present, so it cannot tell a
   * conversation another window is working in from one nothing runs — and the plate saying *idle*
   * over a row saying *active* was one screen saying two things.
   */
  const hostSays = computed((): AgentState | null =>
    props.record.phase === 'recorded' && props.record.agentState === undefined
      ? (props.listedState ?? null)
      : null,
  )

  const agentFacets = computed(() => ({
    ...(hostSays.value === null
      ? facetsForRecord(props.record, sessionFacets(facetInput.value))
      : // What it needs a person for is this view's own to say: the cards it holds open.
        facetsOfState(hostSays.value, sessionFacets(facetInput.value).needing)),
    // A pending launch is current even while the transcript still shows the previous turn.
    ...(props.launching === true ? { being: 'starting' as const } : {}),
  }))

  /**
   * ⚑ **D-017b · whose window takes this conversation's turns, when it is not this one** — see
   * {@link turnsTakenWithoutThisWindow}: its cards are answered there, and a message held in it goes
   * when its turn ends.
   */
  const takenWithoutThisWindow = computed(() => turnsTakenWithoutThisWindow(props.record))

  /**
   * ⚑ **D-017b · the settings are statements here** — a view drawn from its ledger whose settings the
   * host would not take (`CreatedSession.settingsFixed`): a window holds it, no message continues it,
   * or its messages go to the conversation continuing its job. ⚠️ A record that stopped and has not
   * been looked at again still holds the last life's `meta`, which says nothing: statements until it
   * is.
   */
  const settingsFixed = computed(
    () => props.record.phase === 'recorded' && props.record.meta?.settingsFixed !== false,
  )

  /**
   * ⚑ **D-017 · R11 — this conversation's ONE state**, the host's (`shared/agent-state.ts`) — what
   * it left running, when it next wakes, whose answer it waits on, who holds the work it gave out —
   * for the word under the plate: the rail row's word, and the one `list_agents` reports.
   */
  const agentState = computed(() => hostSays.value ?? stateForRecord(props.record))

  /**
   * The pill's line, from the SAME input object the plate is drawn from (089).
   *
   * ⚠️ **One `computed`, read twice — not two readings of `control`.** The plate and the pill are six
   * inches apart on screen and answer the same question; building each from its own gathering of the
   * same fields is precisely how they came to disagree in the first place. Sharing the input makes
   * "the pill says a tool is running while the face says replying" unrepresentable rather than
   * merely fixed.
   */
  const limitMinute = useMinuteClock()
  /** "Still thinking (N min)." while the provider is silent after the model's reasoning, or `null`. */
  const stillThinking = useStillThinking(() => {
    const said = props.record.meta?.liveness
    return said?.state === 'silent' && said.thinking === true ? said.since : null
  })
  const providerLimit = computed(() =>
    providerLimitDisplay(
      props.providerBlock !== undefined ? props.providerBlock : props.record.meta,
      agentFacets.value.needing === 'permission' ||
        agentFacets.value.needing === 'question' ||
        agentFacets.value.waiting === 'waiting-on-a-person'
        ? { is: 'needs-you' }
        : agentState.value,
      limitMinute.value,
    ),
  )
  const activity = computed(() => activityLine(facetInput.value))

  /**
   * The status line's stamp. ⚑ **The rule lives in `lib/session-record.ts`, not here** — it is a derivation
   * over the record's two windows with a hazard in it, which is exactly the kind of thing that file
   * exists to hold where a test can drive it without a component (389 §3).
   */
  const lastReport = computed<number | null>(() => lastReportAt(props.record))

  /**
   * The pill's presence and text, handed to the transcript so it can re-pin when the pill takes or
   * gives back space beneath it (027). Its text is in here as well as its presence because a long
   * enough tool name wraps to a second line, which is the same problem one line further down.
   *
   * ⚠️ **It is no longer the whole footprint, and `520` is why** — see {@link paneFootprint}. The pill
   * is one of TWO things that can appear beside the scroll container; this computes the pill's half.
   */
  const activityFootprint = computed(() => {
    const line = activity.value
    return line ? `${line.doing}:${line.detail ?? ''}` : ''
  })

  /**
   * 🔴 **Everything that can appear BESIDE the scroll container, as one string** (520, on 027's rail).
   *
   * ⛔ **027's mechanism, generalised to the category rather than to the pill.** Its own comment in
   * `TranscriptView` states the rule: *"the activity pill is a SIBLING of this scroll container, not a
   * child: when it appears, this element loses ~28px of height while `scrollTop` stays put, and a
   * reader pinned to the bottom silently loses the last line to the fold."*
   *
   * ⚑ **One footprint and not two props**, because the transcript's question is *did anything beside
   * me change size*, and two signals would be two answers to it — `169` §1, on a rail rather than on
   * copy. A third such sibling joins this string; it does not get its own channel.
   */
  const paneFootprint = computed(
    () =>
      // ⚑ 739 review — the no-answer line (`session-unanswered`) is a third sibling that takes height,
      // and on a TIMER: a reader pinned to the bottom stays pinned when it appears.
      `${activityFootprint.value}|${props.record.unanswered > 0 ? 'unanswered' : ''}`,
  )

  return {
    who,
    ownAgent,
    needsGoAhead,
    cardsForAPerson,
    facetInput,
    hostSays,
    agentFacets,
    takenWithoutThisWindow,
    settingsFixed,
    agentState,
    limitMinute,
    stillThinking,
    providerLimit,
    activity,
    lastReport,
    activityFootprint,
    paneFootprint,
  }
}
