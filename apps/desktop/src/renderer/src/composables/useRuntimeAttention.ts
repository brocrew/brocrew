import type { WhatEachConversationIsWaitingOn } from '../../../shared/task-contracts'
import type {
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
} from '../../../shared/question-contracts'
import type { McpServerRequestForAPerson } from '../../../shared/conversation-events'
import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { providersNotChosenIn, type AgentStore } from '../lib/agent-store'
import { owedHere } from '../lib/owed-here'
import type { ClientDesktopApi } from '../../../shared/client-api'
import { oneReadAtATime } from '../lib/one-read-at-a-time'
import { limitsDisplayLane, type LimitsDisplayState } from '../lib/limits-display'
import { recordFacets, standingWord, stateForRecord } from '../lib/agent-state'
import {
  answeredFromHere,
  attentionQueue,
  listedNowhereElse,
  type AttentionRequest,
} from '../lib/attention'
import { homeAttention } from '../lib/home-attention'
import { syncAttentionSignals } from './useAttentionSignals'
import { limitsReadCadence, type PersonsQueue } from '../lib/persons-queue'
import { theWaitIn, theWorkIn, whoItOwesIn } from '../lib/conversation-waits'
import type { StalledWork } from '../../../shared/stalled-work'
import type { StoppedWorkForAPerson } from '../../../shared/stopped-work'
import type { WorkIncident } from '../../../shared/work-incidents'
import type { WaitingOnWhoWrote } from '../../../shared/waiting-on-who-wrote'
import type { InstructionAskWaiting } from '../../../shared/own-instructions'
import type { SessionStore } from '../lib/session-store'
import type SideRail from '../components/SideRail.vue'

