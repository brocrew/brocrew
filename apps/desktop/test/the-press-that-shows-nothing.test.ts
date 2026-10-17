import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import {
  answeredFromHere,
  attentionQueue,
  type AttentionRequest,
} from '../src/renderer/src/lib/attention'
import { homeAttention } from '../src/renderer/src/lib/home-attention'
import {
  personsQueueView,
  type PersonsQueueWorld,
  type NoAnswerHere,
} from '../src/renderer/src/lib/persons-queue'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import { requestDraft, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  NOTHING_NAMED_THE_WORK,
  chainReading,
  chainSentence,
  escalationChain,
  type LedgerWalk,
  type PersonsDecision,
  type PersonsQuestion,
  type RoutedRequest,
  aPersonsSince,
} from '../src/shared/questions'
import type {
  AnswerAck,
  PersistedEventInfo,
  ResumedSession,
  RuntimeBridge,
  RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * 🔴 **468 · the press that shows nothing for five seconds — and the five seconds were not blank.**
 *
 * ## ⛔ What `453` weak point 1 said, and what the code says
 *
 * `453` reported the lag honestly and `persons-queue.test.ts` §9.5 pins it: *"a row settled here is
 * still in the view until a look says otherwise"*. ⚠️ **That test supplies `settle: () => {}`** — a
 * stub — so nothing it drives ever reaches the store, and what it measures is that this module
 * holds no dismissed-list. ⛔ **It is not a measurement of what a person sees**, and the brief's
 * reading of it — *"for up to five seconds the act has no visible result where it was performed"* —
 * is false of the shipped app in the first tick and true of it afterwards, for a reason nobody had
 * written down.
 *
 * ## 🔴 The three phases of one press, measured here
 *
 * | when | what the row does | §  |
 * |---|---|---|
 * | the click, same tick | the buttons go and *"An answer is already on its way"* replaces them | §1 |
 * | the host answers · `taken` | the card here closes, the row stays, and it said **the wrong thing** | §2 |
 * | the host answers · `refused` + `stillOpen` | the buttons come back — and said **nothing at all** | §4 |
 *
 * ⚑ **`207` M2 already shipped phase one.** `markSent` writes the record's own draft flag BEFORE
 * the first await, `attentionQueue` reads it, and the fold reads it before the offer. So the
 * dispatch's option **A** — *the press reports its own result* — is not a thing to build; it is a
 * thing to MEASURE, and §1 is the first test in this repository that measures it as a rendered
 * fact rather than as a fold value.
 *
 * ⛔ **What was not built is the rest of the window**, and §2 is the defect: once the host's
 * `user_decision` lands, `isAwaitingAnswer` goes false, the request leaves `attentionQueue`, and a
 * row for a conversation this window HOLDS fell into `'not-in-this-window'` — *"open it to answer"*
 * — about a card the person had answered a moment earlier from that very row. **A false instruction
 * is worse than silence.**
 */

/* ───────────────────────────────────────────────────────────────────── the fixtures ───────── */

const NOW = 1_700_000_000_000
const SESSION = 'sess_worker'
const REQUEST = 'req_1'
const KEY = `${SESSION}:${REQUEST}`

/** One pending permission card, exactly as the wire carries one. */
const PENDING: PersistedEventInfo[] = [
  { ordinal: 0, at: NOW - 2_000, event: { type: 'hello', text: 'run it' } as never },
  {
    ordinal: 1,
    at: NOW - 1_000,
    event: {
      type: 'permission_request',
      id: REQUEST,
      kind: 'command',
      action: 'run a command',
      detail: 'ls',
      scope: {
        cwd: '/work',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    },
  },
]

function handover(): ResumedSession {
  return {
    hasACommander: false,
    sessionId: SESSION,
    provider: 'claude',
    cwd: '/work/worker',
    providerHome: '/homes/claude',
    profileId: 'default',
    instructions: {
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [],
      note: '',
      recallsReported: false,
      writesReported: false,
      composed: null,
    },
    ref: { provider: 'claude', sessionId: `${SESSION}-ref`, cwd: '/work/worker', rotation: 0 },
    config: { home: '/homes/claude', homeEnv: 'X', model: 'm', authNote: null, files: [] },
    approvalMode: 'ask',
    pendingApprovalMode: null,
    approvalNote: 'approvals: ask',
    blanketGrants: [],
    planNeedsGoAhead: false,
    settings: {
      model: null,
      pendingModel: null,
      reasoningEffort: null,
      pendingReasoningEffort: null,
      planMode: false,
      pendingPlanMode: null,
    },
    queued: [],
    liveness: { state: 'live', since: NOW },
    history: { entries: PENDING, from: 0, hasOlder: false, turnAligned: true },
    handover: 'attached',
  } as unknown as ResumedSession
}

/**
 * ⛔ **A bridge whose answer this test HOLDS OPEN**, which is the whole instrument.
 *
 * ⚠️ **`assert-in-the-gap-not-after-the-repair`:** `markSent` sets the flag and `noteAnswer` takes
 * it off again, so a test that awaited the press and then looked would see the repaired state and
 * could not tell it from a press that never set anything. The door's promise is handed back here
 * as a deferred, so the assertion lands between the two writes.
 */
function bridgeHolding(): {
  bridge: RuntimeBridge
  answer: (ack: AnswerAck) => void
  emit: (message: RuntimeEventMessage) => void
} {
  let settle: ((ack: AnswerAck) => void) | null = null
  let listener: ((message: RuntimeEventMessage) => void) | null = null
  // ⛔ **Over a REAL wire** (361 §2, `the-bridge-that-clones-nothing.test.ts` §6). An in-process
  // double passes a Vue proxy straight through, so a press that handed the bridge a reactive
  // object would be green here and reject with `DataCloneError` in the shipped app. ⚑ This file
  // joined that census's derived roster the moment it built a store, and the census said so.
  const bridge = everythingOverTheWire({
    claim: async () => handover(),
    respondPermission: () =>
      new Promise<AnswerAck>((resolve) => {
        settle = resolve
      }),
    onEvent: (fn: (message: RuntimeEventMessage) => void) => {
      listener = fn
      return () => {
        listener = null
      }
    },
    onLiveness: () => () => {},
    attachOpen: async () => [],
  }) as unknown as RuntimeBridge
  return {
    bridge,
    answer: (ack) => {
      if (settle === null) throw new Error('nothing was pressed')
      settle(ack)
    },
    emit: (message) => listener?.(message),
  }
}

/** How a conversation is named on a row, exactly as `persons-queue.test.ts` names one. */
const NAME = (id: string): string => id.replace('sess_', '')

/**
 * The ledger walk a look returns, holding the one row this file presses.
 *
 * ⚠️ **The walk is a SNAPSHOT and that is the subject**: every case below hands the fold this same
 * five-second-old answer and varies only the live world around it, which is exactly the asymmetry
 * `453` weak point 1 is about.
 */
function walkWithTheRow(): LedgerWalk<PersonsQuestion> {
  const request: RoutedRequest = {
    requestId: REQUEST,
    askedBy: SESSION,
    parent: 'sess_pm',
    went: { is: 'the-parent', to: 'the-parent' },
    at: NOW - 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: NOW - 500,
  }
  const chain = escalationChain(request, () => null)
  return {
    rows: [
      {
        request,
        // ⚑ **611 · when it became a person's** — see PersonsQuestion.aPersonsSince.
        aPersonsSince: aPersonsSince(request),
        chain,
        reading: chainReading(chain, NAME),
        sentence: chainSentence(chain, NAME),
        work: [],
        // ⚑ **474 · a provider-raised question names no work** — see `AboutWork`.
        about: NOTHING_NAMED_THE_WORK,
        // ⚑ **602 · and the arm that goes with it** — see `HowItWasRaised`.
        raisedBy: 'the-provider',
        // ⚑ **619 · a provider-raised question is answered on its card.**
        offered: null,
        asked: null,
      },
    ],
    walk: 'every-conversation-that-routed',
    ledgers: 1,
    rowsUnread: 0,
  }
}

const NOTHING: LedgerWalk<PersonsDecision> = {
  rows: [],
  walk: 'every-conversation-that-routed',
  ledgers: 1,
  rowsUnread: 0,
}

function worldOf(
  records: readonly SessionRecord[],
  live: readonly AttentionRequest[],
): PersonsQueueWorld {
  return {
    held: new Set(records.map((record) => record.sessionId)),
    answerable: new Map(live.map((request) => [request.key, request])),
    answeredFromHere: answeredFromHere(records),
    now: NOW,
    lastLookAnswered: { questions: true, decisions: true },
  }
}

/** The one row this file is about, folded the way both surfaces fold it. */
function theRow(records: readonly SessionRecord[]) {
  const live = attentionQueue(records, () => 'waiting: permission')
  const view = personsQueueView(walkWithTheRow(), NOTHING, worldOf(records, live))
  if (view === null) throw new Error('the queue did not answer')
  const row = view.rows[0]
  if (row === undefined) throw new Error('the row that was pressed is gone')
  return { row, view, live }
}

async function aWindowHoldingThePendingCard(): Promise<{
  store: ReturnType<typeof createSessionStore>
  answer: (ack: AnswerAck) => void
  emit: (message: RuntimeEventMessage) => void
  records: () => readonly SessionRecord[]
}> {
  const { bridge, answer, emit } = bridgeHolding()
  const store = createSessionStore(bridge)
  await store.claim(SESSION)
  return { store, answer, emit, records: () => store.live.value }
}

/* ═══════════════════════════ §1 · the press answers in the tick it is made ══════════════════ */

describe('§1 · the press is answered in ONE tick, and this is where that is measured', () => {
  it('🔴 the buttons go and the reason replaces them BEFORE the host has said anything', async () => {
    const { store, records } = await aWindowHoldingThePendingCard()

    // ⚑ **The control, and it is the same call one fact over** (standing rule 3). Before the press
    // the row offers exactly what the card offers.
    const before = theRow(records())
    expect(before.row.answers.map((one) => one.label)).toEqual(['Allow', 'Deny'])
    expect(before.row.noAnswerHere).toBeNull()

    // ⛔ **Not awaited.** The promise this returns is held open by the fake; every assertion below
    // lands while the press is in flight, which is the only window the claim is about.
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    await nextTick()

    const during = theRow(records())
    expect(during.row.answers).toEqual([])
    expect(during.row.noAnswerHere).toBe<NoAnswerHere>('answer-sent')
    // ⚠️ **And the ROW IS STILL THERE**, which is `453`'s weak point and stays true: the ledger
    // decides when it leaves and the ledger has not been asked again.
    expect(during.view.rows.map((one) => one.key)).toEqual([KEY])
    expect(during.view.count).toBe(1)
  })

  it('⛔ nothing was remembered to do it · the flag is the SESSION RECORD’s, not the queue’s', async () => {
    const { store, records } = await aWindowHoldingThePendingCard()
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    await nextTick()

    // 🔴 The queue is a pure fold over what it is handed; the fact lives one layer down, on the
    // draft `markSent` writes. A test that read it off the view could not tell the two apart.
    expect(store.get(SESSION)?.requests.get(REQUEST)?.sent).toBe(true)
    // ⚑ **Hand the SAME fold a world with no live row and the answer changes**, which is what
    // makes this a read rather than a memory.
    const forgotten = personsQueueView(walkWithTheRow(), NOTHING, {
      ...worldOf(records(), []),
      answeredFromHere: new Set<string>(),
    })
    expect(forgotten?.rows[0]?.noAnswerHere).toBe<NoAnswerHere>('not-in-this-window')
  })
})

/* ═════════════ §2 · the rest of the five seconds, which is what 468 is actually about ═══════ */

describe('§2 · once the card here closes, the row must not send a person back to it', () => {
  it('🔴 a card this window answered says so, instead of “open it to answer”', async () => {
    const { store, answer, emit, records } = await aWindowHoldingThePendingCard()
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    answer({ outcome: 'taken' })
    await nextTick()

    // ⛔ **The host's own event, which is what really closes the card** — not the ack. See
    // `AnswerAck`'s docblock: *"Whatever it means for the card arrives on the event stream."*
    emit({
      sessionId: SESSION,
      ordinal: 2,
      at: NOW,
      event: { type: 'user_decision', requestId: REQUEST, outcome: 'allow' } as never,
    })
    await nextTick()

    // The live projection has dropped it: `isAwaitingAnswer` is false.
    const { row, live } = theRow(records())
    expect(live.map((one) => one.key)).toEqual([])
    expect(row.alsoOnScreen).toBe(false)
    // 🔴 **THE FIX.** Before 468 this read `'not-in-this-window'`, whose sentence is
    // *"…open it to answer"* — about a card that was answered from this row.
    expect(row.noAnswerHere).toBe<NoAnswerHere>('no-longer-waiting')
  })

  it('⛔ and the OTHER absence keeps its own sentence · a card this window never pressed', async () => {
    const { records } = await aWindowHoldingThePendingCard()
    // ⚑ **The paired positive** (standing rule 3): same fold, same held conversation, same empty
    // live projection — and the one fact that differs is whether this window sent an answer.
    const never = personsQueueView(walkWithTheRow(), NOTHING, {
      ...worldOf(records(), []),
      answeredFromHere: new Set<string>(),
    })
    expect(never?.rows[0]?.noAnswerHere).toBe<NoAnswerHere>('not-in-this-window')

    const pressed = personsQueueView(walkWithTheRow(), NOTHING, {
      ...worldOf(records(), []),
      answeredFromHere: new Set([KEY]),
    })
    expect(pressed?.rows[0]?.noAnswerHere).toBe<NoAnswerHere>('no-longer-waiting')
  })

  it('⚠️ a conversation this window does NOT hold is untouched by any of it', async () => {
    const { records } = await aWindowHoldingThePendingCard()
    const stranger = personsQueueView(walkWithTheRow(), NOTHING, {
      ...worldOf(records(), []),
      held: new Set<string>(),
      answeredFromHere: new Set<string>(),
    })
    // ⛔ `not-yours-yet` is the ORDINARY state of the population `403` built this for, and 468 must
    // not have moved it: a window that holds nothing has answered nothing.
    expect(stranger?.rows[0]?.noAnswerHere).toBe<NoAnswerHere>('not-yours-yet')
  })
})

/* ════════════ §3 · the derivation itself, which is a READ and not a memory ══════════════════ */

describe('§3 · answeredFromHere keys what this window SENT, and nothing else', () => {
  it('🔴 the key is the QUEUE ROW’s — session and request, joined', async () => {
    const { store } = await aWindowHoldingThePendingCard()
    // ⛔ **Empty before the press**, which is the control: a set that always answered the row's key
    // would pass every case below.
    expect([...answeredFromHere(store.live.value)]).toEqual([])
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    await nextTick()
    // ⚠️ **The whole key and not the request id.** Two conversations can be handed the same
    // provider request id — `itemKey`'s own note says both adapters refuse it and that the
    // hardening is worth its cost anyway — and a set keyed on the id alone would answer
    // `'no-longer-waiting'` for a row in the conversation NEXT to the one that was pressed.
    expect([...answeredFromHere(store.live.value)]).toEqual([`${SESSION}:${REQUEST}`])
  })

  /**
   * 🔴 **The set unlearns only a refusal that leaves the card OPEN, and the row is answerable.**
   *
   * ⛔ **The first draft read `RequestDraft.sent` so that it WOULD unlearn**, and that was the
   * defect: `sent` comes off on every failure, including the refusals that close the card, so the
   * cards that most needed *"no longer waiting"* were the ones dropped out of the set. ⚑ **UI-009**
   * — a refusal that leaves the card open puts the request back on the table, so it comes out of
   * the set (*Waiting on you*'s question card reads it as *answer sent*); and **the set is never
   * consulted while the live request is still there**, which this case measures on both sides.
   */
  it('⛔ a refusal that leaves the card open takes the key back — and the row offers its buttons', async () => {
    const { store, answer, records } = await aWindowHoldingThePendingCard()
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    await nextTick()
    expect(answeredFromHere(store.live.value).has(KEY)).toBe(true)

    answer({ outcome: 'refused', reason: 'that answer was not usable', stillOpen: true })
    await nextTick()
    await nextTick()
    // ⚑ **UI-009 · out of the set** — the request is back on the table, so nothing here acted on it.
    expect(answeredFromHere(store.live.value).has(KEY)).toBe(false)
    // 🔴 **And the row is answerable**, because `live` is defined and the set is read only in the
    // arm where it is not. ⛔ A set that decided what a person may press would be the
    // dismissed-list `persons-queue.ts` forbids by name; this one decides nothing.
    const { row } = theRow(records())
    expect(row.answers.map((one) => one.label)).toEqual(['Allow', 'Deny'])
    expect(row.noAnswerHere).toBeNull()
  })

  it('⚑ a window holding nothing answers the empty set', () => {
    expect([...answeredFromHere([])]).toEqual([])
  })

  /**
   * 🔴 **A draft that EXISTS is not a draft that was answered**, and the mutation run is what
   * asked for this case: swapping the predicate for `true` survived every assertion above, because
   * every draft this file had made had also been pressed.
   *
   * ⛔ **The state is ordinary, not contrived.** `requestDraft` is what `UserInputCard` calls the
   * moment somebody types into a question, and `061` finding 8 is the whole reason the draft lives
   * on the record rather than in the component. A window where a person began an answer and did
   * not send it must not have that card reported as settled.
   */
  it('⛔ a draft a person only TYPED into is not answered · the row keeps its way in', async () => {
    const { store, records } = await aWindowHoldingThePendingCard()
    const record = store.get(SESSION)
    // ⚠️ **`null`, not `undefined`** — `SessionStore.get` answers `SessionRecord | null`, and
    // vitest cannot see the difference because the value is there either way. `vue-tsc` can.
    if (record === null) throw new Error('the conversation was not handed over')
    // What a card does on the first keystroke — the draft appears, and nothing has been sent.
    requestDraft(record, REQUEST).answers.set('q1', 'half an answer')
    await nextTick()

    expect(record.requests.has(REQUEST)).toBe(true)
    expect([...answeredFromHere(store.live.value)]).toEqual([])
    // ⚑ …and the row that goes with it still names the way in, rather than telling a person to
    // wait for a list to catch up with a press nobody made.
    const paged = personsQueueView(walkWithTheRow(), NOTHING, {
      ...worldOf(records(), []),
    })
    expect(paged?.rows[0]?.noAnswerHere).toBe<NoAnswerHere>('not-in-this-window')
  })
})

/* ═══════════════ §4 · the answer that bounced, which said nothing at all ════════════════════ */

describe('§4 · a refusal the host left open comes back with its reason', () => {
  it('🔴 the buttons return AND the sentence the card got is on the row', async () => {
    const { store, answer, records } = await aWindowHoldingThePendingCard()
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    await nextTick()
    expect(theRow(records()).row.noAnswerHere).toBe<NoAnswerHere>('answer-sent')

    answer({ outcome: 'refused', reason: 'that answer was not usable', stillOpen: true })
    await nextTick()
    await nextTick()

    const { row } = theRow(records())
    // ⛔ **Answerable again** — `noteAnswer` puts the request back on the table, which is 064's
    // half of 146's fix and is why the buttons return.
    expect(row.answers.map((one) => one.label)).toEqual(['Allow', 'Deny'])
    expect(row.noAnswerHere).toBeNull()
    // 🔴 **And it no longer returns in silence.** Before 468 this was `null` and the host's
    // sentence reached the card alone.
    expect(row.refused).toBe('that answer was not usable')
  })

  /**
   * 🔴 **The THIRD outcome, and this dispatch's first draft could not say it.**
   *
   * ⛔ **A refusal that SETTLES the card** — `not-pending` or `not-offered` — writes `item.note`,
   * so `isAwaitingAnswer` goes false and the request leaves the
   * live projection exactly as a taken one does. ⚠️ **The first draft read `RequestDraft.sent`**,
   * which `noteAnswer` clears on every failure, so the key was taken back OUT of
   * `answeredFromHere` at the same instant the card became unanswerable — and the row fell back to
   * *"open it to answer"*, about a card that is over, in the staleness window this dispatch is
   * named for. ⚑ `RequestDraft.answered` is the split that fixes it, and this case is what
   * measures it.
   */
  it('🔴 a refusal that CLOSES the card says the card is over — not “open it to answer”', async () => {
    const { store, answer, records } = await aWindowHoldingThePendingCard()
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    await nextTick()

    answer({
      outcome: 'refused',
      reason: 'the agent is no longer waiting for an answer to this',
      stillOpen: false,
    })
    await nextTick()
    await nextTick()

    // ⛔ **The in-flight guard came off** — 064's rule, untouched by 468 — which is exactly what
    // made the first draft wrong.
    expect(store.get(SESSION)?.requests.get(REQUEST)?.sent).toBe(false)
    // ⚑ …and the other half did not, which is the whole of the split.
    expect(store.get(SESSION)?.requests.get(REQUEST)?.answered).toBe(true)

    const { row, live } = theRow(records())
    // The card is settled: `markRequestFailed` wrote a note, so nothing awaits.
    expect(live.map((one) => one.key)).toEqual([])
    expect(row.noAnswerHere).toBe<NoAnswerHere>('no-longer-waiting')
    // 🔴 **And the row carries no *press again* sentence**, because there is nothing to press —
    // `markRequestFailed` nulls `item.refused` and the host's words are on the card.
    expect(row.refused).toBeNull()
  })

  it('⛔ a taken answer puts no sentence anywhere · the control for the row above', async () => {
    const { store, answer, records } = await aWindowHoldingThePendingCard()
    void store.respondPermission(SESSION, REQUEST, { outcome: 'allow' })
    answer({ outcome: 'taken' })
    await nextTick()
    await nextTick()
    // ⚑ Non-vacuity: the same fold, the same press, one different ack — and nothing is said,
    // because nothing bounced.
    expect(theRow(records()).row.refused).toBeNull()
  })
})

/* ══════════════════════════ §5 · the badge nothing could clear ══════════════════════════════ */

describe('§5 · a NEEDS YOU that can reach zero', () => {
  it('⛔ a real thing still forbids quiet', () => {
    const home = homeAttention({ requests: [], onlyYou: 2, unread: false })
    expect(home.total).toBe(2)
    expect(home.quiet).toBe(false)
    expect(home.stat).toBe('2 items')
    expect(home.intro).toContain('2 items below')
  })

  /**
   * ⚠️ **`086`'s RULE**: a list that could not be read is not an all-clear, however empty the
   * rows it did read.
   */
  it('⚠️ a list that could not be READ still forbids quiet', () => {
    const home = homeAttention({ requests: [], onlyYou: 0, unread: true })
    expect(home.quiet).toBe(false)
    expect(home.stat).toBe('Not known')
    expect(home.intro).toContain('could not be read just now')
  })

  it('⚑ a live request draws the answer-here arm', () => {
    const home = homeAttention({ requests: [{ key: 'a' } as never], onlyYou: 0, unread: false })
    expect(home.intro).toBe('Answer here, or open the card for the full disclosure.')
  })

  it('🔴 nothing real: All clear', () => {
    const home = homeAttention({ requests: [], onlyYou: 0, unread: false })
    expect(home.quiet).toBe(true)
    expect(home.stat).toBe('All clear')
    expect(home.statTone).toBe('ok')
    expect(home.intro).toBe('Nothing here is blocked on an answer from you.')
  })
})

/* ═════════ §6 · the one line that wires it into the running app, read as source ══════════════ */

/**
 * ⛔ **`RuntimeScreen.vue` is mounted by nothing but `App.vue`**, so the wiring between the
 * derivation and the surface is reachable only as text — `persons-queue.test.ts` §7's own reason,
 * on the line `468` added. ⚠️ Without this, the sole call site of `answeredFromHere` in the
 * shipped app is a line no test and no mutation row can see: every case above hands the fold a
 * world it built itself.
 */
const SCREEN = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
  'utf8',
)

describe('§6 · the screen derives it from its own records and hands it to the queue', () => {
  it('🔴 the world it supplies carries the set, and the set comes from `answeredFromHere`', () => {
    expect(SCREEN).toContain('answeredFromHere: answered.value')
    expect(SCREEN).toContain('const answered = computed(() => answeredFromHere(store.live.value))')
  })

  it('⛔ and it is the shared derivation, not a copy · the census the 462 shape would have missed', () => {
    // ⚠️ **Import AND call**, which `the-bridge-that-clones-nothing.test.ts` §6 spells out: an
    // unused import passes an import census, and lint is not a gate the mutation harness runs.
    expect(SCREEN).toMatch(
      /import \{[\s\S]*?\bansweredFromHere\b[\s\S]*?\} from '\.\.\/lib\/attention'/,
    )
    // ⛔ **`store.live`, never a second projection.** A screen that walked its own records here
    // would be a derivation free to disagree with the one `attention.ts` exports.
    expect(SCREEN).not.toMatch(/for \(const \[requestId, draft\] of record\.requests\)/)
  })
})
