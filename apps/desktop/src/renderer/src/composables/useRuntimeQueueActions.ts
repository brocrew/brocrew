import { closeWorkSays } from '../lib/close-work'
import { computed, nextTick, ref, watch, watchEffect, type Ref } from 'vue'
import type { AnswerAck, UserInputResponse } from '../../../shared/runtime-ipc'
import { type AgentStore } from '../lib/agent-store'
import type { ClientScreenApi } from '../../../shared/client-screen-api'
import { readableError } from '../lib/session-record'
import {
  answerFor,
  attentionToACardNobodyHolds,
  OPEN_REQUEST_MISSED,
  type AttentionDecision,
  type AttentionRequest,
} from '../lib/attention'
import { type PersonsQueue, type PersonsQueueRow } from '../lib/persons-queue'
import { askedQuestionItemIn, briefItemIn } from '../lib/transcript'
import { THE_BRIEF_IS_FURTHER_BACK } from '../lib/outgoing-card'
import type { SessionStore } from '../lib/session-store'
import type CanonicalDocumentOverlay from '../components/CanonicalDocumentOverlay.vue'
import type ConversationPane from '../components/ConversationPane.vue'
import type SideRail from '../components/SideRail.vue'
import type { useRuntimeAttention } from './useRuntimeAttention'
import type { screenFacts } from './useWhoCalledWhom'