export function useRuntimeAttention({
  store,
  agentStore,
  persons,
  rail,
  agentHeadingFor,
  desktopIfAny,
}: {
  store: SessionStore
  agentStore: AgentStore
  persons: PersonsQueue
  rail: Ref<InstanceType<typeof SideRail> | null>
  agentHeadingFor: (profileSlug: string) => string
  desktopIfAny: () => ClientDesktopApi | undefined
}) {
  /**
   * ⛔ **`null` until the first reading lands** (636) — *nobody has looked*, which every surface
   * draws as nothing at all rather than as *nothing is waiting*. See `WaitReading`, where the
   * three absences are told apart. ⚑ **Declared above {@link needsYou}**, whose words read it (D-017 · R19)
   * and which a watch reads as soon as the screen is set up.
   */
  const conversationWaits = ref<WhatEachConversationIsWaitingOn | null>(null)

  /**
   * ⛔ **Everything that needs the user, across every open conversation** (205, from 195 H3).
   *
   * Projected HERE, once, because this is where the records are — and handed to *Waiting on you* and
   * to the rail as data. Two components deriving it themselves is the shape 099 measured going wrong.
   *
   * ⚑ **`standingWord(recordFacets(record))` is 203's word, reused rather than restated.** The rail
   * draws its rows from the same two calls, so a conversation cannot be `needs you: permission` in
   * one place and something else in the other.
   */
  const needsYou = computed<AttentionRequest[]>(() =>
    attentionQueue(
      store.live.value,
      (record) => {
        // ⚑ **D-017 · R11** — in the host's ONE state's words, as the rail row says them: who owes it
        // the next move is the host's verdict here too (R19).
        const facets = recordFacets(
          record,
          theWaitIn(conversationWaits.value, record.sessionId),
          theWorkIn(conversationWaits.value, record.sessionId),
          // ⚑ **F036** — who waits on its answer, off the host's state of it (the rail's listed row).
          whoItOwesIn(rail.value?.listedOf(record.sessionId)?.state),
        )
        return standingWord(facets, stateForRecord(record))
      },
      // ⚑ **714 · R41** — the identity each waiting row's conversation runs as
      // (`AttentionRequest.who`), named over the roster.
      agentHeadingFor,
    ),
  )

  /**
   * ⚑ **D-017 · R19 — what *Waiting on you* and its counts take from this window**: the cards no host
   * read lists ({@link listedNowhereElse}). ⛔ Everything else there is the host's read over every
   * conversation, so what waits on a person never depends on which conversations this window holds.
   * ⚠️ {@link needsYou} stays whole for the queue's rows, which take their answers off a live card
   * wherever this window holds one.
   */
  const waitingHere = computed(() => listedNowhereElse(needsYou.value))

  /**
   * 🔴 **Every card this window has answered, by the key the queue rows carry** (468, `453` weak
   * point 1) — see `answeredFromHere`, which is where the derivation and its argument live.
   *
   * ⚑ **A press is answered in one tick and the LIST is answered in up to five seconds**, and
   * between those two moments the row fell into the branch for *this window holds the conversation
   * and the card is not in the page it holds* — which told a person to go and answer a card they had
   * just answered. ⛔ Nothing between those two events is wrong; the sentence drawn across them was.
   */
  const answered = computed(() => answeredFromHere(store.live.value))

  /**
   * ⛔ **The rail's *Waiting on you* badge counts what that page calls WORK** (305 §1, narrowed by
   * 468).
   *
   * ⚑ **The same function *Waiting on you* calls, on the same inputs**, so a badge and the screen it
   * opens cannot come to different numbers — a pure call from two places is one source, which is the
   * shape `permission-offer.ts` settled in 299.
   *
   * ⚠️ **Stated without a COUNT since `401`**, and the count is why: this said *"the same two
   * inputs"*, `401` added a third, and `homeAttention`'s new argument is OPTIONAL — so leaving it
   * off here compiled, ran, and made the rail draw no badge over a question escalated to a person
   * while the screen that button opens listed it. ⛔ `304`'s contradiction, re-created inside the
   * dispatch that cites it. `persons-queue.test.ts` §6 pins that every call site in this component
   * passes them all.
   */
  const homeNeedsYou = computed(() =>
    homeAttention({
      // ⚑ **D-017 · R19** — {@link waitingHere}, and the instruction asks beside the queue's rows,
      // read off the queue module as *Waiting on you* and the corner read them. ⚑ **F097** — and the
      // work whose agent answered a person, read the same way.
      requests: waitingHere.value,
      // ⚑ …and the agents a person has to choose a provider for, as that page counts them.
      onlyYou: owedHere(persons, agentStore.identities.value),
      // 🔴 **453 · `mayBeShort`, and it is a FIX rather than a rename.** ⛔ This call site passed
      // `partial` alone while another passed `partial || stale` — `434` widened one of the two — so
      // the rail's summary could say the workspace was quiet over a list that stopped answering. ⚑ The disjunction is derived on the view now, so the two cannot diverge again.
      // ⚑ **678 · on the queue**, so it covers the stalled band's two holes as well — the Waiting-on-you
      // page draws that band now, and this line and that page answer the same question.
      // ⚑ **D-017 · R19** — the field covers a look for the asks that has not answered, too.
      unread: persons.mayBeShort.value,
    }),
  )

  /** The native signs use exactly the count and populations the Waiting on you page draws. */
  syncAttentionSignals(
    computed(() => ({
      count: homeNeedsYou.value.total,
      populations: [
        {
          name: 'requests',
          ready: persons.view.value !== null && !persons.view.value.partial,
          keys: [...waitingHere.value, ...(persons.view.value?.rows ?? [])].map(
            (row) => `request:${row.key}`,
          ),
        },
        {
          name: 'instructions',
          ready: persons.asks.value !== null && !persons.asks.value.partial,
          keys: (persons.asks.value?.rows ?? []).map((row) => `instruction:${row.askId}`),
        },
        {
          name: 'servers',
          ready: persons.serverRequests.value !== null && !persons.serverRequests.value.partial,
          keys: (persons.serverRequests.value?.rows ?? []).map((row) => `server:${row.requestId}`),
        },
        {
          name: 'replies',
          ready:
            persons.waitingOnWhoWrote.value !== null && !persons.waitingOnWhoWrote.value.unread,
          keys: (persons.waitingOnWhoWrote.value?.rows ?? []).map((row) => `reply:${row.key}`),
        },
        {
          name: 'todos',
          ready: persons.attentionReady.value.todos,
          keys: persons.workWaits.value.todos.rows.map((row) => `todo:${row.key}`),
        },
        {
          name: 'incidents',
          ready: persons.attentionReady.value.incidents,
          keys: persons.workWaits.value.incidents.rows.map((row) => `incident:${row.key}`),
        },
        {
          name: 'providers',
          ready: agentStore.identities.value !== null,
          keys: providersNotChosenIn(agentStore.identities.value).map(
            (row) => `provider:${row.slug}`,
          ),
        },
      ],
    })),
    // A hot reload may retain the previous preload until the next app launch.
    (signal) => desktopIfAny()?.attentionSignals?.(signal) ?? Promise.resolve(),
  )

  /**
   * ⛔ **A clock that ticks ONLY while something is waiting** (205).
   *
   * The queue's whole argument is *"how long has this been frozen"*, and an age is a lie the moment it
   * stops moving: 195's 63 seconds would have read as one fixed number for the rest of the session if
   * the clock were sampled once.
   *
   * ⚠️ **One second, because that is the resolution `agoWords` actually prints.** Its first band is
   * `${seconds}s ago` — checked, not assumed — so a ten-second tick would show `40s` for a card that
   * had been frozen for 49, on the surface whose entire purpose is that number. Above a minute it
   * repaints without changing a word, which costs a diff of a handful of rows.
   *
   * ⛔ **The interval exists ONLY while there is a row to age.** A timer that re-renders the window
   * forever on an empty dashboard is the cost 099 spent a dispatch removing from the rail.
   */
  const clock = ref(Date.now())
  let ticking: ReturnType<typeof setInterval> | null = null
  watch(
    // ⚑ **401 joins the condition rather than adding a second timer.** The escalated rows carry an
    // age too — *how long has this been yours* is the whole argument for that surface as much as for
    // this one — and a conversation can be escalated with nothing pending in this window at all.
    // ⚑ W4.63 · and while a provider's limit stands: the Providers card says when it lifts, by day.
    // ⚑ F097 · and while a reply is owed or work has stopped: each of those rows says how long ago,
    // and a clock that stood still would say *0s ago* for hours.
    () =>
      needsYou.value.length > 0 ||
      (persons.view.value?.count ?? 0) > 0 ||
      (persons.limits.value?.walls.length ?? 0) > 0 ||
      (persons.waitingOnWhoWrote.value?.rows.length ?? 0) > 0 ||
      (persons.stalled.value?.rows.length ?? 0) > 0,
    (waiting) => {
      if (waiting && ticking === null) {
        clock.value = Date.now()
        ticking = setInterval(() => (clock.value = Date.now()), 1_000)
      }
      if (!waiting && ticking !== null) {
        clearInterval(ticking)
        ticking = null
      }
    },
    { immediate: true },
  )
  onUnmounted(() => {
    if (ticking !== null) clearInterval(ticking)
  })

  /**
   * 🔴 **This screen does the LOOKING for the queue that ends at a person** (401, criterion 11).
   *
   * ## ⛔ It is a poll because nothing pushes, and that is measured rather than assumed
   *
   * ⚠️ **Three independent facts, each sufficient on its own.** (1) `request_routed` is written
   * into the ledger of the CHILD that asked, and a child a PM spawned is reserved under no owner —
   * its sink is the discard, so `emitOurs` returns before it sends. (2) A row for a conversation the
   * host is not running is written straight to the database with no wire message at all. (3) Even in
   * the window that does own the child, `transcript.ts` draws nothing for that row at all — it
   * returns, for `437`'s reason: the words are already on the page twice.
   *
   * ⚑ **612 · the three facts named `request_escalated` until `HO-088` §3.1 removed the only thing
   * that wrote one.** ⛔ **Every one of them is unchanged and the SUBJECT moved**, which is the
   * strongest form this argument has ever had: the row that reaches a person now is the ROUTING
   * itself, written by `ask_question` or `pass_question_up` in the asker's own ledger.
   *
   * ⛔ **So the ONLY way this window can know is to ask**, and the cadence is `LOOK_EVERY_MS`.
   *
   * ## ⛔ It is NOT gated on this window's own conversations, and the first version was
   *
   * 🔴 **`store.live` and the population this queue is about are disjoint, which is the whole
   * point of the queue.** The row is written for a session the HOST is running, and the ordinary one
   * is a child a PM spawned — reserved under no owner, so it is in the host's slots and never in this
   * window's records. A look gated on `store.live.value.length > 0` therefore stops at the exact
   * moment it matters most: close the PM and the worker it spawned goes on running, addresses its
   * next question to a person, and nothing ever asks again. ⚠️ **A cold window is the same defect one
   * step earlier** — relaunch, press *Waiting on you* before opening anything, and the screen says
   * nothing needs you over a row that is in the database.
   *
   * ⚑ **612 · the sentence said *"its question falls due thirty seconds later"***, and there is no
   * deadline for it to fall due at (HO-088 §3.1). ⛔ **The defect it describes got WORSE, not
   * better**: the row now lands the instant the agent calls, so the window a gated look would miss
   * starts immediately rather than half a minute in.
   *
   * ⚑ **So it runs for the life of the screen**, and the cost it was gated for is not there:
   * `questionsAPersonMustAnswer` starts from `SELECT DISTINCT session_id … WHERE type = 'request_routed'`,
   * which is EMPTY in a database where nothing has ever routed a question — which is every install
   * that has not spawned an agent.
   *
   * ## 🔴 A refusal is not an all-clear
   *
   * ⛔ **`null` from the store means the read did not answer, and the last answer is KEPT.** Blanking
   * the queue on a dropped IPC call would draw *"nothing is waiting on you"* out of a failure, which
   * is the strongest false claim this app could make about somebody's own workload.
   */
  const escalated = ref<LedgerWalk<PersonsQuestion> | null>(null)
  /**
   * 🔴 **The second population, and the one a spawned child actually produces** (403, `402` F1).
   *
   * ⛔ **The look above could never have found it.** Every spawned child is `ask` BY RAIL, so its
   * first consequential tool call parks on a permission card — and a permission never travels, so it
   * is never escalated, so `questionsForAPerson` cannot admit one. ⚠️ **Measured live: three
   * permissions needed a person on one worker and that reader listed none of them.** A child frozen
   * on an answer only a person can give was in NONE of the populations a person was shown.
   *
   * ⚑ **Same cadence, same refusal reading, same `null`-is-not-empty rule** — see below.
   */
  const decided = ref<LedgerWalk<PersonsDecision> | null>(null)
  /**
   * 🔴 **Whether the MOST RECENT look answered, per population** (434) — see
   * {@link PersonsQueueView.stale}.
   *
   * ⛔ **True before the first look, and that reads backwards until you say what `stale` means**: it
   * is *a read that used to answer has stopped*, and before the first look nothing has stopped. The
   * absence that IS drawn at that moment is `null` from the view, which is *nobody has answered yet*.
   */
  const lastLookAnswered = ref<{ questions: boolean; decisions: boolean }>({
    questions: true,
    decisions: true,
  })
  /** Whether the queue's first look has come back, answered or refused. */
  const queueLooked = ref(false)
  /**
   * 🔴 **The wall read of the one look, and the first that is not a thing a person owes** (533,
   * HO-052 §4).
   *
   * ⛔ **Two real runs, two days, both providers, and he saw neither.** Each wall was a non-fatal
   * `error` row in a transcript nobody was reading. ⚑ The PO's ruling is that it belongs where
   * everything else that needs him belongs, so it arrives on this poll — and it is drawn BESIDE the
   * queue's rows rather than as one, because a wall cannot be answered. See
   * `persons-queue.ts`' `ProviderLimitsView` for the whole argument.
   *
   * Scheduled limit looks run less often than actionable looks. An explicit refresh still reads
   * them immediately; a skipped look preserves both the last answer and its failure status.
   */
  const limitsDisplay = ref<LimitsDisplayState>({ status: 'updating', reading: null })
  const limitsLane = limitsDisplayLane((state) => (limitsDisplay.value = state))
  let actionableReadsClosed = false
  /**
   * 🔴 **557 · work that has stopped with nobody left to tell** — another read of the one look.
   *
   * ⛔ **The last good answer is kept for the reads above's reason**: a dropped call must not be able
   * to say *nothing has stopped*, which is the one all-clear `555` §3.1 measured this app making
   * while it was false.
   */
  const stalledWork = ref<LedgerWalk<StalledWork> | null>(null)
  /** ⛔ **Whether the MOST RECENT look for stalled work answered** — `lastWallLookAnswered`'s fact. */
  const lastStallLookAnswered = ref(true)
  /**
   * Work whose holder stopped with it, its giver told: another read of the one look, the last good
   * answer kept for the stalls' reason.
   */
  const stoppedWork = ref<LedgerWalk<StoppedWorkForAPerson> | null>(null)
  /** Whether the most recent look for stopped work answered. */
  const lastStopLookAnswered = ref(true)
  /** Open work no other list shows, read in the same look; the last good answer kept. */
  const workIncidents = ref<LedgerWalk<WorkIncident> | null>(null)
  /** Whether the most recent look for that work answered. */
  const lastIncidentLookAnswered = ref(true)
  /**
   * ⚑ **D-017 · R19 — every ask against an identity's instructions nobody has answered**, read over
   * every conversation — another read of the one look. ⛔ The last good answer is kept, for the reads
   * above's reason: a dropped call must not be able to take an ask off a person's list.
   */
  const instructionAsks = ref<readonly InstructionAskWaiting[] | null>(null)
  /** ⛔ **Whether the MOST RECENT look for instruction asks answered** — `lastStallLookAnswered`'s fact. */
  const lastAskLookAnswered = ref(true)
  /**
   * ⚑ **F097 — the work whose agent answered a person and waits on their next words**, read over every
   * conversation — another read of the one look. ⛔ The last good answer is kept, for the reads above's
   * reason: a dropped call must not be able to take a piece off a person's list.
   */
  const waitingOnWhoWrote = ref<LedgerWalk<WaitingOnWhoWrote> | null>(null)
  /** ⛔ **Whether the MOST RECENT look for that work answered** — `lastStallLookAnswered`'s fact. */
  const lastReplyLookAnswered = ref(true)
  /**
   * The agents' requests to register an MCP server, read over every conversation in the one look. The
   * last good answer is kept, for the reads above's reason.
   */
  const mcpServerRequests = ref<readonly McpServerRequestForAPerson[] | null>(null)
  /** Whether the most recent look for those requests answered. */
  const lastServerRequestLookAnswered = ref(true)
  const lookAtLimits = limitsReadCadence()

  /**
   * ⚑ **W4.63 · a provider's usage moved — look now**, so a limit that lifted leaves the Providers
   * card without waiting for the next tick. ⚑ One at a time: a notice while one is out joins it.
   */
  let aLookAfterANotice: Promise<void> | null = null
  function lookAfterAUsageNotice(): void {
    aLookAfterANotice ??= lookForWhatIsYours().finally(() => {
      aLookAfterANotice = null
    })
  }

  let queueNoticePending = false
  function lookAfterAQueueNotice(): void {
    if (queueNoticePending || actionableReadsClosed) return
    queueNoticePending = true
    queueMicrotask(() => {
      queueNoticePending = false
      if (!actionableReadsClosed) void lookForWhatIsYours(true, true)
    })
  }

  /**
   * The one entry every ask for the queue goes through: the tick, the `persons` notice, the
   * `conversations` and `agents` notices, and each answer given here. `scheduled` keeps the limits
   * walk on its own cadence; an explicit look reads it at once. The queue itself is read by
   * {@link lookAtTheQueue}, so a burst of asks costs at most one more look, and a look a `notice`
   * asks for waits for the look tick's spacing.
   */
  async function lookForWhatIsYours(scheduled = false, notice = false): Promise<void> {
    void refreshLimitsDisplay(scheduled)
    await lookAtTheQueue(notice || (scheduled ? 'scheduled' : undefined))
  }

  /**
   * One round of the queue's reads. A screen that has closed starts none, and a round that lands
   * after it closed writes nothing.
   */
  async function lookAtTheQueueOnce(): Promise<void> {
    if (actionableReadsClosed) return
    let answer: Awaited<ReturnType<typeof store.personsQueue>>
    try {
      answer = await store.personsQueue()
    } finally {
      if (!actionableReadsClosed) queueLooked.value = true
    }
    const queue = answer !== null && !('refused' in answer) ? answer : null
    const questions = queue?.questions ?? null
    const decisions = queue?.decisions ?? null
    const stalls = queue?.stalled ?? null
    const asks = queue?.instructionAsks?.rows ?? null
    const owed = queue?.waitingOnWhoWrote ?? null
    const serverAsks = queue?.mcpServerRequests?.rows ?? null
    const stops = queue?.stopped ?? null
    const incidents = queue?.incidents ?? null
    if (actionableReadsClosed) return
    if (questions !== null) escalated.value = questions
    if (decisions !== null) decided.value = decisions
    // ⛔ **The last good answer is kept here too**, for the reads above's reason: a dropped call must
    // not be able to withdraw work that is still stopped.
    if (stalls !== null) stalledWork.value = stalls
    lastStallLookAnswered.value = stalls !== null && queue!.published.covers.stalled.complete
    // ⛔ **The last good answer is kept here too**, for the reads above's reason.
    if (asks !== null) instructionAsks.value = asks
    lastAskLookAnswered.value = asks !== null && queue!.published.covers.instructionAsks.complete
    // ⛔ **…and here** (F097).
    if (owed !== null) waitingOnWhoWrote.value = owed
    lastReplyLookAnswered.value =
      owed !== null && queue!.published.covers.waitingOnWhoWrote.complete
    if (serverAsks !== null) mcpServerRequests.value = serverAsks
    lastServerRequestLookAnswered.value =
      serverAsks !== null && queue!.published.covers.mcpServerRequests.complete
    if (stops !== null) stoppedWork.value = stops
    lastStopLookAnswered.value = stops !== null && queue!.published.covers.stopped.complete
    if (incidents !== null) workIncidents.value = incidents
    lastIncidentLookAnswered.value =
      incidents !== null && queue!.published.covers.incidents.complete
    // 🔴 **Whether the look that just landed ANSWERED, which the values above cannot say** (434).
    //
    // ⛔ **Keeping the last good answer is right and it hides the failure.** A population whose read
    // starts refusing keeps its rows for ever, so `personsQueueView`'s `partial` — which reads
    // `null` — is false for ever too, and a list frozen at the minute the read died is drawn with
    // nothing saying so. ⚠️ **A queue that silently omits an item fails criterion 17 in the
    // direction that costs most**, and everything that arrived since the freeze is omitted.
    lastLookAnswered.value = {
      questions: questions !== null && queue!.published.covers.questions.complete,
      decisions: decisions !== null && queue!.published.covers.decisions.complete,
    }
  }

  /**
   * At most one round in flight and one owed, so the round that reads after the last ask always
   * runs; rounds never overlap, so an older round's answer can't land over a newer one.
   *
   * ⚑ **Spaced** (cards 353 and 554): a round owed only to notices starts no sooner than one look
   * tick after the last one started, so a stream of notices joins the tick's rounds rather than
   * keeping the one read worker busy. The last ask is still read. ⚑ The tick itself never waits, and
   * rides on a round already out; a look a person's own action asks for never waits.
   */
  const lookAtTheQueue = oneReadAtATime(lookAtTheQueueOnce, { spaced: true })

  async function refreshLimitsDisplay(scheduled = false): Promise<void> {
    await lookAtLimits(() => limitsLane.refresh(() => store.readLimitsDisplay()), scheduled)
  }

  /**
   * 🔴 **636 · what every conversation this app is RUNNING is waiting on** (`621` §5.1 ·
   * `HO-095` §5.1 · `HO-096` §4) — the read `621` put on the wire and deliberately left with no
   * renderer.
   *
   * > 🔴 **`HO-095` §5.1:** *"BroBot's header, avatar and rail row read `Idle` while Task #1 was
   * > being worked on by Ada."*
   *
   * ## ⛔ A POLL, and it is the same measurement `readTheCast` records one function up
   *
   * ⚠️ **A child's `work_replied` is written into the CHILD's ledger**, so the conversation that
   * gave the work out is told nothing at all when the work moves — `RuntimeScreen`'s own note, and
   * `621` §4's measurement. ⛔ **No window can derive this from its own stream**, so asking is the
   * only honest cadence.
   *
   * It runs on the same tick as the person's queue.
   *
   * ⛔ **Ungated, unlike {@link readActivity}**: the rail is on screen on every
   * surface this window has, so there is no state in which this tick paints nothing. ⚠️ **Fired in
   * the same callback rather than inside that function's `Promise.all`**, because that fold is one
   * card drawn from one moment and this reading carries a `readAt` of its own.
   *
   * ⚠️ **NOT folded into {@link readTheCast}**, whose own note says why it is not this read: that
   * one is gated on a conversation being on screen and the rail draws a population.
   *
   * ## ⛔ A refusal keeps the last good reading, and the reason is sharper here than elsewhere
   *
   * ⚑ **`null` from the store is *we did not look*.** Blanking on it would make every rail row fall
   * back to the word its live facets produce — `idle` for a conversation whose worker is still
   * working — which is the exact sentence this dispatch exists to remove, restored by a dropped
   * IPC call.
   */
  async function readWhatIsWaiting(): Promise<void> {
    const reading = await store.whatEachConversationIsWaitingOn()
    if (reading !== null) conversationWaits.value = reading
  }

  return {
    conversationWaits,
    needsYou,
    waitingHere,
    answered,
    homeNeedsYou,
    clock,
    escalated,
    decided,
    lastLookAnswered,
    queueLooked,
    limitsDisplay,
    limitsLane,
    stalledWork,
    lastStallLookAnswered,
    stoppedWork,
    lastStopLookAnswered,
    workIncidents,
    lastIncidentLookAnswered,
    instructionAsks,
    lastAskLookAnswered,
    waitingOnWhoWrote,
    lastReplyLookAnswered,
    mcpServerRequests,
    lastServerRequestLookAnswered,
    lookAfterAUsageNotice,
    lookAfterAQueueNotice,
    lookForWhatIsYours,
    refreshLimitsDisplay,
    readWhatIsWaiting,
    areActionableReadsClosed: () => actionableReadsClosed,
    closeActionableReads: () => {
      actionableReadsClosed = true
    },
  }
}
