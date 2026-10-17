import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isProxy, nextTick } from 'vue'
import {
  answerFor,
  attentionQueue,
  type AttentionDecision,
  type AttentionRequest,
} from '../src/renderer/src/lib/attention'
import { permissionDecisionFor } from '../src/renderer/src/lib/permission-offer'
import {
  createPersonsQueue,
  type NoAnswerHere,
  type PersonsQueueWorld,
} from '../src/renderer/src/lib/persons-queue'
import {
  answerNeverLeftThisWindow,
  createSessionStore,
} from '../src/renderer/src/lib/session-store'
import type { SessionRecord } from '../src/renderer/src/lib/session-record'
import { isAwaitingAnswer, type PermissionOutcome } from '../src/renderer/src/lib/transcript'
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
import { asTheWireWouldCarry, everythingOverTheWire } from './lib/the-wire'

/**
 * # 🔴 The press that cloned nothing (473, from `469`'s criterion-17 measurement)
 *
 * ## ⛔ What a person got
 *
 * `469` drove the ordinary spawned-child path end to end — **Take it over**, then **Deny** — and
 * the press did nothing at all, silently:
 *
 * | the screen said | the truth |
 * |---|---|
 * | the card read **Not answered** | the child ledger held **zero** `user_decision` rows |
 * | actions, pending, panel and live all → **0** | the provider was still `waiting_permission` |
 * | Home returned to **1 item** | the next real queue look retained the durable permission row |
 *
 * ⚠️ *"That is an error projection, not a settlement."*
 *
 * ## 🔴 Two defects, and they are independent
 *
 *  - **The payload.** `createPersonsQueue` keeps `PersonsQueueWorld` in Vue's deep `ref`, so every
 *    OBJECT the queue hands back is a `Proxy`. `answerFor` returned the permission as
 *    `{ permission: decision.decision }` — the nested object, by reference — and Electron cannot
 *    structured-clone one, so `ipcRenderer.invoke` rejected before `ipcMain` existed. ⛔ **Its
 *    proposal arm never had this problem**, because that arm reads a boolean and builds its own
 *    literal; the asymmetry was the whole defect. §1 and §2.
 *  - **The projection.** `noteAnswer` read a REJECTED call as a settlement and wrote `note`, which
 *    `isAwaitingAnswer` reads as *over* — so the card, the count, the panel, the live queue and
 *    Home all retired a request the provider was still frozen on. §3 and §4.
 *
 * ## ⚑ Why this file exists instead of a case in an older one
 *
 * ⛔ **A test bridge clones nothing** — `the-bridge-that-clones-nothing.test.ts` is the whole
 * argument — so an in-process double would have passed the `Proxy` straight through and been green
 * on the shipped defect. ⚠️ **And neither half on its own was enough**, which is why the two files
 * nearest this one both missed it: `persons-queue.test.ts` drives the real reactive
 * `createPersonsQueue` and presses `settle`, but its door is a STUB that carries the decision
 * nowhere; `the-press-that-shows-nothing.test.ts` drives a real store over a real wire, but folds
 * its rows with `personsQueueView`, which never puts a world through Vue. ⛔ **The defect lives in
 * the join**: a decision that is reactive BECAUSE the queue held it, carried as far as the clone.
 * 🔴 **Every press below goes through the real `createPersonsQueue`, the real `createSessionStore`
 * and `everythingOverTheWire` — which is `structuredClone`, the algorithm Electron documents by
 * name — so both halves are in one gesture.**
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

function handover(entries: PersistedEventInfo[] = PENDING): ResumedSession {
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
    history: { entries, from: 0, hasOlder: false, turnAligned: true },
    handover: 'attached',
  } as unknown as ResumedSession
}

const NAME = (id: string): string => id.replace('sess_', '')

/** The five-second-old ledger answer the person's queue draws its rows from. */
function walkOver(requestIds: readonly string[]): LedgerWalk<PersonsQuestion> {
  return {
    rows: requestIds.map((requestId) => {
      const request: RoutedRequest = {
        requestId,
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
        request,
        // ⚑ **611 · when it became a person's** — see PersonsQuestion.aPersonsSince.
        aPersonsSince: aPersonsSince(request),
        chain,
        reading: chainReading(chain, NAME),
        sentence: chainSentence(chain, NAME),
        work: [],
        // ⚑ **474 · no `taskId` on these rows, so no work is named** — see the same note in
        // `every-answer-through-the-persons-queue.test.ts`.
        about: NOTHING_NAMED_THE_WORK,
        // ⚑ **602 · provider-raised, which is what a row with a live card in this window is** —
        // see `HowItWasRaised`.
        raisedBy: 'the-provider',
        // ⚑ **619 · a provider-raised question is answered on its card.**
        offered: null,
        asked: null,
      }
    }),
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

function worldOf(live: readonly AttentionRequest[]): PersonsQueueWorld {
  return {
    held: new Set([SESSION]),
    answerable: new Map(live.map((request) => [request.key, request])),
    answeredFromHere: new Set<string>(),
    now: NOW,
    lastLookAnswered: { questions: true, decisions: true },
  }
}

/**
 * 🔴 **The person's queue the WINDOW uses, not the fold a test can reach around it.**
 *
 * ⛔ `createPersonsQueue` assigns each supplied world into a deep `ref`, which is the one line that
 * turns every nested object in `answerable` into a `Proxy` — `persons-queue.ts:1383-1414`. ⚑ The
 * rows come back out of the `computed`, which is exactly what `PersonsQueue.vue` renders and what
 * `RuntimeScreen.settleFromTheQueue` hands to `answerFor`.
 */
function rowsFromTheRealQueue(live: readonly AttentionRequest[]): {
  answersFor: (requestId: string) => readonly AttentionDecision[]
  noAnswerFor: (requestId: string) => NoAnswerHere | null
  settle: (requestId: string, decision: AttentionDecision) => void
  pressed: { key: string; decision: AttentionDecision }[]
} {
  const queue = createPersonsQueue()
  const pressed: { key: string; decision: AttentionDecision }[] = []
  queue.supply(walkOver(live.map((one) => one.requestId)), NOTHING, worldOf(live), {
    travel: () => {},
    settle: (row, decision) => pressed.push({ key: row.key, decision }),
    takeOver: () => {},
    open: () => {},
  })
  const rowFor = (
    requestId: string,
  ): {
    key: string
    answers: readonly AttentionDecision[]
    noAnswerHere: NoAnswerHere | null
  } => {
    const row = queue.view.value?.rows.find((one) => one.key === `${SESSION}:${requestId}`)
    if (row === undefined) throw new Error(`the queue has no row for ${requestId}`)
    return row
  }
  return {
    answersFor: (requestId) => rowFor(requestId).answers,
    noAnswerFor: (requestId) => rowFor(requestId).noAnswerHere,
    settle: (requestId, decision) => {
      const row = queue.view.value?.rows.find((one) => one.key === `${SESSION}:${requestId}`)
      if (row === undefined) throw new Error(`the queue has no row for ${requestId}`)
      queue.settle(row, decision)
    },
    pressed,
  }
}

/** An `AttentionRequest` carrying ONE decision — the vehicle §1 puts each arm into the queue on. */
function requestCarrying(requestId: string, decision: AttentionDecision): AttentionRequest {
  return {
    key: `${SESSION}:${requestId}`,
    sessionId: SESSION,
    requestId,
    itemId: `item_${requestId}`,
    kind: 'permission',
    where: 'worker',
    hasACommander: false,
    provider: 'claude',
    profileId: null,
    who: null,
    standing: 'waiting: permission',
    asked: 'run a command',
    scope: [],
    underDisclosed: false,
    detailOmitted: null,
    // ⚑ **487 · null is a request that CAN be allowed** — the sentence is only for one that cannot.
    noPositive: null,
    at: NOW - 1_000,
    decisions: [decision],
    limit: null,
    sent: false,
    refused: null,
  }
}

/**
 * ⛔ **A window whose bridge is a WIRE**, and what crossed it.
 *
 * ⚑ `everythingOverTheWire` runs `structuredClone` over every argument and hands the FAR side the
 * copy, which is what `ipcRenderer.invoke` does — so a payload this refuses is a payload the
 * shipped app refuses, and a payload it delivers arrives as a copy rather than by reference.
 */
function windowOverAWire(
  answer: () => Promise<AnswerAck> = async () => ({ outcome: 'taken' }),
  entries: PersistedEventInfo[] = PENDING,
): {
  store: ReturnType<typeof createSessionStore>
  seen: unknown[]
  emit: (message: RuntimeEventMessage) => void
} {
  const seen: unknown[] = []
  let listener: ((message: RuntimeEventMessage) => void) | null = null
  const bridge = everythingOverTheWire({
    claim: async () => handover(entries),
    respondPermission: (input: unknown) => {
      seen.push(input)
      return answer()
    },
    respondUserInput: (input: unknown) => {
      seen.push(input)
      return answer()
    },
    onEvent: (fn: (message: RuntimeEventMessage) => void) => {
      listener = fn
      return () => {
        listener = null
      }
    },
    onLiveness: () => () => {},
    attachOpen: async () => [],
  }) as unknown as RuntimeBridge
  return { store: createSessionStore(bridge), seen, emit: (message) => listener?.(message) }
}

/**
 * ⛔ **A wire whose answer this test HOLDS OPEN**, so an assertion can land BETWEEN the press and
 * the record — `assert-in-the-gap-not-after-the-repair`. ⚑ `468`'s instrument, one file over.
 */
function windowHoldingItsAnswer(): {
  store: ReturnType<typeof createSessionStore>
  seen: unknown[]
  answer: (ack: AnswerAck) => void
  emit: (message: RuntimeEventMessage) => void
} {
  let settle: ((ack: AnswerAck) => void) | null = null
  const held = new Promise<AnswerAck>((resolve) => {
    settle = resolve
  })
  const window = windowOverAWire(() => held)
  return {
    ...window,
    answer: (ack) => {
      if (settle === null) throw new Error('nothing was pressed')
      settle(ack)
    },
  }
}

/** The card, off the fold both the pane and the queue read. */
function cardOf(record: SessionRecord): {
  note: string | null
  refused: string | null
  awaiting: boolean
} {
  const item = record.control.items.find((one) => one.kind === 'permission')
  if (item === undefined || item.kind !== 'permission') throw new Error('no permission card')
  return { note: item.note, refused: item.refused, awaiting: isAwaitingAnswer(item) }
}

/**
 * ⛔ **The five outcomes, enumerated by the compiler**, so no walk or loop below can go short the
 * day a sixth is added. ⚑ `Record<PermissionOutcome, true>` is `OUTCOME_LABEL`'s shape one file
 * over. ⚠️ Declared HERE, above §1, because `it.each` runs at collection time and a `const` read
 * before its own line is a TDZ error rather than a test.
 */
const EVERY_OUTCOME: Record<PermissionOutcome, true> = {
  allow: true,
  allow_for_session: true,
  allow_all_for_session: true,
  // ⚑ 736 · R95 — the sixth, and the compiler is what said so.
  allow_always: true,
  deny: true,
  cancel: true,
}

/* ══════════════ §1 · every arm of `answerFor`, classified — and driven out of the queue ═════ */

/**
 * 🔴 **`469`'s question answered for every arm, not for the one that broke.**
 *
 * ⛔ **`Record<AttentionDecision['kind'], …>`, so a sixth arm does not compile until somebody
 * classifies it** — the only enumeration this repo accepts, for `361` §1's reason.
 *
 * ⚠️ **The verdict is about the PAYLOAD, not the argument.** Every arm is handed a `Proxy` here;
 * what the table records is whether the value `answerFor` RETURNS contains an object it did not
 * build. ⚑ Three arms read a primitive off the proxy and write their own literal — *a string is a
 * string however it was read* — and one returned the nested object itself.
 */
const EVERY_ARM: Record<
  AttentionDecision['kind'],
  {
    /** The decision as a surface really offers it, before the queue makes it reactive. */
    offer: AttentionDecision
    /** ⛔ Whether this arm's own return value ever carried an object the call site did not build. */
    carriedAnObject: boolean
    /** What `answerFor` must produce — asserted after a real structured clone. */
    sends: unknown
  }
> = {
  permission: {
    offer: { kind: 'permission', label: 'Deny', decision: permissionDecisionFor('deny') },
    // 🔴 **THE DEFECT.** `{ permission: decision.decision }` — the nested object, by reference.
    carriedAnObject: true,
    sends: { permission: { outcome: 'deny' } },
  },
  answer: {
    offer: { kind: 'answer', label: 'the real one', questionId: 'q0', option: 'the real one' },
    // ⚑ A fresh literal over two STRINGS, and the key is computed from one of them.
    carriedAnObject: false,
    sends: { userInput: { kind: 'answer', answers: { q0: 'the real one' } } },
  },
  approve: {
    offer: { kind: 'approve', label: 'Approve', consent: 'access-for-this-turn' },
    carriedAnObject: false,
    sends: { userInput: { kind: 'answer', answers: {} } },
  },
  reject: {
    offer: { kind: 'reject', label: 'Reject' },
    carriedAnObject: false,
    sends: { userInput: { kind: 'reject' } },
  },
}

describe('§1 · every arm of `answerFor`, out of a genuinely reactive queue (473 §3)', () => {
  const arms = Object.entries(EVERY_ARM)
  const live = arms.map(([kind, arm]) => requestCarrying(`req_${kind}`, arm.offer))
  const queue = rowsFromTheRealQueue(live)

  it('⛔ the table enumerates the union rather than a subset somebody typed', () => {
    // Non-vacuity for the compile-time half: an `as` anywhere would let the record be short.
    expect(arms).toHaveLength(4)
    expect(arms.filter(([, arm]) => arm.carriedAnObject).map(([kind]) => kind)).toEqual([
      'permission',
    ])
  })

  /**
   * 🔴 **The column above, MEASURED** — because a table read back to itself is not a measurement.
   *
   * ⛔ **`carriedAnObject` says the arm's return value contains an object the call site did not
   * build**, and the only witness that survives the fix is IDENTITY: a value `answerFor` built
   * cannot be `===` anything the queue is holding, and a value it handed over is. ⚠️ **The clone
   * assertions below cannot say this on their own** — a producer that deep-copied the proxy would
   * carry fine and still be handing a shape somebody else decided.
   */
  it.each(arms)('🔴 the %s arm shares no object with what the queue handed it', (kind) => {
    const offered = queue.answersFor(`req_${kind}`)[0]
    if (offered === undefined) throw new Error('the queue offered nothing')
    const payload = answerFor(offered)
    // ⛔ Not a member of the payload is a Proxy — which is the property, stated as the property
    // rather than as its consequence at the wire.
    const proxies: string[] = []
    const walk = (value: unknown, at: string): void => {
      if (value === null || typeof value !== 'object') return
      if (isProxy(value)) proxies.push(at)
      for (const [key, member] of Object.entries(value)) walk(member, `${at}.${key}`)
    }
    walk(payload, kind)
    expect(proxies).toEqual([])
    // ⚑ **The permission arm's own witness**, and it is the line `473` changed: the returned
    // decision used to BE `offered.decision`.
    if (offered.kind === 'permission' && 'permission' in payload) {
      expect(payload.permission).not.toBe(offered.decision)
    }
  })

  /**
   * ⚑ **Every outcome, not just the one the fixture happens to offer.** `answerFor` reads
   * `decision.decision.outcome` off a `Proxy` and hands it to `permissionDecisionFor`; a mapping
   * that dropped, defaulted or swapped an outcome would be invisible with `deny` alone — and it
   * would be a cloneable, delivered, WRONG answer, which no clone guard can see.
   */
  it.each(Object.keys(EVERY_OUTCOME) as PermissionOutcome[])(
    '⚑ a queue row offering %s answers with that outcome and no other',
    (outcome) => {
      const request = requestCarrying(`req_${outcome}`, {
        kind: 'permission',
        label: outcome,
        decision: permissionDecisionFor(outcome),
      })
      const only = rowsFromTheRealQueue([request])
      const offered = only.answersFor(`req_${outcome}`)[0]
      if (offered === undefined) throw new Error('the queue offered nothing')
      expect(isProxy(offered)).toBe(true)
      expect(asTheWireWouldCarry('respondPermission', answerFor(offered))).toEqual({
        permission: { outcome },
      })
    },
  )

  it('🔴 the plant is real — what the queue hands back IS a Vue Proxy', () => {
    // ⛔ **The half without which every assertion below is made where both readings agree.** If the
    // queue handed back plain objects, a passthrough and a wire would give the same answer and this
    // file would measure nothing — which is exactly how the shipped defect stayed green.
    for (const [kind] of arms) {
      const offered = queue.answersFor(`req_${kind}`)[0]
      expect(isProxy(offered), `the queue handed back a plain ${kind} decision`).toBe(true)
    }
    // ⚑ …and the one nested object really is one too, one level down.
    const permission = queue.answersFor('req_permission')[0]
    expect(permission?.kind).toBe('permission')
    expect(isProxy(permission?.kind === 'permission' ? permission.decision : null)).toBe(true)
  })

  it.each(arms)('⚑ the %s arm sends a value a real structured clone carries', (kind, arm) => {
    const offered = queue.answersFor(`req_${kind}`)[0]
    if (offered === undefined) throw new Error('the queue offered nothing')
    // ⛔ The clone is the assertion: `asTheWireWouldCarry` throws exactly where `ipcRenderer.invoke`
    // would, and hands back the COPY the far side holds.
    const carried = asTheWireWouldCarry('respondPermission', answerFor(offered))
    expect(carried).toEqual(arm.sends)
  })

  /**
   * 🔴 **The paired negative, and it is the defect put back byte for byte.** Handing the SAME
   * proxied decision over — which is what `{ permission: decision.decision }` did — is refused by
   * the same wire that carried the fix one assertion up. ⛔ Without this the test above would pass
   * just as well against a wire that carried everything.
   */
  it('🔴 …and the nested object the permission arm used to hand over is refused', () => {
    const offered = queue.answersFor('req_permission')[0]
    if (offered?.kind !== 'permission') throw new Error('the queue offered no permission')
    let said = ''
    try {
      asTheWireWouldCarry('respondPermission', { permission: offered.decision })
    } catch (error) {
      said = error instanceof Error ? error.message : String(error)
    }
    expect(said).toContain('would not survive ipcRenderer.invoke')
    expect(said).toContain('Vue reactive Proxy')
    // ⚠️ And it names the field, so the diagnosis is not a category.
    expect(said).toContain('permission')
  })

  it('⚑ the door is reached with the row that was pressed, proxy and all', () => {
    const offered = queue.answersFor('req_permission')[0]
    if (offered === undefined) throw new Error('the queue offered nothing')
    queue.settle('req_permission', offered)
    expect(queue.pressed.map((one) => one.key)).toEqual([`${SESSION}:req_permission`])
    // ⛔ The door gets the LIVE decision — `settleFromTheQueue` re-looks-up the request and hands it
    // to `decideFromOverview`, which calls `answerFor`. Nothing plainer happens in between, which
    // is why the fix has to be in `answerFor` and not at the call site.
    expect(isProxy(queue.pressed[0]?.decision)).toBe(true)
  })
})

/* ═══════════ §2 · the whole press: a queue-origin permission reaches the far side ═══════════ */

describe('§2 · the Deny press crosses a real wire and arrives (473 §0, 469 F1)', () => {
  it('🔴 the payload the shipped app would have refused now arrives, as a COPY', async () => {
    const { store, seen } = windowOverAWire()
    await store.claim(SESSION)

    // ⛔ **The request comes off the STORE**, folded by `attentionQueue` from the real
    // `permission_request` event — not hand-written — so the decisions are the ones `attention.ts`
    // really builds for a card the provider really sent.
    const live = attentionQueue(store.live.value, () => 'waiting: permission')
    expect(live.map((one) => one.key)).toEqual([KEY])
    const queue = rowsFromTheRealQueue(live)
    const deny = queue.answersFor(REQUEST).find((one) => one.label === 'Deny')
    if (deny === undefined) throw new Error('the row does not offer Deny')
    expect(isProxy(deny)).toBe(true)

    // The two lines `RuntimeScreen.decideFromOverview` is.
    const answer = answerFor(deny)
    if (!('permission' in answer)) throw new Error('Deny is not a permission answer')
    await store.respondPermission(SESSION, REQUEST, answer.permission)

    expect(seen).toEqual([
      { sessionId: SESSION, requestId: REQUEST, decision: { outcome: 'deny' } },
    ])
    // ⚠️ **The half that says a wire ran rather than a passthrough**: the far side holds a copy.
    expect((seen[0] as { decision: unknown }).decision).not.toBe(answer.permission)
  })

  /**
   * ⛔ **The same press with the producer reverted** — `answerFor`'s old permission arm, written
   * out here rather than described — reaching the real store over the real wire.
   *
   * 🔴 **This is `469`'s gesture, and both of its halves.** Nothing reaches the far side, and the
   * card does NOT read as settled afterwards.
   */
  it('🔴 the pre-fix producer is refused at the bridge, and the card stays live', async () => {
    const { store, seen } = windowOverAWire()
    await store.claim(SESSION)
    const live = attentionQueue(store.live.value, () => 'waiting: permission')
    const queue = rowsFromTheRealQueue(live)
    const deny = queue.answersFor(REQUEST).find((one) => one.label === 'Deny')
    if (deny?.kind !== 'permission') throw new Error('the row does not offer Deny')

    // ⛔ `{ permission: decision.decision }`, which is the line this dispatch replaced.
    await store.respondPermission(SESSION, REQUEST, deny.decision)
    await nextTick()

    expect(seen, 'the wire delivered a payload the shipped app would have refused').toEqual([])
    const record = store.get(SESSION)
    if (record === null) throw new Error('the session is gone')
    // 🔴 **The projection `469` measured, now honest.** Before this dispatch the card acquired a
    // `note`, `isAwaitingAnswer` went false, and the request left the count, the panel, the live
    // queue and Home — while the provider sat on `waiting_permission`.
    expect(cardOf(record).awaiting).toBe(true)
    expect(cardOf(record).note).toBeNull()
    expect(cardOf(record).refused).toContain('could not be cloned')
    expect(attentionQueue(store.live.value, () => 'waiting: permission')).toHaveLength(1)
  })
})

/* ═════════════ §3 · what a person sees when a bridge call rejects (473 §2, 469 F2) ══════════ */

describe('§3 · a rejected answer is drawn as a rejection, not as a settlement', () => {
  it('🔴 the card keeps its buttons and says the answer did not arrive', async () => {
    const { store } = windowOverAWire(() => Promise.reject(new Error('the channel is gone')))
    await store.claim(SESSION)

    await store.respondPermission(SESSION, REQUEST, permissionDecisionFor('deny'))
    await nextTick()

    const record = store.get(SESSION)
    if (record === null) throw new Error('the session is gone')
    // ⛔ **The exact words, WRITTEN OUT** (169 §2) — a sentence a person reads, pinned rather than
    // described. ⚠️ **This compared the card against `answerNeverLeftThisWindow(…)` and nothing
    // else until this dispatch's own review**: both sides moved together, so the pair was true of
    // any sentence at all and `473` M6 — which drops the cause from it — was green against the
    // section its own gate map named.
    expect(cardOf(record).refused).toBe(
      'that answer did not reach the conversation, so it is still waiting — ' +
        'you can send it again: the channel is gone',
    )
    // ⚑ …and it is the function's, so the card and the sentence cannot come apart either.
    expect(cardOf(record).refused).toBe(answerNeverLeftThisWindow('the channel is gone'))
    expect(cardOf(record).note).toBeNull()
    // ⚑ Still countable, which is what keeps the composer frozen on a provider that is still
    // frozen.
    expect(cardOf(record).awaiting).toBe(true)
    // ⚑ …and answerable a second time: `064`'s in-flight guard came back off.
    expect(record.requests.get(REQUEST)?.sent).toBe(false)
    // ⚠️ The banner says so too, three paragraphs away — which is `148` L5 and is not the fix.
    expect(record.error).toContain('the channel is gone')
  })

  it('⚑ …and the row a person is looking at offers the answers again', async () => {
    const { store } = windowOverAWire(() => Promise.reject(new Error('the channel is gone')))
    await store.claim(SESSION)
    await store.respondPermission(SESSION, REQUEST, permissionDecisionFor('deny'))
    await nextTick()

    const live = attentionQueue(store.live.value, () => 'waiting: permission')
    const queue = rowsFromTheRealQueue(live)
    // ⛔ **The whole of criterion 17's clearing clause, from the other end.** A row whose answer
    // bounced is a row that can be answered — `noAnswerHere` is null and the words are on it.
    expect(queue.answersFor(REQUEST).map((one) => one.label)).toEqual(['Allow', 'Deny'])
    expect(live[0]?.refused).toBe(answerNeverLeftThisWindow('the channel is gone'))
  })

  /**
   * ⚑ **The paired positive, and without it §3 reads as *nothing ever settles a card*.** A refusal
   * the HOST classified as consuming the request still retires it, in the host's own words — which
   * is `146`'s rule and is untouched.
   */
  it('⚑ a refusal the host says consumed the request still settles the card', async () => {
    const { store } = windowOverAWire(async () => ({
      outcome: 'refused',
      reason: 'nobody is waiting for an answer to this any more',
      stillOpen: false,
    }))
    await store.claim(SESSION)

    await store.respondPermission(SESSION, REQUEST, permissionDecisionFor('deny'))
    await nextTick()

    const record = store.get(SESSION)
    if (record === null) throw new Error('the session is gone')
    expect(cardOf(record).note).toBe('nobody is waiting for an answer to this any more')
    expect(cardOf(record).refused).toBeNull()
    expect(cardOf(record).awaiting).toBe(false)
  })
})

/* ═══ §3a · standing rule 18: in flight is not DONE, and neither is it silence (473 relay 1) ══ */

/**
 * 🔴 **The PO's rule, and the line it draws** — standing rule §18, made standing by this defect:
 *
 * > **A surface may not report an act as DONE until the act is recorded.**
 *
 * ⛔ **It does NOT forbid reporting an act as IN FLIGHT**, and the relay says so in as many words
 * because the alternative is the silent five seconds `468` was dispatched to close. ⚑ `markSent`
 * writes the record's own draft flag BEFORE the first await, so the buttons go and *"An answer is
 * already on its way — waiting for the conversation to settle"* replaces them inside one tick.
 *
 * 🔴 **This section is the line itself, measured in one gesture**, because the two halves are one
 * press: the offer goes at once, and every COUNT waits for the ledger.
 *
 * | ⛔ forbidden | ⚑ required | where |
 * |---|---|---|
 * | *Not answered* on a call that never landed | *an answer is on its way* while in flight | §3, §3a |
 * | pending/panel/live at **0** before anything is recorded | counts moving when the ledger moves | §3a |
 */
describe('§3a · the press reports itself in flight, and nothing reports it done', () => {
  it('🔴 the offer goes in ONE tick and the count does not move until the ledger does', async () => {
    const { store, answer, emit } = windowHoldingItsAnswer()
    await store.claim(SESSION)

    const before = rowsFromTheRealQueue(
      attentionQueue(store.live.value, () => 'waiting: permission'),
    )
    expect(before.answersFor(REQUEST).map((one) => one.label)).toEqual(['Allow', 'Deny'])
    expect(before.noAnswerFor(REQUEST)).toBeNull()

    // ⛔ **Not awaited** — the wire is holding the answer, so every assertion below lands in the
    // gap between the press and the record.
    void store.respondPermission(SESSION, REQUEST, permissionDecisionFor('deny'))
    await nextTick()

    const record = store.get(SESSION)
    if (record === null) throw new Error('the session is gone')
    const during = rowsFromTheRealQueue(
      attentionQueue(store.live.value, () => 'waiting: permission'),
    )
    // ⚑ **IN FLIGHT, and said so** — `468`'s sentence, which §18 does not reopen.
    expect(during.answersFor(REQUEST)).toEqual([])
    expect(during.noAnswerFor(REQUEST)).toBe('answer-sent')
    // 🔴 **And DONE by nothing.** The card is still awaiting, so the count, the panel and the live
    // queue all still hold it — which is the row of the relay's table that `469` measured as `0`.
    expect(cardOf(record).awaiting).toBe(true)
    expect(cardOf(record).note).toBeNull()
    expect(record.control.pending.permissions).toBe(1)
    expect(attentionQueue(store.live.value, () => 'waiting: permission')).toHaveLength(1)

    // ⚠️ **The host's ACK is not the record either.** `AnswerAck` says the door took it; the
    // `user_decision` event is what says the ledger has it, and only that may close the card.
    answer({ outcome: 'taken' })
    await nextTick()
    expect(cardOf(record).awaiting).toBe(true)
    expect(record.control.pending.permissions).toBe(1)

    emit({
      sessionId: SESSION,
      ordinal: 2,
      at: NOW,
      event: { type: 'user_decision', requestId: REQUEST, outcome: 'deny' } as never,
    })
    await nextTick()
    // ⛔ …and NOW it is done, because now it is recorded.
    expect(cardOf(record).awaiting).toBe(false)
    expect(record.control.pending.permissions).toBe(0)
  })
})

/* ════════════════════ §4 · ONE producer of a permission wire value, measured ════════════════ */

const HERE = dirname(fileURLToPath(import.meta.url))
const renderer = join(HERE, '..', 'src/renderer')

/**
 * Prose stripped before anything is asserted —
 * `a-source-census-must-strip-prose-before-it-asserts`.
 *
 * ⚑ **`<!-- -->` too, unlike the copy in `the-bridge-that-clones-nothing.test.ts`.** Half the files
 * this walks are `.vue`, and a template comment quoting a construction is no more a construction
 * than a docblock quoting one.
 */
function withoutProse(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/**
 * 🔴 **An object literal whose first property is `outcome`, in any spelling** — which is what a
 * `PermissionDecision` construction looks like from the outside.
 *
 * ⛔ **This was `outcome: '<word>'` and that was a SPELLING, not a construction** (found by this
 * dispatch's adversarial read of its own diff). ⚠️ **The second producer `473` removed was not
 * written that way**: `attention.ts` had `{ outcome } as PermissionDecision` — shorthand and a cast
 * — which scores zero against a quoted literal. 🔴 **So the census would have reddened on
 * `PermissionCard`, the copy that was never wrong, and been silent about the copy that was.**
 *
 * ⚑ `(?<!\$)` keeps `${outcome}` in a template literal out of it: interpolation is not
 * construction, and `PermissionCard.vue` has one.
 */
const BUILDS_AN_OUTCOME = /(?<!\$)\{\s*outcome\s*[:}]/g

/** The other way a construction hides — a cast asserts the shape instead of building it (365). */
const CASTS_TO_A_DECISION = /\bas PermissionDecision\b/g

/**
 * 🔴 **What this section covers, and — standing rule 4 — what shape of answer it could find.**
 *
 * | shape | example | seen here |
 * |---|---|---|
 * | a quoted literal | `{ outcome: 'deny' }` | ✔ {@link BUILDS_AN_OUTCOME} |
 * | the shorthand, which is what `473` removed | `{ outcome } as PermissionDecision` | ✔ both |
 * | a computed value | `{ outcome: picked }` | ✔ {@link BUILDS_AN_OUTCOME} |
 * | a cast over any of them | `… as PermissionDecision` | ✔ {@link CASTS_TO_A_DECISION} |
 * | ⛔ **a HAND-OVER** | `{ permission: row.decision }` | ✘ — see below |
 *
 * ⛔ **A hand-over constructs nothing, so no source search can find it**, and it is the shape the
 * `469` defect actually took. ⚑ **What covers it is the TYPE and §1**: the only value in this
 * renderer that IS a `PermissionDecision` and was not built by `permissionDecisionFor` is the one
 * `answerFor` is handed, and §1 drives every arm of `answerFor` out of a genuinely reactive queue
 * and over a real clone. 🔴 **A surface that reaches `store.respondPermission` without going
 * through `answerFor` is outside both**, and that is the honest bound on this file — a new one
 * needs its own press, the way `the-press-that-shows-nothing.test.ts` needed one.
 */
describe('§4 · one function builds every permission this app sends (473 §2)', () => {
  it('⛔ the whole renderer — one file constructs an outcome: `permission-offer.ts`', () => {
    // ⚠️ **`readdirSync`, never a shell search** — `grep -rn` prints nothing at all for at least
    // one test file in this tree, so a census built on one is short before it starts (361 §6).
    const builders = readdirSync(renderer, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') || name.endsWith('.vue'))
      .map((name) => [name, withoutProse(readFileSync(join(renderer, name), 'utf8'))] as const)
      .map(([name, code]) => [name, (code.match(BUILDS_AN_OUTCOME) ?? []).length] as const)
      .filter(([, count]) => count > 0)
      .sort()
    // Five files construct an outcome; only permission-offer constructs permission decisions.
    // Each other construction has its own named purpose and count.
    expect(builders).toEqual([
      // ⚑ A `LibraryEntry` outcome — `'unreadable'` twice and one `rebuildOutcome(…)`. A namesake.
      ['src/components/SessionLibrary.vue', 3],
      // The answer to a server request's press when its call to the host failed, never a
      // permission decision.
      ['src/lib/agent-store.ts', 1],
      // 🔴 **The producer: one per outcome** — plus `WideGrant`'s declaration and the one
      // `{ outcome: WIDE, label }` that goes with it, which is an OFFER and not a decision.
      // ⚑ 736 · R95 — six outcomes now (`allow_always`), so eight, all in `permissionDecisionFor`'s switch.
      ['src/lib/permission-offer.ts', 8],
      // Move acceptance/refusal acknowledgements, never permission decisions.
      ['src/lib/session-store.ts', 4],
      // ⚑ One conditional spread of a transcript card's own outcome. A namesake.
      ['src/lib/transcript-window.ts', 1],
    ])
    const store = withoutProse(readFileSync(join(renderer, 'src/lib/session-store.ts'), 'utf8'))
    const start = store.indexOf('async decideMoveRequest(')
    expect(start).toBeGreaterThan(0)
    const move = store.slice(start, store.indexOf('async respondUserInput(', start))
    expect(move).toContain('bridge.decideMoveRequest(')
    expect(move).not.toContain('bridge.respondPermission(')
    expect(move.match(BUILDS_AN_OUTCOME)).toHaveLength(4)
    expect(move).not.toMatch(
      /outcome:\s*['"](?:allow|deny|cancel|reject|allow_for_session|allow_always)['"]/,
    )
  })

  it('⛔ …and nobody CASTS to the type, which is how a construction hides from it', () => {
    // 🔴 `{ outcome } as PermissionDecision` is what `attention.ts` had until this dispatch — a
    // shape asserted rather than built (365's *"the wrong answer that compiles"*). Zero is the
    // whole assertion, and the control below is what makes zero mean something.
    const casts = readdirSync(renderer, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') || name.endsWith('.vue'))
      .map((name) => [name, withoutProse(readFileSync(join(renderer, name), 'utf8'))] as const)
      .filter(([, code]) => (code.match(CASTS_TO_A_DECISION) ?? []).length > 0)
      .map(([name]) => name)
    expect(casts).toEqual([])
  })

  it('⚑ …and both searches can find all three shapes, so the negatives are not typos', () => {
    // ⛔ The positive controls, and there is one per row of the table above — a control for the
    // literal alone is what let the shorthand through in the first place.
    const find = (code: string): number =>
      (withoutProse(code).match(BUILDS_AN_OUTCOME) ?? []).length
    expect(find("  return { outcome: 'deny' }")).toBe(1)
    expect(find('  decision: { outcome } as PermissionDecision,')).toBe(1)
    expect(find('  send({ outcome: picked })')).toBe(1)
    // ⚑ …and the cast search finds the one this dispatch removed, in the same fixture.
    expect(
      (
        withoutProse('  decision: { outcome } as PermissionDecision,').match(CASTS_TO_A_DECISION) ??
        []
      ).length,
    ).toBe(1)
    // ⚠️ Interpolation is not construction: `PermissionCard.vue` has a `${outcome}` and it is not
    // a producer. Without this the walk would report five files and one of them for nothing.
    expect(find('  const cy = `permission-${outcome}`')).toBe(0)
    // ⚠️ …and prose that quotes a construction is not one, in both of the comment shapes a `.vue`
    // file has.
    expect(
      find(
        ['/**', " * `return { outcome: 'deny' }` is what the card used to do.", ' */'].join('\n'),
      ),
    ).toBe(0)
    expect(find('<!-- `{ outcome } as PermissionDecision` is what it used to be -->')).toBe(0)
  })

  it('🔴 both surfaces call it, and neither writes the value itself', () => {
    const card = withoutProse(
      readFileSync(join(renderer, 'src/components/PermissionCard.vue'), 'utf8'),
    )
    const overview = withoutProse(readFileSync(join(renderer, 'src/lib/attention.ts'), 'utf8'))
    expect(card).toContain('permissionDecisionFor(outcome)')
    expect(overview).toContain('permissionDecisionFor(decision.decision.outcome)')
    // ⛔ **And the row's own decision too.** `attention.ts` builds the offer a person presses; a
    // cast there would put a shape nobody constructed back on the queue.
    expect(overview).toContain('decision: permissionDecisionFor(outcome)')
    expect(overview).not.toContain('as PermissionDecision')
  })

  it('⚑ the producer refuses to compile short — every outcome has a literal of its own', () => {
    // ⛔ Driven rather than read: five calls, five distinct plain values, each one cloneable.
    for (const outcome of Object.keys(EVERY_OUTCOME) as PermissionOutcome[]) {
      const built = permissionDecisionFor(outcome)
      expect(asTheWireWouldCarry('respondPermission', built)).toEqual({ outcome })
      // ⚠️ A FRESH value each time, so no two presses can share one object.
      expect(permissionDecisionFor(outcome)).not.toBe(built)
    }
  })
})