export function useRuntimeQueueActions({
  attention,
  castFacts,
  store,
  agentStore,
  persons,
  rail,
  pane,
  todoDocument,
  runtime,
  agentHeadingFor,
  openConversation,
  select,
  say,
  takeBackForAPerson,
  moveRequest,
  answerATodo,
}: {
  attention: ReturnType<typeof useRuntimeAttention>
  castFacts: ReturnType<typeof screenFacts>
  store: SessionStore
  agentStore: AgentStore
  persons: PersonsQueue
  rail: Ref<InstanceType<typeof SideRail> | null>
  pane: Ref<InstanceType<typeof ConversationPane> | null>
  todoDocument: Ref<InstanceType<typeof CanonicalDocumentOverlay> | null>
  runtime: () => ClientScreenApi
  agentHeadingFor: (profileSlug: string) => string
  openConversation: (sessionId: string, stillHere?: () => boolean) => Promise<boolean>
  select: (sessionId: string) => void
  say: (message: string) => void
  takeBackForAPerson: (piece: string) => Promise<string>
  moveRequest: (
    sessionId: string,
    requestId: string,
    decision: 'move' | 'here',
  ) => Promise<string | null>
  answerATodo: (
    sessionId: string,
    request: string,
    done: boolean,
    note: string,
  ) => Promise<string | null>
}) {
  const {
    needsYou,
    answered,
    clock,
    escalated,
    decided,
    limitsDisplay,
    stalledWork,
    stoppedWork,
    workIncidents,
    instructionAsks,
    waitingOnWhoWrote,
    mcpServerRequests,
    lastLookAnswered,
    queueLooked,
    lastStallLookAnswered,
    lastStopLookAnswered,
    lastIncidentLookAnswered,
    lastAskLookAnswered,
    lastReplyLookAnswered,
    lastServerRequestLookAnswered,
    lookForWhatIsYours,
  } = attention

  /**
   * 🔴 **Take a person to the card, and never answer it for them** (401 §5.1).
   *
   * ⛔ **Knowledge escalates; authority does not.** This walks to the conversation the question was
   * raised in and scrolls to the card; the card is where a permission is decided and a question is
   * answered, through `respondUserInput`, which is unchanged.
   *
   * ⚑ **D-017b · the conversation opens as any press opens it** ({@link openConversation}) — attached,
   * taken for this window when it runs with no window, or drawn from its ledger when nothing runs it,
   * where a question this app asked is still answerable (D-017 · R6). ⛔ Nothing is started to get
   * there.
   *
   * ⛔ **The card only once the conversation is on screen**: a person who moved while it was being
   * opened is not moved back, and no card is looked for on a pane that is not drawn.
   */
  async function goToQuestion(row: PersonsQueueRow): Promise<void> {
    if (!(await openConversation(row.sessionId))) return
    const record = store.get(row.sessionId)
    if (record === null) return
    await nextTick()
    // ⛔ **The card, not the conversation.** `requestItems` is the fold's own request id → item id
    // map; a request whose card has been released from the window's page has no item, and that is
    // said rather than landed on silently (106). ⚑ **UI-009 · a question this app asked is on the
    // call that asked it** — its own card, which `requestItems` does not hold.
    const itemId =
      record.control.requestItems.get(row.requestId) ??
      askedQuestionItemIn(record.control, row.requestId)
    if (itemId === undefined || pane.value?.focus(itemId) !== true) say(OPEN_REQUEST_MISSED)
  }

  /**
   * 🔴 **The conversations THIS WINDOW is running** (506) — `store.live`'s ids, once.
   *
   * ⛔ **Several surfaces ask this question, so it is spelled once here.** The person's queue and the
   * transcript's work reports; `169` §1 is that a rule spelled several times drifts in one of them.
   * ⚑ The queue's copy is pointed here, and the rail's one list reads the same `store.live` it is
   * handed.
   *
   * ⚑ **An ARRAY, and the one `Set` each reader needs is its own.** A prop that is a `Set` is a prop
   * a render test has to construct.
   */
  const heldHere = computed<readonly string[]>(() =>
    store.live.value.map((record) => record.sessionId),
  )

  /**
   * This window's last press on a row whose conversation no window holds, by row key: sent until the
   * row leaves the list, or the host's words when the answer was not taken.
   */
  const pressedWhereNobodyHolds = ref(new Map<string, { sent: boolean; refused: string | null }>())

  /** The rows for requests in conversations no window holds, from the cards the host read. */
  const nobodyHolds = computed(() => {
    const held = new Set(heldHere.value)
    const rows = new Map<string, AttentionRequest>()
    for (const decision of decided.value?.rows ?? []) {
      const { askedBy, requestId } = decision.request
      if (decision.card === undefined || held.has(askedBy)) continue
      const key = `${askedBy}:${requestId}`
      const row = attentionToACardNobodyHolds(
        askedBy,
        decision.card,
        pressedWhereNobodyHolds.value.get(key) ?? { sent: false, refused: null },
        agentHeadingFor,
      )
      if (row !== undefined) rows.set(key, row)
    }
    return rows
  })

  watch(decided, (walked) => {
    const listed = new Set(
      (walked?.rows ?? []).map((one) => `${one.request.askedBy}:${one.request.requestId}`),
    )
    for (const key of [...pressedWhereNobodyHolds.value.keys()]) {
      if (!listed.has(key)) pressedWhereNobodyHolds.value.delete(key)
    }
  })

  /**
   * ⚑ **UI-001 · what the rail says of each conversation, mirrored for the band** — the right panel's
   * cards draw an agent from its rail row, so the two say one thing, and a row this window is not fed
   * says the host's one state (`get_agent_status`'). ⚑ Followed, never re-derived.
   */
  watchEffect(() => {
    castFacts.update({ railSays: rail.value?.says ?? null })
  })

  /**
   * Open the conversation named by a work report so the person can follow the work there.
   *
   * ⚑ **D-017b · one door for every press that opens a conversation** — {@link openConversation}; the
   * stopped-work band's button (557) and the forest's rows go the same way.
   *
   * 🔴 **UI-011 · and a give card's cut note brings its piece's brief into view there** (F037) —
   * `briefOf`, the piece's label: {@link goToQuestion}'s landing, once the conversation is on
   * screen; ⛔ a brief further back is said, never landed short of silently (106). ⚠️ Found in the
   * READER's fold, not the control one a question is found in: a brief is history, and the ids
   * `focus` matches are the rows that fold draws.
   */
  async function goToTheWork(sessionId: string, briefOf?: string): Promise<void> {
    if (!(await openConversation(sessionId)) || briefOf === undefined) return
    const record = store.get(sessionId)
    if (record === null) return
    await nextTick()
    const itemId = briefItemIn(record.transcript, briefOf)
    if (itemId === undefined || pane.value?.focus(itemId) !== true) say(THE_BRIEF_IS_FURTHER_BACK)
  }

  /**
   * ⛔ **One state, two surfaces** — *Waiting on you*'s *Yours to settle* group and the overlay
   * layer's corner, supplied here exactly as the emergency stop is.
   *
   * ⚠️ **`answerable` is the live queue's own ROWS** (434), so a queue row can both say that its
   * card is also listed here and offer that card's own answers — instead of the two lists silently
   * describing one conversation twice, and instead of a second place deciding what a request offers.
   */
  watchEffect(() => {
    persons.supply(
      escalated.value,
      decided.value,
      {
        held: new Set(heldHere.value),
        // ⛔ **The live ROW, not its key** (434). It carries what may be sent, so the queue can
        // offer the answer instead of only a way to walk to it — and *"is it also on screen"* and
        // *"what may be sent here"* stay one fact.
        answerable: new Map(needsYou.value.map((request) => [request.key, request])),
        nobodyHolds: nobodyHolds.value,
        // 🔴 **468 · what this window has already answered**, so the row a person just cleared says
        // so instead of sending them to a card that is over. See {@link answeredFromHere}.
        answeredFromHere: answered.value,
        now: clock.value,
        lastLookAnswered: lastLookAnswered.value,
        looked: queueLooked.value,
      },
      {
        travel: (row) => void goToQuestion(row),
        settle: (row, decision) => settleFromTheQueue(row, decision),
        // ⚑ **UI-009** — a question this app asked, answered on its card.
        answer: (row, response) => answerFromTheQueue(row, response),
        move: (row, decision) => moveRequest(row.sessionId, row.requestId, decision),
        takeOver: (row) => void takeOverForTheQueue(row),
        // ⚑ **557 · `506`'s door, unchanged** — the band's destination is the conversation the
        // work is IN, which is the population that function already answers for. ⛔ A second copy of
        // its four steps was written and removed: `a-second-function-in-the-same-shape-disarms-a-
        // file-scoped-census`, and `506 M12`/`M13` went ambiguous on it.
        open: (sessionId) => void goToTheWork(sessionId),
        // ⚑ **D-017 · R19** — an ask about an identity's rules, decided on its row.
        decideInstruction: (askId, approve) => void decideInstructionAsk(askId, approve),
        // An agent's request to register an MCP server, decided on its row.
        decideMcpServerRequest: (requestId, approve) => decideAServerRequest(requestId, approve),
        // A to-do answered Done or Can't do it, with its note; the host's words when it didn't take it.
        answerTodo: (sessionId, request, done, note) => answerATodo(sessionId, request, done, note),
        openFile: (resource) => void todoDocument.value?.open(resource),
        closeWork: async (piece) => {
          try {
            const result = await runtime().closeWork({ piece })
            void lookForWhatIsYours()
            return closeWorkSays(result)
          } catch (cause) {
            return { ok: false, said: readableError(cause) }
          }
        },
        // A stopped piece handed back to its giver; the next look drops its row.
        handBack: async (label) => {
          const said = await takeBackForAPerson(label)
          void lookForWhatIsYours()
          return said
        },
      },
      {
        walked: limitsDisplay.value.reading?.walked ?? null,
        lastLookAnswered: limitsDisplay.value.status === 'ready',
        display: limitsDisplay.value,
      },
      // ⚑ **557 · in the SAME supply as the rows and the walls**, which is that method's own rule:
      // one call, one moment, so the card's three parts cannot come from three looks.
      { walked: stalledWork.value, lastLookAnswered: lastStallLookAnswered.value },
      // ⚑ **D-017 · R19 · the asks, in the SAME supply**, for that rule — so *Waiting on you* and the
      // overlay's corner count and list one look's asks, named over the roster.
      {
        walked: instructionAsks.value,
        lastLookAnswered: lastAskLookAnswered.value,
        nameOf: agentHeadingFor,
      },
      // ⚑ **F097 · the work waiting on a person's reply, in the SAME supply**, for that rule.
      { walked: waitingOnWhoWrote.value, lastLookAnswered: lastReplyLookAnswered.value },
      {
        walked: mcpServerRequests.value,
        lastLookAnswered: lastServerRequestLookAnswered.value,
        nameOf: agentHeadingFor,
      },
      { walked: stoppedWork.value, lastLookAnswered: lastStopLookAnswered.value },
      {
        incidents: workIncidents.value?.rows ?? null,
        lastLookAnswered: lastIncidentLookAnswered.value,
        rowsUnread: workIncidents.value?.rowsUnread ?? 0,
        ...(workIncidents.value?.ledgersSkipped === undefined
          ? {}
          : { ledgersSkipped: workIncidents.value.ledgersSkipped }),
      },
    )
  })

  /**
   * 🔴 **Settle a queue row where it is — criterion 17's *clearing it there clears it
   * everywhere*** (434).
   *
   * ⛔ **It is {@link decideFromOverview}, reached from a second surface, and deliberately not a
   * second path.** The live row is looked up by the queue row's own key, and the send is the same
   * `respondPermission` / `respondUserInput` the card and the overview already use; the request fold
   * closes the row and every projection refolds off the ledger. ⚠️ **Nothing here records that a row
   * was cleared** — a dismissed-list in the window would be a second opinion about what is closed,
   * which is the one thing criterion 17 forbids by name.
   *
   * ⚑ **UI-009 · a question this app asked is not settled here** — its card answers it
   * ({@link answerFromTheQueue}), and it has no live row to find.
   *
   * ⚠️ **The live lookup below is checked again**, because the queue's rows are five seconds old and
   * `store.live` is not — a conversation can be closed between the render and the press, and
   * answering the wrong one would look completely correct.
   */
  function settleFromTheQueue(row: PersonsQueueRow, decision: AttentionDecision): void {
    const live = needsYou.value.find((request) => request.key === row.key)
    if (live === undefined && nobodyHolds.value.has(row.key)) {
      void answerWhereNobodyHolds(row, decision)
      return
    }
    if (live === undefined) {
      say('That card is no longer on this window — open the conversation to answer it.')
      return
    }
    decideFromOverview(live, decision)
  }

  /**
   * Answer, from its row, a request in a conversation no window holds. The host answers it only if it
   * is a person's and still open. The row says the answer was sent until the next look drops it, or
   * shows the host's words if it was not taken.
   */
  async function answerWhereNobodyHolds(
    row: PersonsQueueRow,
    decision: AttentionDecision,
  ): Promise<void> {
    if (pressedWhereNobodyHolds.value.get(row.key)?.sent === true) return
    pressedWhereNobodyHolds.value.set(row.key, { sent: true, refused: null })
    const answer = answerFor(decision)
    const said =
      'permission' in answer
        ? await store.respondPermission(row.sessionId, row.requestId, answer.permission)
        : await store.respondUserInput(row.sessionId, row.requestId, answer.userInput)
    await lookForWhatIsYours()
    if (said === null) return
    const stillListed =
      !lastLookAnswered.value.decisions ||
      (decided.value?.rows ?? []).some(
        (one) => `${one.request.askedBy}:${one.request.requestId}` === row.key,
      )
    if (stillListed) {
      pressedWhereNobodyHolds.value.set(row.key, { sent: false, refused: said })
      return
    }
    pressedWhereNobodyHolds.value.delete(row.key)
    say(said)
  }

  /**
   * 🔴 **UI-009 · answer a question this app asked, from its card on *Waiting on you*** (F052).
   *
   * ⚑ **The SAME `store.respondUserInput` the conversation's card uses**, with the id this app minted:
   * where this window holds the asker `markSent` marks the draft before the first await, so the card
   * says *answer sent* inside one tick (`064`, `207` M2, `468`); ⚑ **D-017 · R6 — where it holds
   * nothing, the host is still asked**, and finds the question in the asker's ledger, running or
   * stopped. ⛔ A second press cannot deliver twice: the host refuses an answered question in its
   * own words. ⚑ The look runs again at once, so a question that was taken leaves the list.
   *
   * ⚑ **The host's words go back to the card only while the question is still on the list** (F2) —
   * a refusal over a question that is still open. ⛔ Words about a question that has LEFT the list —
   * taken and kept for its asker's next start, or already over — reopened the card's presses over a
   * question nobody could answer any more; they are said, and the card goes with its row. ⚠️ A look
   * that did not answer cannot say the row went, so it is read as still listed.
   *
   * ⚠️ **`row.sessionId` is the conversation that ASKED**, whose ledger the host finds the question in.
   */
  async function answerFromTheQueue(
    row: PersonsQueueRow,
    response: UserInputResponse,
  ): Promise<string | null> {
    const said = await store.respondUserInput(row.sessionId, row.requestId, response)
    await lookForWhatIsYours()
    if (said === null) return null
    const stillListed =
      !lastLookAnswered.value.questions ||
      (escalated.value?.rows ?? []).some(
        (one) => `${one.request.askedBy}:${one.request.requestId}` === row.key,
      )
    if (stillListed) return said
    say(said)
    return null
  }

  /**
   * ⚑ **D-017 · R19 — a person decides an agent's ask about an identity's rules from *Waiting on
   * you*** — the same `decideInstruction` that identity's own sheet presses. ⚑ The host's words when
   * it did not take it, and the look again at once. An ask the host no longer holds leaves the list
   * now, since a refused look keeps the last good answer (352).
   */
  async function decideInstructionAsk(askId: string, approve: boolean): Promise<void> {
    const ack = await agentStore.decideInstruction(askId, approve)
    if (ack.outcome === 'refused') say(ack.reason)
    if (ack.outcome === 'taken' || !ack.stillOpen)
      instructionAsks.value =
        instructionAsks.value?.filter((one) => one.asked.askId !== askId) ?? null
    await lookForWhatIsYours()
  }

  /**
   * A person decides an agent's request to register an MCP server from its row. The look runs again
   * at once, so the waiting list has caught up when the host's answer goes back to the card, which
   * keeps its words.
   */
  async function decideAServerRequest(requestId: string, approve: boolean): Promise<AnswerAck> {
    const ack = await agentStore.decideMcpServerRequest(requestId, approve)
    await lookForWhatIsYours()
    return ack
  }

  /**
   * 🔴 **Take the conversation over so its card can be answered in the queue** (434).
   *
   * ⛔ **`336`'s door with the navigation left off.** {@link goToQuestion} already claims for this
   * population on the way past — an agent-spawned child is reserved under no owner — so this adds
   * no entitlement; what it adds is staying put. ⚑ Once the claim lands the record is in
   * `store.live`, `needsYou` recomputes, and the row gains its answers in place: the person never
   * leaves the one list.
   *
   * ⚠️ **A refusal is said in the host's own words**, exactly as the travelling gesture says it.
   */
  async function takeOverForTheQueue(row: PersonsQueueRow): Promise<void> {
    try {
      await store.claim(row.sessionId)
    } catch (cause: unknown) {
      say(readableError(cause))
    }
  }

  /**
   * ⛔ **Answering from the overview — and it goes through 203's owner check like everything else.**
   *
   * ⚠️ **This window OWNS these sessions, and that is why it is allowed, not because the overview is
   * special.** `store.live` is this window's own records; the command carries this window's sink; and
   * `RuntimeHost.require` asks `mayControl(slot, by)` on the way in (203). A window that does not own
   * a session has no record for it here, so it cannot even build a row to press — and if one were
   * forged onto the wire, the host refuses it with `not-yours`. Both halves are asserted.
   *
   * ⚑ **It does NOT widen what a non-owner can see.** 203 §11 #2 left that question open and it is
   * the PM's: this surface reads `store.live`, which is exactly what this window already renders.
   */
  function decideFromOverview(request: AttentionRequest, decision: AttentionDecision): void {
    // ⛔ **`request.sessionId`, never `activeId`.** Every other answer path on this screen answers the
    // conversation on screen, and that is correct for them; here it would answer the wrong one and
    // look right doing it. See `answerFor` for the half that decides the payload.
    const answer = answerFor(decision)
    if ('permission' in answer) {
      void store.respondPermission(request.sessionId, request.requestId, answer.permission)
      return
    }
    void store.respondUserInput(request.sessionId, request.requestId, answer.userInput)
  }

  /**
   * Go to the card itself, where the full disclosure and the richer controls live.
   *
   * ⛔ **The `itemId` was carried the whole way here and thrown away** (236 §2, from 231 #5). The row
   * emits the whole request, `205` wrote `ConversationPane.focus(itemId)` for this, and this function
   * used the session id alone — so Open on the older of two pending requests landed at ordinary scroll
   * position, in a conversation with two cards, with nothing saying which one you had asked for. `205`
   * is the dispatch whose subject was *"everything that needs you in one place"*.
   *
   * ⚠️ **`nextTick` and not `nextTick × 2`, and the reason is what the tick is waiting for.** The
   * switch to the conversation is a reactive change here; the pane and its transcript are mounted
   * inside the parent's own patch, so one flush is the whole tree. The wait exists because
   * {@link select} may be the thing that MOUNTS the pane — opening from the overview usually is —
   * and `pane.value` is null until it does.
   *
   * ⛔ **A miss is SAID, not swallowed** (106). `focusItem` answers false when the card is not in the
   * part of the transcript this window holds; landing silently at the wrong scroll position is the
   * defect this fixes, so it must not be the fallback either.
   */
  function openRequest(request: AttentionRequest): void {
    select(request.sessionId)
    void nextTick(() => {
      if (pane.value?.focus(request.itemId) !== true) say(OPEN_REQUEST_MISSED)
    })
  }

  return {
    goToTheWork,
    openRequest,
    decideFromOverview,
    heldHere,
  }
}
