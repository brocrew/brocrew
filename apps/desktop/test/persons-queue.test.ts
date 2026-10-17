import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHAIN_HOP_LIMIT,
  chainReading,
  NOTHING_NAMED_THE_WORK,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  type EscalationChain,
  type PersonsDecision,
  type AboutWork,
  type HowItWasRaised,
  type PersonsQuestion,
  type LedgerWalk,
  type LedgerWalkKind,
  type OfferedAnswer,
  type RequestOnlyAPersonCanSettle,
  type RoutedRequest,
  type WorkInHand,
  aPersonsSince,
} from '../src/shared/questions'
import { ACTIVITY_READ_EVERY_MS } from '../src/renderer/src/lib/recent-activity'
import { homeAttention } from '../src/renderer/src/lib/home-attention'
import {
  LOOK_EVERY_MS,
  byBlockedSince,
  createPersonsQueue,
  personsQueueView as foldPersonsQueue,
  type PersonsQueueWorld,
} from '../src/renderer/src/lib/persons-queue'
import {
  WHAT_COMES_AFTER_IS_NOT_OURS,
  whatThisAnswerDoes,
} from '../src/renderer/src/lib/user-input-offer'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import type { PermissionDecision, RuntimeBridge } from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import type { ChannelRefusal } from '@brobot2/runtime'

/**
 * 🔴 **401 · the queue that ends at a person, the half with no DOM in it.**
 *
 * ⛔ **Every absence rule is a PAIR.** The three ways this surface can be handed nothing —
 * *nobody has answered yet*, *nothing is waiting*, and *the walk did not reach anybody* — are
 * three different sentences, and each is asserted beside the state it is not.
 */

const NAME = (id: string): string => id.replace('sess_', '')

function routed(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_pm',
    went: { is: 'the-parent', to: 'the-parent' },
    at: 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: 31_000,
    ...over,
  }
}

/** One `PersonsQuestion` exactly as `RuntimeHost.questionsForAPerson` builds it. */
function asked(
  over: Partial<RoutedRequest> & {
    requestId: string
    askedBy: string
    work?: readonly WorkInHand[]
    about?: AboutWork
    raisedBy?: HowItWasRaised
    /**
     * ⚑ **619 · what the asker offered, planted by name** — see `whatTheAskerOffered`.
     *
     * ⛔ **`null` by default for `raisedBy`'s reason exactly**: every case written before this
     * dispatch means a question with nothing pressable on it, which is the world they were
     * written in.
     */
    offered?: OfferedAnswer | null
  },
  openQuestionOf: (sessionId: string) => RoutedRequest | null = () => null,
): PersonsQuestion {
  const request = routed(over)
  const chain = escalationChain(request, openQuestionOf)
  return {
    request,
    // ⚑ **611 · when it became a person's** — see PersonsQuestion.aPersonsSince.
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    // ⚑ **Empty by default and overridable** (434) — most conversations that stop to ask hold no
    // task, and the row states that rather than omitting criterion 20's clause.
    work: over.work ?? [],
    // ⚑ **474 · a provider-raised question names no work by default** — `430`'s measured
    // absence, which is the arm every row written before the edge existed carries.
    about: over.about ?? NOTHING_NAMED_THE_WORK,
    // ⚑ **602 · provider-raised by default, and overridable** — see `HowItWasRaised`. ⛔ Every case
    // written before `602` means *a question whose card exists somewhere*, which is the world they
    // were all written in; the arm with no card is planted by name.
    raisedBy: over.raisedBy ?? 'the-provider',
    // ⚑ **619 · nothing to press by default, and planted by name** — see the override above.
    offered: over.offered ?? null,
    asked: null,
  }
}

/**
 * ⛔ **One `PersonsDecision` exactly as `RuntimeHost.decisionsForAPerson` builds it** (403) — a
 * request that NEVER travelled, so `to: 'a-person'`, a `because`, and no escalation stamp because
 * nothing could ever have escalated it.
 */
function onlyAPersons(
  over: Partial<RoutedRequest> & {
    requestId: string
    askedBy: string
    work?: readonly WorkInHand[]
  },
  because: ChannelRefusal = 'a-permission-decision',
  says = 'a command or file approval, which is a person’s to give',
): PersonsDecision {
  const request: RequestOnlyAPersonCanSettle = {
    ...routed({ escalatedAt: null, ...over }),
    went: { is: 'the-person-the-channel-left-it-with', to: 'a-person', because },
  }
  const reading = decisionReading(request.askedBy, NAME)
  return {
    request,
    reading,
    sentence: readingSentence(reading),
    says,
    work: over.work ?? [],
  }
}

/**
 * ⚑ **The world nothing is answerable in and every look has answered** (434) — the base every
 * test varies from, so a test that says nothing about the new facts asserts the old behaviour.
 */
const WORLD: PersonsQueueWorld = {
  held: new Set<string>(),
  answerable: new Map<string, AttentionRequest>(),
  now: 91_000,
  lastLookAnswered: { questions: true, decisions: true },
  /** ⚑ **468 · this window has answered nothing** — see `PersonsQueueWorld.answeredFromHere`. */
  answeredFromHere: new Set<string>(),
}

/**
 * 🔴 **453 · the ORDINARY walk, so every case written before this dispatch means what it meant.**
 *
 * ⛔ **`personsQueueView` now takes a {@link LedgerWalk} per population rather than a list**, and
 * every case in this file that hands it rows means *"a walk that opened every ledger and dropped
 * nothing"* — which is the world they were all written in. ⚑ This wraps a list into exactly that
 * and nothing else; the `453` section below calls {@link foldPersonsQueue} directly, because the
 * facts it asserts are the ones this wrapper fixes.
 *
 * ⚠️ **`ledgers: 1` and not `0`.** A walk that found rows must have opened at least one ledger, and
 * `ledgers: 0` beside a non-empty list is a state the store cannot produce — a fixture that could
 * would be asserting against a world that does not exist.
 */
function walked<Row>(
  rows: readonly Row[] | null,
  walk: LedgerWalkKind = 'every-conversation-that-routed',
): LedgerWalk<Row> | null {
  return rows === null ? null : { rows, walk, ledgers: Math.max(rows.length, 1), rowsUnread: 0 }
}

/** {@link foldPersonsQueue} over two ordinary walks — see {@link walked}. */
function personsQueueView(
  questions: readonly PersonsQuestion[] | null,
  decisions: readonly PersonsDecision[] | null,
  world: PersonsQueueWorld,
): ReturnType<typeof foldPersonsQueue> {
  return foldPersonsQueue(walked(questions), walked(decisions), world)
}

/**
 * 🔴 **One live attention row** (434) — what `attention.ts` projects for a request this window
 * holds, and the only thing that makes a queue row settleable where it stands.
 */
function live(key: string, over: Partial<AttentionRequest> = {}): AttentionRequest {
  const [sessionId = '', requestId = ''] = key.split(':')
  return {
    key,
    sessionId,
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
    at: 60_000,
    decisions: [
      { kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } },
      { kind: 'permission', label: 'Deny', decision: { outcome: 'deny' } },
    ],
    limit: null,
    sent: false,
    /** ⚑ **468 · nothing has bounced** — a case that wants the refusal overrides it. */
    refused: null,
    ...over,
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────
// §1 · the reading, and the sentence that is a join of it
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · chainReading — the names 398 could not put on the wire', () => {
  it('🔴 a chain of ONE reads as two hops, and the last one is owed by YOU', () => {
    const chain = escalationChain(
      routed({ requestId: 'req_1', askedBy: 'sess_worker' }),
      () => null,
    )
    const reading = chainReading(chain, NAME)
    expect(reading.unfollowable).toBe(false)
    expect(reading.hops).toEqual([
      { waiting: 'worker', on: 'pm' },
      { waiting: 'pm', on: null },
    ])
  })

  /**
   * ⛔ **`null` and not the word `you`.** A conversation called `you` — its agent, or since `734` its
   * working folder only where it has no agent — must not be readable as the person, and the discrimination is the null rather than a
   * string comparison a surface would have to remember to make.
   */
  it('⛔ the person is a NULL, so a conversation named "you" is still a conversation', () => {
    const chain = escalationChain(
      routed({ requestId: 'req_1', askedBy: 'sess_you', parent: 'sess_pm' }),
      () => null,
    )
    const reading = chainReading(chain, NAME)
    expect(reading.hops[0]).toEqual({ waiting: 'you', on: 'pm' })
    expect(reading.hops[0]?.on).not.toBeNull()
    expect(reading.hops[1]).toEqual({ waiting: 'pm', on: null })
  })

  it('⛔ a PM blocked on its own question makes the reading longer, in order', () => {
    const pm = routed({ requestId: 'req_2', askedBy: 'sess_pm', parent: 'sess_lead' })
    const chain = escalationChain(routed({ requestId: 'req_1', askedBy: 'sess_worker' }), (id) =>
      id === 'sess_pm' ? pm : null,
    )
    expect(chainReading(chain, NAME).hops).toEqual([
      { waiting: 'worker', on: 'pm' },
      { waiting: 'pm', on: 'lead' },
      { waiting: 'lead', on: null },
    ])
  })

  /** ⛔ **The paired negative**: a walk that was stopped names nobody as the answerer. */
  it('⛔ a CYCLE is unfollowable, and NO hop is owed by a person', () => {
    const a = routed({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' })
    const b = routed({ requestId: 'req_b', askedBy: 'sess_b', parent: 'sess_a' })
    const chain = escalationChain(a, (id) => (id === 'sess_b' ? b : id === 'sess_a' ? a : null))
    const reading = chainReading(chain, NAME)
    expect(reading.unfollowable).toBe(true)
    expect(reading.hops.every((hop) => hop.on !== null)).toBe(true)
    expect(reading.hops).toHaveLength(2)
  })

  it('⛔ the hop BOUND is unfollowable too, and it is the same absence', () => {
    const chain = escalationChain(
      routed({ requestId: 'req_0', askedBy: 'sess_0', parent: 'sess_1' }),
      (id) => {
        const nth = Number(id.replace('sess_', ''))
        return routed({
          requestId: `req_${String(nth)}`,
          askedBy: `sess_${String(nth)}`,
          parent: `sess_${String(nth + 1)}`,
        })
      },
    )
    const reading = chainReading(chain, NAME)
    expect(reading.hops).toHaveLength(CHAIN_HOP_LIMIT)
    expect(reading.unfollowable).toBe(true)
    expect(reading.hops.every((hop) => hop.on !== null)).toBe(true)
  })

  /**
   * 🔴 **The anti-drift law, at the source.** `398`'s sentence and `401`'s hops are one walk, and
   * this is the assertion that says so — over every shape the walk can produce, including the two
   * that end in a refusal.
   */
  it('🔴 the sentence IS the reading joined, for every shape the walk can produce', () => {
    const pm = routed({ requestId: 'req_2', askedBy: 'sess_pm', parent: 'sess_lead' })
    const a = routed({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' })
    const b = routed({ requestId: 'req_b', askedBy: 'sess_b', parent: 'sess_a' })
    // ⛔ **An independent literal per shape**, because the join and `chainSentence` are the same
    // code since `401` — a loop comparing one to the other is a tautology that stays green while
    // both move together, which is exactly what a rule about two renderings agreeing must not be.
    const shapes: [EscalationChain, string][] = [
      [
        escalationChain(routed({ requestId: 'req_1', askedBy: 'sess_worker' }), () => null),
        'worker waiting on pm, pm waiting on you',
      ],
      [
        escalationChain(routed({ requestId: 'req_1', askedBy: 'sess_worker' }), (id) =>
          id === 'sess_pm' ? pm : null,
        ),
        'worker waiting on pm, pm waiting on lead, lead waiting on you',
      ],
      [
        escalationChain(a, (id) => (id === 'sess_b' ? b : id === 'sess_a' ? a : null)),
        'a waiting on b, b waiting on a, and the chain above that could not be followed',
      ],
      // ⚠️ **Legal on the wire and unreachable from `escalationChain`** — asserted anyway, because
      // a surface that printed a bare `you` for a walk with no hops in it would name a person as
      // the answerer of nothing.
      [{ links: [], endsWithAPerson: true }, 'and the chain above that could not be followed'],
    ]
    for (const [chain, expected] of shapes) {
      const reading = chainReading(chain, NAME)
      const clauses = reading.hops.map((hop) => `${hop.waiting} waiting on ${hop.on ?? 'you'}`)
      if (reading.unfollowable) clauses.push('and the chain above that could not be followed')
      expect(clauses.join(', ')).toBe(expected)
      expect(chainSentence(chain, NAME)).toBe(expected)
    }
  })

  it('⛔ an EMPTY reading gives no hops and is unfollowable — never a bare "you"', () => {
    const reading = chainReading({ links: [], endsWithAPerson: true }, NAME)
    expect(reading.hops).toEqual([])
    expect(reading.unfollowable).toBe(true)
    expect(chainSentence({ links: [], endsWithAPerson: true }, NAME)).not.toContain(
      'waiting on you',
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §2 · the view — three absences, three sentences
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · nobody has answered, nothing is waiting, and the walk did not arrive', () => {
  it('🔴 `null` is NOT `[]`: one is "the read has not landed", the other is "nothing is waiting"', () => {
    // ⛔ **`null` is BOTH refused since `403`** — see §8 for why one refusal draws what landed
    // instead. ⚑ The pair below is still the sentence this test is about: nothing landed, versus
    // both landed and empty.
    expect(personsQueueView(null, null, WORLD)).toBeNull()

    const nothing = personsQueueView([], [], WORLD)
    expect(nothing).not.toBeNull()
    expect(nothing?.count).toBe(0)
    expect(nothing?.rows).toEqual([])
    // ⛔ **And an empty queue announces NOTHING** — a live region that read out an all-clear
    // nobody asked for is the unconditional region the design's own correction removed.
    expect(nothing?.announcement).toBe('')
  })

  it('⛔ a walk that could not be followed is the THIRD absence, and it is on the row', () => {
    const a = routed({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' })
    const b = routed({ requestId: 'req_b', askedBy: 'sess_b', parent: 'sess_a' })
    const view = personsQueueView(
      [
        asked({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' }, (id) =>
          id === 'sess_b' ? b : id === 'sess_a' ? a : null,
        ),
      ],
      [],
      WORLD,
    )
    const row = view!.rows[0]!
    expect(row.unfollowable).toBe(true)
    expect(row.chain.some((hop) => hop.you)).toBe(false)
    // ⚑ **The paired positive, so the assertion is measuring the flag and not the fixture.**
    const ended = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(ended!.rows[0]!.unfollowable).toBe(false)
    expect(ended!.rows[0]!.chain.filter((hop) => hop.you)).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §3 · the chain a person looks at
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the chain, one participant per name and an act on each', () => {
  it('🔴 worker → pm → you, and only the last one is yours', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    // ⚑ **613 · every hop carries what it DID** — see `PersonsQueueHop.did`, and
    // `the-chain-a-question-carries.test.ts` for the vocabulary and for why the middle hop says
    // *has not answered* rather than `HO-088` §6's *could not answer*.
    expect(view!.rows[0]!.chain).toEqual([
      { name: 'worker', you: false, did: 'asked' },
      { name: 'pm', you: false, did: 'has-not-answered' },
      { name: 'you', you: true, did: null },
    ])
  })

  /**
   * 🔴 **The law the two renderings are held to.** The names this surface draws, read back in
   * order and re-joined the way HO-007 words it, are the sentence the host composed — so a surface
   * cannot come to describe a chain differently from the line beside it.
   */
  it('🔴 the drawn chain reconstructs the host’s own evidence line', () => {
    const pm = routed({ requestId: 'req_2', askedBy: 'sess_pm', parent: 'sess_lead' })
    const view = personsQueueView(
      [
        asked({ requestId: 'req_1', askedBy: 'sess_worker' }, (id) =>
          id === 'sess_pm' ? pm : null,
        ),
      ],
      [],
      WORLD,
    )
    const row = view!.rows[0]!
    const clauses = row.chain
      .slice(0, -1)
      .map((hop, index) => `${hop.name} waiting on ${row.chain[index + 1]!.name}`)
    expect(clauses.join(', ')).toBe(row.sentence)
    expect(row.sentence).toBe('worker waiting on pm, pm waiting on lead, lead waiting on you')
  })

  it('⛔ a chain of ONE is a chain, not a degenerate case', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    const row = view!.rows[0]!
    expect(row.chain).toHaveLength(3)
    expect(row.sentence).toBe('worker waiting on pm, pm waiting on you')
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §4 · the row's own facts
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · what the row says, and what it refuses to say', () => {
  it('⛔ the card is on the CHILD that asked, never on the parent that did not answer', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(view!.rows[0]!.sessionId).toBe('sess_worker')
    expect(view!.rows[0]!.requestId).toBe('req_1')
    expect(view!.rows[0]!.key).toBe('sess_worker:req_1')
  })

  it('🔴 an age is measured, and a MISSING stamp is null rather than zero or "just now"', () => {
    const stamped = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker', escalatedAt: 31_000 })],
      [],
      WORLD,
    )
    expect(stamped!.rows[0]!.since).toBe('1m ago')

    const unstamped = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker', escalatedAt: null })],
      [],
      WORLD,
    )
    expect(unstamped!.rows[0]!.since).toBeNull()
  })

  /**
   * ⛔ **The gesture is named before it is made.** ⚑ **D-017b · and there is one gesture now**: a
   * conversation opens in its one full view whatever it is doing (`RuntimeScreen.openConversation`
   * — attached, taken when no window has it, or drawn from its ledger), so held and not-held are
   * still two facts on the row and the button names the same act for both. ⛔ *Take it over and open
   * it* named what a process was doing, which a person no longer has to know (`05` rule 5).
   */
  it('🔴 held and not-held are two facts, and the button names the one gesture for both', () => {
    const held = personsQueueView([asked({ requestId: 'req_1', askedBy: 'sess_worker' })], [], {
      ...WORLD,
      held: new Set(['sess_worker']),
    })
    expect(held!.rows[0]!.held).toBe(true)
    expect(held!.rows[0]!.action).toBe('Open the conversation')

    const loose = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(loose!.rows[0]!.held).toBe(false)
    expect(loose!.rows[0]!.action).toBe('Open the conversation')
  })

  it('⛔ a card the live queue already lists is DISCLOSED, never dropped', () => {
    const both = personsQueueView([asked({ requestId: 'req_1', askedBy: 'sess_worker' })], [], {
      ...WORLD,
      answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1')]]),
    })
    expect(both!.rows).toHaveLength(1)
    expect(both!.rows[0]!.alsoOnScreen).toBe(true)

    const only = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(only!.rows[0]!.alsoOnScreen).toBe(false)
  })

  /**
   * ⛔ **It never invents an actor.** The payload records no decider and neither does this: the
   * only names on a row are conversations the host named, plus the person, and nothing anywhere
   * says who decided anything.
   */
  it('⛔ no row carries a decider, a decision or a time-of-decision', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    // ⛔ **The closed vocabulary of a row, by KEY.** A `decider`, a `decidedBy` or a `decidedAt`
    // added later is a name this list does not carry and fails here whatever it is spelled —
    // which the value census below cannot promise, because it can only look for words somebody
    // thought of.
    expect(Object.keys(view!.rows[0]!).sort()).toEqual([
      // 🔴 **474 · WHICH WORK this row is about**, and it passes this census for the census's own
      // reason: it names a task the ASKER recorded, never a person and never a decision. ⛔ It is
      // the one field on this row that can say *"nothing this app records says"* — see `AboutWork`.
      'about',
      'action',
      'alsoOnScreen',
      'answers',
      'blockedSince',
      'blockedSinceIs',
      'chain',
      // What the request asks, as its card discloses it: the ask's own words, never a decider, a
      // decision or an instant.
      'disclosed',
      'held',
      'key',
      'kind',
      'limit',
      // 🔴 **701 · what the provider's marks say** (`700` §5 GAP 1), and it passes this census for
      // the census's own reason: it is the ASK's own sentences — why no grant is here, why Deny
      // leads, the provider's reason — carried from the live card. ⛔ No decider, no decision, no
      // instant: they bound an answer nobody has given.
      'marksSay',
      'noAnswerHere',
      // 🔴 **487 · why the request offers no way to ALLOW it**, and it passes this census for the
      // census's own reason: it is not a decider, a decision or a time-of-decision. ⛔ It is a
      // sentence about what this row CANNOT do, on a row that is still waiting — and 487's whole
      // point is that it can still be refused, which is why it is not a {@link NoAnswerHere}.
      'noPositive',
      // 🔴 **UI-009 · a question THIS APP asked, as its card reads it** (it replaced `619`'s
      // `offered`), and it passes this census for the census's own reason: its words, the asker's
      // offer and whether this window sent an answer. ⛔ It names no decider, records no decision
      // and carries no instant.
      'question',
      // 🔴 **468 · why the last answer BOUNCED**, and it passes this census for the reason the
      // census exists: it is not a decider, a decision or a time-of-decision. ⛔ It is the
      // transcript item's own sentence about a gesture that did NOT land, on a row that is still
      // waiting — the opposite of a settlement, carried here so the surface that made the gesture
      // can say what happened to it.
      'refused',
      // 🔴 **701 · refusal is this ask's default** — a fact the PROVIDER put on the ask, about the
      // order of the answers it offers. ⛔ Not a decision: nobody has refused anything.
      'refusesFirst',
      'requestId',
      'says',
      'sentence',
      'sessionId',
      'since',
      'unfollowable',
      // 🔴 **D-046 · a provider's question, as it was asked — for reading only**, and it passes this
      // census for its own reason: the asker's words and parts. ⛔ No decider, no decision, no instant.
      'words',
      'work',
    ])
    const text = JSON.stringify(view)
    const forbidden = ['actor', 'Actor', 'decid', 'Decid', 'denied', 'Denied', 'allowed', 'Allowed']
    for (const word of forbidden) {
      expect(text, `the queue invented ${word}`).not.toContain(word)
    }
    // ⚑ **Non-vacuity: the value census can go red**, and the stem is what makes it reach a
    // camelCase key rather than only a prose phrase.
    expect(forbidden.some((word) => `${text}"decidedBy":"pm"`.includes(word))).toBe(true)
    // 🔴 **And the census must see the fields `434` ADDED**, or it is a census of the row as it
    // was. ⛔ `a-mutation-on-a-census-is-invisible-to-that-census`: with no live row the `answers`
    // list is empty, so every word the offered decisions carry would have been outside the search
    // this test performs. ⚠️ An OFFER is not a decision — nothing here says one was made.
    const answerable = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      {
        ...WORLD,
        answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1')]]),
      },
    )
    expect(answerable!.rows[0]!.answers.length).toBeGreaterThan(0)
    const offered = JSON.stringify(answerable)
    for (const word of forbidden) {
      expect(offered, `an offered answer carried ${word}`).not.toContain(word)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §5 · the count, and the one thing a screen reader is told
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · the count is a fact, and the announcement is a closed channel', () => {
  it('🔴 twelve is twelve — the count is never rounded and never capped', () => {
    const many = Array.from({ length: 12 }, (_unused, index) =>
      asked({ requestId: `req_${String(index)}`, askedBy: `sess_w${String(index)}` }),
    )
    const view = personsQueueView(many, [], WORLD)
    expect(view!.count).toBe(12)
    expect(view!.rows).toHaveLength(12)
    expect(view!.heading).toBe('12 questions are waiting on you')
    expect(view!.announcement).toBe('12 questions waiting on you.')
  })

  it('⚑ one is said in the singular, on both the heading and the announcement', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(view!.heading).toBe('A question is waiting on you')
    expect(view!.announcement).toBe('1 question waiting on you.')
  })

  /**
   * ⛔ **The closed set on the announcement channel.** A question and a permission are the only
   * things that may summon attention; this channel carries the first and nothing else, and the
   * assertion is that its sentence cannot be about anything else — including a permission, which
   * `escalationsDue` refuses to stamp and which therefore never reaches this queue at all.
   */
  it('⛔ the announcement is about questions and nothing else', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    for (const forbidden of ['permission', 'error', 'failed', 'finished', 'complete', 'done']) {
      expect(view!.announcement.toLowerCase()).not.toContain(forbidden)
    }
  })

  /**
   * 🔴 **612 · the deadline this was paced against is GONE, and the number did not move**
   * (HO-088 §3.1 — `a-number-can-survive-the-death-of-its-derivation`, caught by the dispatch that
   * killed the derivation).
   *
   * ⛔ **It asserted `LOOK_EVERY_MS * 6 === ESCALATION_WINDOW_MS`**, against the DEADLINE rather
   * than against its value, *"because `30_000` written here would go on passing after somebody
   * moved the window"*. ⚠️ **Nobody moved it; it was removed**, so there is no relation left to
   * assert and the arithmetic would be a fact about nothing.
   *
   * ## ⚑ What the number is FOR now, and it is a stronger claim
   *
   * ⛔ **This poll is the whole latency between an agent asking and a person knowing.** Every
   * population it feeds is a person's from the instant its row is written, and nothing pushes —
   * so the cadence is not *a fraction of a window*, it IS the window. ⚠️ **It cannot be asserted
   * against another constant any more**, which is honest rather than weaker: what holds it is the
   * COST of one look, and that is a measurement nobody has taken.
   *
   * 🔴 **So what is pinned is the ORDERING it must keep** — a person's own obligations are re-read
   * more often than a summary is — which is a relation between two live numbers and goes red if
   * either crosses the other.
   */
  it('⚠️ a person’s obligations are re-read more often than a summary, and that is the whole rule', () => {
    expect(LOOK_EVERY_MS).toBeLessThan(ACTIVITY_READ_EVERY_MS)
    expect(LOOK_EVERY_MS).toBeGreaterThan(0)
    // ⚑ **Non-vacuity: the two really are different numbers**, so the relation is doing work.
    expect(LOOK_EVERY_MS).not.toBe(ACTIVITY_READ_EVERY_MS)
    // ⛔ **And it is not the cheapest cadence in the app**, which is the half of its own docblock
    // that survived: `ChildWorkViewer` polls at two seconds over a buffer read, and this is a fold
    // of every ledger that has ever routed a request.
    expect(LOOK_EVERY_MS).toBeGreaterThan(2_000)
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §6 · Home may not say the workspace is quiet over one of these
// ───────────────────────────────────────────────────────────────────────────────────────────

describe('§6 · the third population reaches every summary Home makes', () => {
  it('🔴 an escalated question alone is enough to stop "Nothing needs you"', () => {
    const quiet = homeAttention({ requests: [] })
    expect(quiet.quiet).toBe(true)

    // ⛔ **The same screen, one escalated question, and it is `304`'s contradiction if it stays
    // quiet**: nothing this window is running is blocked, and a worker somewhere is frozen on an
    // answer only a person can give.
    const escalated = homeAttention({ requests: [], onlyYou: 1 })
    expect(escalated.quiet).toBe(false)
    expect(escalated.total).toBe(1)
    expect(escalated.onlyYou).toBe(1)
    expect(escalated.stat).toBe('1 item')
    expect(escalated.statTone).toBe('waiting')
    // ⛔ **403 · it names no population and no location, and both halves are load-bearing.** The
    // number now folds escalated questions AND requests that never travelled, so *"questions"*
    // would be false of half of it; and *"conversations it is not running"* was only ever
    // ordinarily true. ⚑ What it says instead is the part that is always true.
    // ⚑ **UI-009 (F052) · and it no longer explains the machinery** — no *"No conversation on this
    // screen is blocked on you"*, no *"each is settled on its own card"*.
    expect(escalated.intro).toBe('1 item below is waiting on you.')
    expect(escalated.intro).not.toContain('question')
    expect(escalated.intro).not.toContain('not running')
    // ⛔ **"settled", not "answered"** — half of this number is a decision, which is given rather
    // than answered, and the queue's own group label says *decide*.
    expect(escalated.intro).not.toContain('where you answer')
  })

  /**
   * 🔴 **The total is every row that is WORK** — `live + onlyYou`, and each number is still
   * carried on its own, which is HO-002 acceptance #7.
   */
  it('⚑ the total is every row that is WORK', () => {
    const view = homeAttention({
      requests: [{ key: 'a' } as never, { key: 'b' } as never],
      onlyYou: 3,
    })
    expect(view.live).toBe(2)
    expect(view.onlyYou).toBe(3)
    // ⛔ **`live + onlyYou`.**
    expect(view.total).toBe(5)
    expect(view.stat).toBe('5 items')
  })

  /**
   * 🔴 **A screen that could not READ a list may not say the workspace is quiet** (403, from the
   * review).
   *
   * ⛔ **Every count is zero in that state** — one read refused, the other genuinely empty — so
   * `quiet` was `true` and Home said *"Nothing needs you. The workspace is quiet."* over a
   * population the app never managed to look at. ⚑ `086`'s rule on the one screen that makes the
   * claim: not knowing is not an all-clear.
   */
  it('🔴 an unread list forbids "quiet", and says so instead of counting nothing', () => {
    const unread = homeAttention({ requests: [], unread: true })
    expect(unread.quiet).toBe(false)
    expect(unread.total).toBe(0)
    expect(unread.unread).toBe(true)
    // ⛔ **"Not known", never "0 items"** — there is no number to give.
    expect(unread.stat).toBe('Not known')
    expect(unread.statTone).toBe('waiting')
    expect(unread.intro).toContain('could not be read just now')

    // ⚑ **The paired positive**: the same empty world that HAS been read is quiet, so this
    // measures the not-knowing rather than the emptiness.
    const known = homeAttention({ requests: [] })
    expect(known.quiet).toBe(true)
    expect(known.unread).toBe(false)
    expect(known.stat).toBe('All clear')
  })

  it('⚠️ a caller that does not look for them counts none — the field is optional, not defaulted true', () => {
    const before = homeAttention({ requests: [] })
    expect(before.onlyYou).toBe(0)
    // ⛔ The claim this case makes is about `onlyYou` being absent rather than defaulted.
    expect(before.total).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §7 · the store's refusal, and the shell that does the looking
// ───────────────────────────────────────────────────────────────────────────────────────────

/** The one file the wiring lives in, read as text — see §7's own note for why. */
const SCREEN = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
  'utf8',
)

/**
 * ⛔ **The same file with every comment removed**, for the counting census below.
 *
 * ⚠️ **Measured, not precautionary**: the docblock ARGUING for `role="status"` contains the string
 * `role="status"`, so a census over the raw text counted the explanation as a second live region
 * and went red on a file with one. A census that reads prose reads code wrong.
 */
const CODE = stripped(SCREEN)

/** Every comment out, for a counting census — see {@link CODE}. */
function stripped(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * ⛔ **Every production call site of `homeAttention`, DERIVED rather than listed** (403 for the
 * second one; `606` for the derivation).
 *
 * ## 🔴 **Why this stopped being two named files**
 *
 * ⚠️ **`403` made it two** — `RuntimeScreen.vue` and `HomeSurface.vue` — after the first version
 * looked at one while its own title said *"every call site"*. ⛔ **`606` then moved one of the
 * two**: `EXT-008` §3 took the queue off Home, so the call went with it to `WaitingOnYou.vue` and
 * the hand-listed pair named a file that no longer calls the function at all.
 *
 * 🔴 **It did NOT expire silently, and that is the only reason this is a repair rather than a
 * hole**: the count is asserted, so the census went red the moment the call moved. ⚑ **But rule
 * `27.1` is about the shape and not the outcome** — *a census is scoped by what it is ABOUT, not
 * by where the things it is about currently live* — and a list of paths has now failed four times
 * in this project.
 *
 * ⚠️ **So the roster is every `.vue`/`.ts` under `renderer/src` whose stripped source calls
 * `homeAttention(`** — which is what the census is about — and a third caller added tomorrow is
 * walked without anybody editing this file.
 */
function everyHomeAttentionCaller(): { file: string; code: string }[] {
  const root = fileURLToPath(new URL('../src/renderer/src', import.meta.url))
  const found: { file: string; code: string }[] = []
  for (const name of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!/\.(ts|vue)$/.test(name)) continue
    const full = join(root, name)
    // ⛔ **The definition is not a call site**, and neither is a docblock that names one.
    if (name.endsWith('home-attention.ts')) continue
    const code = stripped(readFileSync(full, 'utf8'))
    if (code.includes('homeAttention(')) found.push({ file: name.replaceAll('\\', '/'), code })
  }
  return found
}

/**
 * A bridge with exactly the verbs under test on it.
 *
 * ⚠️ **BOTH person-facing reads since `403`**, because the property they are here for is a
 * property of each: a refusal is `null` and an empty answer is `[]`. The first version of this
 * helper took one verb, so the read `403` added was typed into the fake and asserted nowhere —
 * `catch { return [] }` would have passed the whole suite.
 */
function bridgeThat(
  answer: () => Promise<readonly PersonsQuestion[]>,
  decisions: () => Promise<readonly PersonsDecision[]> = () => Promise.resolve([]),
): RuntimeBridge {
  // ⛔ **Over the wire, like every double a renderer store runs on** (361 §2). An in-process
  // object hands its arguments and its answer BY REFERENCE, so a store that mutated either would
  // pass here and throw *"An object could not be cloned"* in the app —
  // `the-bridge-that-clones-nothing.test.ts` §6 derives the roster of files that build a store
  // and refuses one that skips this.
  return everythingOverTheWire({
    questionsForAPerson: answer,
    decisionsForAPerson: decisions,
    onEvent: () => () => {},
    onLiveness: () => () => {},
  }) as unknown as RuntimeBridge
}

describe('§7 · a read that did not answer is not an all-clear', () => {
  /**
   * 🔴 **The one degrading read in the store whose failure is `null` rather than the empty thing.**
   * ⛔ Every other one answers `[]` because empty and unknown mean the same to its caller; here
   * *"nothing is waiting on you"* is the strongest claim this app makes about somebody's workload,
   * and a dropped IPC call must not be able to make it.
   */
  it('🔴 a refused read is `null`, and an empty one is `[]`', async () => {
    const refused = createSessionStore(
      bridgeThat(() => Promise.reject(new Error('the host is gone'))),
    )
    await expect(refused.questionsForAPerson()).resolves.toBeNull()

    const empty = createSessionStore(bridgeThat(() => Promise.resolve([])))
    await expect(empty.questionsForAPerson()).resolves.toEqual([])
  })

  /**
   * 🔴 **The same property, on the read `403` added — and it had none** (from the review).
   *
   * ⛔ **`catch { return [] }` in `SessionStore.decisionsForAPerson` would have passed every test
   * in this repo.** The store's own docblock calls the claim it prevents *"stronger still"* —
   * a person is the ONLY party who may settle one of these rows, so an empty list drawn out of a
   * dropped IPC call names nobody else who could pick it up. ⚑ A safety sentence with no test is
   * a comment; this is the test.
   */
  it('🔴 the second read degrades the same way, and it is asserted rather than assumed', async () => {
    const refused = createSessionStore(
      bridgeThat(
        () => Promise.resolve([]),
        () => Promise.reject(new Error('the host is gone')),
      ),
    )
    await expect(refused.decisionsForAPerson()).resolves.toBeNull()
    // ⚑ **The paired positive, on the SAME store**: the other read still answers, so the refusal
    // is about the verb rather than about a bridge that rejects everything.
    await expect(refused.questionsForAPerson()).resolves.toEqual([])

    const empty = createSessionStore(bridgeThat(() => Promise.resolve([])))
    await expect(empty.decisionsForAPerson()).resolves.toEqual([])
  })

  /**
   * ⛔ **A SOURCE census over the shell's wiring**, because the four properties below are all
   * orderings and lifecycles inside one component that a DOM test would have to mount the whole
   * app to reach. ⚠️ **It asserts relationships between substrings, never a line's exact text** —
   * a census that pinned a line would kill every mutation row on it and would go red the next
   * time somebody edited a comment.
   */
  describe('the shell', () => {
    /**
     * The body of one `function name(...)` declaration, from its header to the next one.
     *
     * 🔴 **619 · it ended at `\nfunction ` and `RuntimeScreen` declares `async function` too**, so
     * every slice ran past the next `async` declaration and stopped at the one after it.
     *
     * ⛔ **Measured, not supposed:** `bodyOf('settleFromTheQueue')` returned that function PLUS
     * `takeOverForTheQueue` PLUS `decideFromOverview`'s whole docblock — which is why its
     * `not.toContain('store.respondUserInput')` was reading three declarations and passing on the
     * strength of the two that do not send. ⚠️ **A census whose scope is wider than its title is
     * `a-source-census-that-pins-a-line-kills-every-row-on-it`'s neighbour**: it goes red for
     * things it never claimed to watch and green for the one it did.
     *
     * ⚑ **Widened rather than patched at the one call site** (rule 27.1): the next declaration is
     * whatever the file declares next, so the boundary is derived from the language and not from
     * which keyword happened to follow this function today.
     */
    function bodyOf(name: string): string {
      const start = SCREEN.indexOf(`function ${name}(`)
      expect(start, `${name} is not in RuntimeScreen`).toBeGreaterThan(-1)
      const rest = SCREEN.slice(start + 1)
      const end = rest.search(/\n(?:async )?function /)
      return end === -1 ? rest : rest.slice(0, end)
    }

    /**
     * 🔴 **The look RECORDS whether it answered, and the two facts are separate** (434) — see
     * `PersonsQueueView.stale`.
     *
     * ⛔ **Keeping the last good list and recording that the read failed are one commit or
     * neither.** With only the first, the queue draws a list from the minute a read died and
     * `partial` is false for ever, because the value is not `null`.
     */
    it('🔴 the look records a refusal per population, and keeps the rows either way', () => {
      const body = bodyOf('lookForWhatIsYours')
      expect(body).toContain('if (questions !== null) escalated.value = questions')
      expect(body).toContain('if (decisions !== null) decided.value = decisions')
      // ⛔ **Per population, from the answer itself** — a single boolean over all of them would say
      // one list had stopped answering because another had.
      expect(body).toContain('questions: questions !== null')
      expect(body).toContain('decisions: decisions !== null')
      // ⚑ …and it reaches the module, which is the half a census of one function cannot see.
      expect(SCREEN).toContain('lastLookAnswered: lastLookAnswered.value')
    })

    /**
     * 🔴 **Settling from the queue reaches the door that already exists, and adds no second
     * one** (434, criterion 17).
     *
     * ## 🔴 619 · the FACT moved and the assertion was re-aimed rather than stripped
     *
     * ⛔ **This asserted `settleFromTheQueue` sends NOTHING** — *"the only two verbs are in
     * `decideFromOverview`, which `203`'s owner check guards"* — and that was true while every row
     * in this queue had a live projection to look up. ⚠️ **`619` added the one population that has
     * none**: a question `ask_question` raised draws no card, `attentionQueue` makes no item for
     * it, so `needsYou` can never hold it and `decideFromOverview` can never be the door.
     *
     * ⚑ **So the rule is no longer *one door* — it is *one door per population, chosen by a fact
     * on the row***. ⛔ Deleting the negative would have left the screen free to send a provider
     * card's answer down the app-held branch, which is exactly the wrong write path this census
     * was written to forbid (rule 26: *strip AND re-aim*).
     *
     * ## 🔴 UI-009 · the fact moved again, and the census is re-aimed again
     *
     * ⚑ **A question this app asked is answered on its CARD** (`PersonsQueueRow.question`), through
     * a door of its own — `answerFromTheQueue` — so `settleFromTheQueue` is back to sending nothing
     * itself, and the app-held send is that door's, keyed on the row's own conversation and id.
     */
    it('🔴 the queue settles through the door its row names, and invents no third path', () => {
      // 🔴 **619 · read the CODE and never the prose** — `a-source-census-must-strip-prose-before-
      // it-asserts`.
      const body = stripped(bodyOf('settleFromTheQueue'))
      expect(body).toContain('decideFromOverview(live, decision)')
      // ⛔ **The row's own key against the LIVE list**, never `activeId` — the population this
      // queue draws is mostly conversations that are not the one on screen.
      expect(body).toContain('needsYou.value.find((request) => request.key === row.key)')
      expect(body).not.toContain('activeId')
      // ⛔ **Neither verb is sent from here** — the live row's door sends both.
      expect(body).not.toContain('store.respondPermission')
      expect(body).not.toContain('store.respondUserInput')
      // 🔴 **UI-009 · the app-held send is the card's door**, on the conversation that ASKED and
      // the id this app minted — never `activeId` — and the look runs again at once, awaited: what
      // it finds decides whether the host's words go back to the card (F2).
      const card = stripped(bodyOf('answerFromTheQueue'))
      expect(card.replace(/\s+/g, '')).toContain(
        'store.respondUserInput(row.sessionId,row.requestId,response)',
      )
      expect(card).toContain('await lookForWhatIsYours()')
      expect(card).not.toContain('activeId')
      expect(card).not.toContain('store.respondPermission')
      expect(SCREEN).toContain('answer: (row, response) => answerFromTheQueue(row, response)')
      // ⚑ **The paired positive**: the door it calls really does send them.
      const door = stripped(bodyOf('decideFromOverview'))
      expect(door).toContain('store.respondPermission')
      expect(door).toContain('store.respondUserInput')
      // ⚑ **And the control that makes the two negatives above measurements**: this census CAN see
      // a permission send inside this function, so *it is not there* is a reading rather than a
      // grep that never matches.
      expect(`${body}store.respondPermission(`).toContain('store.respondPermission')
    })

    /**
     * 🔴 **The ARGUMENT, not the verb — `411` §6 item 1's acceptance, which nothing held** (444).
     *
     * ⛔ **`411` asked for *"a different selected parent, and each action proves only the intended
     * sessionId/requestId reaches main"*.** Two regressions already prove the id comes off the ROW
     * — `attention-answer.test.ts` at the host and `attention-overview.dom.test.ts` at the
     * component — and both are byte-identical to the commit `411` measured. ⚠️ **Neither of them
     * has a selected conversation at all**: the host one drives `executeRuntimeCommand` directly
     * and the component one mounts the queue alone. `activeId` exists only inside `RuntimeScreen`,
     * which nothing in this repository mounts, so the one hop where the wrong id could still win
     * is reachable by source census and by nothing else.
     *
     * ⛔ **And the census above stops one argument short.** `toContain('store.respondPermission')`
     * passes unchanged on a door that sends `activeId.value` — the two assertions prove the verbs
     * are called and say nothing about what they are handed.
     *
     * ⚠️ **No `not.toContain('activeId')` here.** The comment inside `decideFromOverview` contains
     * the word, so a prose-blind negative goes red against the docblock rather than the code
     * (`a-source-census-must-strip-prose-before-it-asserts`). The control below is the other door.
     */
    it('🔴 …and it hands them the ROW’s own ids, never the selected conversation’s', () => {
      // ⛔ **Prose stripped, because `bodyOf` slices to the NEXT `\nfunction ` and therefore
      // swallows the following function's whole docblock** — so a `toContain` here is satisfiable
      // by a comment that merely quotes the call. `a-source-census-must-strip-prose-before-it-asserts`,
      // in the very file whose docblock invokes it.
      const code = (text: string): string =>
        text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
      const door = code(bodyOf('decideFromOverview'))
      expect(door).toContain('store.respondPermission(request.sessionId, request.requestId,')
      expect(door).toContain('store.respondUserInput(request.sessionId, request.requestId,')

      // ⚑ **The control, and it is the OTHER door in the same file.** `decide` — the card inside
      // the conversation on screen — really does send `activeId.value`, which is correct for it.
      // ⛔ Without this the two assertions above would pass on a file where neither verb had an
      // argument this search could see, and the spelling they exclude would be unfindable.
      const card = code(bodyOf('decide'))
      expect(card, 'the in-pane card no longer answers by the selected session').toContain(
        'store.respondPermission(activeId.value,',
      )
      expect(card).not.toContain('request.sessionId')
    })

    /**
     * 🔴 **The conversation is had BEFORE the select**, which is the defect `openRequest` has and
     * this must not inherit: selecting a session this window has no record for draws the LAUNCHER
     * while `focus` fails and reports *"load more of the transcript"* about a conversation that is
     * not on screen at all.
     *
     * ⚑ **D-017b · the claim became the host's `look`, behind the one door every press uses**
     * (`openConversation`): attached, taken when no window has it, or drawn from its ledger — and
     * nothing started. ⛔ So the order is asserted where it now lives, and the queue's route is
     * asserted to go through that door and stop when it did not open.
     */
    it('🔴 goToQuestion opens the conversation through the one door before it looks for the card', () => {
      const body = bodyOf('goToQuestion')
      expect(body).toContain('if (!(await openConversation(row.sessionId))) return')
      // ⛔ …and it goes to the CARD, not merely to the conversation — after the door, never before.
      expect(body).toContain('requestItems.get(row.requestId)')
      expect(body.indexOf('await openConversation(row.sessionId)')).toBeLessThan(
        body.indexOf('requestItems.get(row.requestId)'),
      )
      // ⚑ **The door itself**: a conversation this window is not fed is looked at first, and only
      // then shown — the record exists before the surface moves to it.
      const door = bodyOf('openConversation')
      expect(door).toContain('await store.look(sessionId)')
      expect(door).toContain('showConversation(opened, from)')
      expect(
        door.indexOf('await store.look(sessionId)'),
        'the surface navigated before it had a record to navigate to',
      ).toBeLessThan(door.indexOf('showConversation(opened, from)'))
      // ⛔ **Nothing is started to get there** — the door looks; it does not take over by claim.
      expect(door).not.toContain('store.claim(')
    })

    /**
     * ⛔ **A refusal keeps the last answer** — the other half of the `null` above.
     *
     * ⚠️ **Both populations, and each keeps its own** (403). The two reads go out together and
     * either can be refused on its own; a look that blanked one because the other failed would
     * make a dropped IPC call delete half of somebody's queue.
     */
    it('⛔ the look never writes a refusal into either population', () => {
      const body = bodyOf('lookForWhatIsYours')
      expect(body).toContain('if (questions !== null) escalated.value = questions')
      expect(body).toContain('if (decisions !== null) decided.value = decisions')
      // ⛔ **And they go out together**, so the count and the list it is over cannot straddle an
      // answer — see the function's own note.
      expect(body).toContain('await Promise.all([')
    })

    /**
     * 🔴 **The look is NOT gated on this window's own conversations, and the first version was.**
     *
     * ⛔ **`store.open` and the population this queue is about are disjoint**, which is the whole
     * reason the queue exists: the ordinary escalated question is raised by a child a PM spawned,
     * which is in the HOST's slots and in no window's records. A gate on `store.open` stopped
     * looking at the moment it mattered — close the PM and the worker goes on running — and a
     * cold window never looked at all. ⚠️ Asserted as the ABSENCE of the gate plus the presence
     * of the unconditional start, because an assertion about the interval alone was satisfied by
     * the unmount handler and said nothing about either.
     */
    it('🔴 the look runs for the life of the screen, not of an open conversation', () => {
      // ⚠️ **The closing `})` is deliberately NOT in the match** (438). `onMounted` gained a
      // second, unrelated poll — the digest's — and a census that pinned the whole block would
      // have gone red for a reason that has nothing to do with the rule it is protecting.
      //
      // 🔴 **534 · and the OPENING `onMounted(() => {` is no longer in it either, which is a
      // re-aim rather than a strip** (standing rule 26). ⛔ The handler gained a first statement —
      // `whenTheWorldMoves`, the one thing on that screen that is TOLD rather than asked — so the
      // old literal pinned *the look is the first line of the handler*, which was never the rule.
      // ⚑ **What the rule always was**: the look happens at mount, immediately, adjacent to its own
      // interval, and neither is inside a condition. The two-space indent is what carries the last
      // clause — a statement inside an `if` in this handler is indented four — and the planted pair
      // below is the control that says so.
      // ⚠️ **The end of the slice is searched FROM the start of it**, because this screen has an
      // earlier `onUnmounted(` — the clock's — and a slice taken from index 0 would be empty.
      const mountAt = CODE.indexOf('onMounted(() => {')
      const atMount = CODE.slice(mountAt, CODE.indexOf('onUnmounted(', mountAt))
      // ⚑ …and the slice really is the mount handler rather than an empty string.
      expect(mountAt).toBeGreaterThan(0)
      expect(atMount.length).toBeGreaterThan(200)
      // 🔴 **571 · RE-AIMED a second time, and again it is a re-aim rather than a strip**
      // (standing rule 26). ⛔ The interval's callback became a BLOCK — it now fires the rail's
      // live signal on the same tick, for the reason `readTheWorkspace`'s docblock gives — so the
      // old one-line literal pinned *the callback is an expression*, which was never the rule.
      // ⚠️ **And the old control stopped being one in the process**: it asserted the pair is
      // absent at FOUR-space indent, and four spaces is now where the interval's own body legally
      // lives, so left alone it would have gone red for the opposite of the reason it exists.
      // ⚑ **What the rule always was, in two shapes rather than one literal**: the look runs at
      // mount and the interval is armed, both at the handler's own two-space indent — a statement
      // inside an `if` here is indented four.
      const UNGATED = ['\n  void lookForWhatIsYours()\n', '\n  looking = setInterval(']
      for (const shape of UNGATED) expect(atMount, `${shape} is gated or gone`).toContain(shape)
      // ⛔ **The control, DERIVED from the same source rather than typed**: move exactly those two
      // statements inside a condition and both shapes stop matching
      // (`a-test-that-plants-and-finds-with-one-derivation`).
      const gated = atMount
        .replace(
          '\n  void lookForWhatIsYours()\n',
          '\n  if (running) {\n    void lookForWhatIsYours()\n  }\n',
        )
        .replace('\n  looking = setInterval(', '\n  if (running) looking = setInterval(')
      // ⛔ **The plant has to LAND** — a `replace` that matched nothing would leave `gated` equal
      // to the source and turn the control into a restatement (standing rule 28.2).
      expect(gated).not.toBe(atMount)
      for (const shape of UNGATED)
        expect(gated, `${shape} survived being gated`).not.toContain(shape)
      // ⚑ **And the interval really is the LOOK's**, on the cadence this queue owns — so the two
      // shapes above cannot be satisfied by an interval that arms something else.
      const armed = atMount.slice(atMount.indexOf('looking = setInterval('))
      const callback = armed.slice(0, armed.indexOf('LOOK_EVERY_MS)') + 'LOOK_EVERY_MS)'.length)
      expect(callback).toContain('void lookForWhatIsYours(true)')
      // ⛔ **No stop edge, counted rather than described.** The handle is named exactly four
      // times — declared, assigned, tested on unmount, cleared — and a gate that stopped the poll
      // when this window's open list emptied cannot be written without naming it again.
      expect(CODE.match(/\blooking\b/g) ?? []).toHaveLength(4)
      expect(CODE).not.toContain('looking = null')
      // ⚑ **Non-vacuity, planting the exact branch that was removed**: the count really does move.
      const planted = `${CODE}\n  if (!running && looking !== null) {\n    clearInterval(looking)\n    looking = null\n  }\n`
      expect(planted.match(/\blooking\b/g) ?? []).toHaveLength(7)
      expect(CODE).toContain('if (looking !== null) clearInterval(looking)')
      // ⛔ **And the module is put back to *nobody has answered*** — it outlives this component
      // under HMR, and a stale list pointing at conversations a new store never heard of is worse
      // than no list.
      expect(CODE).toContain('persons.forget()')
    })

    /**
     * 🔴 **Both `homeAttention` call sites pass all three populations** (401, from the review).
     *
     * ⛔ **The field is OPTIONAL, so leaving it off compiles and runs.** `HomeSurface` passed it
     * and this component did not, which made the rail draw no badge over a question the screen
     * that button opens was listing — `304`'s contradiction, re-created inside the dispatch that
     * cites it. ⚑ A census rather than one assertion, so a third call site added later is red.
     */
    it('🔴 every homeAttention call in the app counts the person’s own population', () => {
      const shape = /homeAttention\(\{[\s\S]*?\n {2}\}\)/g
      // ⛔ **EVERY production call site, derived from the tree** — see
      // {@link everyHomeAttentionCaller} for why this stopped being a hand-listed pair at `606`.
      // ⚑ **The argument is OPTIONAL**, which is the whole reason the census exists: leaving it
      // off compiles, runs, and makes the caller's arithmetic one population short.
      const callers = everyHomeAttentionCaller()
      // ⛔ **The roster itself is asserted**, because a walk that found nothing would satisfy
      // every `for` below — `a-negative-is-only-as-strong-as-the-search-shape`.
      expect(
        callers.map((one) => one.file).sort(),
        'the homeAttention roster is not the two surfaces that draw its numbers',
      ).toEqual(['components/RuntimeScreen.vue', 'components/WaitingOnYou.vue'])
      const calls = callers.flatMap((one) => [...one.code.matchAll(shape)].map((m) => m[0]))
      expect(calls.length, 'a homeAttention call site went missing').toBe(2)
      for (const call of calls) expect(call).toContain('onlyYou:')
      // ⚑ **Non-vacuity, planting a third**: the shape matches another call site, and matches one
      // that omits the field — so this is a census rather than a spelling of what is there today.
      const planted = `${CODE}\n  homeAttention({\n    requests: [],\n    unread: false,\n  })\n`
      const other = callers.find((one) => one.file !== 'components/RuntimeScreen.vue')!
      const found = [...planted.matchAll(shape), ...other.code.matchAll(shape)]
      expect(found).toHaveLength(3)
      expect(found.some((call) => !call[0].includes('onlyYou:'))).toBe(true)
    })

    /**
     * 🔴 **The view is captured BEFORE the surface moves** (095, and `reopen` did the same).
     * ⛔ A look is a round trip; a person who pressed ⌘N or went Home while it was in flight must
     * not have that taken away when it lands, which is what `select`'s own inline `view()` cannot
     * prevent after an await.
     *
     * ⚑ **D-017b · the capture moved into `openConversation`**, the one door every press opens a
     * conversation through, and the door ANSWERS whether it is on screen — so the queue's route
     * stops there rather than looking for a card on a pane that is not drawn.
     */
    it('🔴 the route captures the view before the await and refuses if the reader moved', () => {
      const door = bodyOf('openConversation')
      expect(door).toContain('const from = view()')
      expect(door.indexOf('const from = view()')).toBeLessThan(door.indexOf('await store.look('))
      expect(door).toContain('showConversation(opened, from)')
      expect(door).toContain('return place.value === null && activeId.value === opened')
      const body = bodyOf('goToQuestion')
      expect(body).not.toContain('select(row.sessionId)')
      expect(body).toContain('if (!(await openConversation(row.sessionId))) return')
    })

    /**
     * 🔴 **One live region in the SHELL, and it is POLITE.** ⛔ The app has nineteen others, each
     * of which exists only while it has something to say; the one that is unconditional beside
     * this is `ClosingShade`'s `assertive`, which is right there because the process is going
     * away and wrong here: a question has already waited thirty seconds and can wait for the
     * sentence a person is currently hearing. ⚠️ **This census is file-scoped and the sentence it
     * certifies now says so** — it said *"the app's only other"* and a two-second count refuted
     * it. ⚠️ **And it is the only announcement channel in this file** — a second
     * one added later would announce something that is not a question or a permission through a
     * channel this dispatch opened for exactly those.
     */
    it('🔴 the announcement is polite, off-screen, and the only live region in the shell', () => {
      const at = SCREEN.indexOf('<div class="only-for-a-reader"')
      expect(at, 'the shell draws no announcement region').toBeGreaterThan(0)
      const announcement = SCREEN.slice(at, SCREEN.indexOf('</div>', at))
      expect(announcement).toContain('role="status"')
      expect(announcement).toContain("persons.view.value?.announcement ?? ''")
      expect(announcement).not.toContain('aria-live')
      expect(announcement).not.toContain('role="alert"')

      // ⛔ **The census, with a control that plants TWO** — a second region added anywhere in this
      // file fails here even if the first is untouched.
      const regions = CODE.match(/role="(status|alert)"|aria-live=/g) ?? []
      expect(regions, `RuntimeScreen declares ${String(regions.length)} live regions`).toHaveLength(
        1,
      )
      // ⚑ **Non-vacuity**: the strip is what makes the count 1, and it must not have swallowed the
      // declaration along with the paragraph arguing for it.
      expect(CODE).toContain('role="status"')
      const planted = `${CODE}\n<p role="alert">something else entirely</p>\n<p aria-live="polite">and another</p>`
      expect(planted.match(/role="(status|alert)"|aria-live=/g)).toHaveLength(3)
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §8 · the population 401 could not see (403)
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **403 · the second population, in the view that merges them.**
 *
 * ⛔ **Merged in the VIEW and nowhere earlier**, because a person has one inbox and one count —
 * and every row says which of the two it is, so the merge is not a blend. ⚠️ Every claim below
 * is paired with the state it is not: the escalated row beside the decision row, both populations
 * beside one, and a refused read beside a landed one.
 */
describe('§8 · a decision only a person can make', () => {
  const DECISION = [onlyAPersons({ requestId: 'req_p', askedBy: 'sess_worker' })]

  it('🔴 a decision is a row, with its kind, its words and its own clock', () => {
    const view = personsQueueView([], DECISION, WORLD)
    const row = view!.rows[0]!
    expect(row.kind).toBe('a-decision')
    expect(row.says).toBe('a command or file approval, which is a person’s to give')
    // ⛔ **One hop, ending at you** — the chain a surface draws is `worker → you` and there is no
    // parent in it, because the request never travelled to one.
    // ⚑ **613 · and the asker of a permission ASKED** — it is a `RoutedRequest` like any other;
    // what it was refused is entry to the channel. See `RAISED_IT`.
    expect(row.chain).toEqual([
      { name: 'worker', you: false, did: 'asked' },
      { name: 'you', you: true, did: null },
    ])
    expect(row.unfollowable).toBe(false)
    expect(row.sentence).toBe('worker waiting on you')
    // ⛔ **The age is the ROUTING's, and it is measured where the two clocks DISAGREE.** The
    // fixture is routed at 1,000 and escalated at 31,000 with `now` at 91,000, so the routing
    // reads 2m and the escalation reads 1m — a row that read its neighbour's clock would say the
    // wrong number rather than no number. ⚑ The escalated row below is the other half.
    expect(row.since).toBe('2m ago')
    expect(DECISION[0]!.request.escalatedAt).toBeNull()
    expect(
      personsQueueView([asked({ requestId: 'req_1', askedBy: 'sess_worker' })], [], WORLD)!.rows[0]!
        .since,
    ).toBe('1m ago')
    expect(row.key).toBe('sess_worker:req_p')
    expect(row.sessionId).toBe('sess_worker')
  })

  /** ⚑ **The paired row**: an escalated question in the same view carries none of that. */
  it('⛔ an escalated row carries NO `says`, and that is a fact rather than a gap', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    const row = view!.rows[0]!
    expect(row.kind).toBe('a-question')
    expect(row.says).toBeNull()
    // ⚑ …and its chain has the middle the decision's does not.
    expect(row.chain.map((hop) => hop.name)).toEqual(['worker', 'pm', 'you'])
  })

  /**
   * 🔴 **`403` pinned *escalated first* here and `434` replaced that half** (criterion 17). ⛔ The
   * count over both is untouched and is what this still asserts; the ORDER is now
   * oldest-blocked-first over the merged list, which §9 measures where the two populations
   * interleave.
   */
  it('🔴 both populations are one list, oldest-blocked first, with one count over both', () => {
    const view = personsQueueView(
      // ⚑ Blocked at 31,000 — the escalation stamp, which is LATER than either routing below.
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [
        onlyAPersons({ requestId: 'req_p', askedBy: 'sess_w2', at: 1_000 }),
        onlyAPersons({ requestId: 'req_q', askedBy: 'sess_w3', at: 2_000 }),
      ],
      WORLD,
    )
    // ⛔ **The escalated row is LAST here, and under `403` it was first** — nothing about it
    // changed except that the list is now ordered by how long each thing has been blocked.
    expect(view!.rows.map((row) => row.kind)).toEqual(['a-decision', 'a-decision', 'a-question'])
    expect(view!.rows.map((row) => row.blockedSince)).toEqual([1_000, 2_000, 31_000])
    expect(view!.count).toBe(3)
    // ⛔ **The heading names the populations rather than a total noun**, because how much of a
    // summons somebody else might still take is part of what it says.
    expect(view!.heading).toBe('1 question and 2 decisions are waiting on you')
    expect(view!.announcement).toBe('1 question and 2 decisions waiting on you.')
  })

  it('⚑ one of each is said in the singular, and one alone names only its own kind', () => {
    const lone = personsQueueView([], DECISION, WORLD)
    expect(lone!.heading).toBe('A decision is waiting on you')
    expect(lone!.announcement).toBe('1 decision waiting on you.')
    expect(lone!.heading).not.toContain('question')

    const question = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(question!.heading).toBe('A question is waiting on you')
    expect(question!.heading).not.toContain('decision')
  })

  // ⚑ **UI-009 (F052) · the corner's quiet line is retired** — *"Nobody above them has answered. This
  // takes you to the card…"* explained the machinery and was false of a question asked directly, so
  // `PersonsQueueView.line`, its four tables and the test of its three arms went with it.

  /**
   * 🔴 **A refusal on ONE population may not take the other down with it** (403, from the review —
   * and the first version of this file asserted the opposite).
   *
   * ⛔ **Coupling them re-created the defect `401` exists to prevent.** Returning `null` when
   * EITHER read refused reads as the conservative choice; it is not. `null` means *nothing is
   * drawn*, Home counts a null view as zero, and one persistent failure of the verb `403` added
   * would therefore have deleted `401`'s escalated queue AND put the screen back to *"Nothing
   * needs you. The workspace is quiet."* over rows it had just read successfully.
   *
   * ⚑ **So `null` is BOTH refused, one refusal draws what landed, and the view says it is short.**
   */
  it('🔴 a refusal on one population draws the other, and discloses the hole', () => {
    const one = [asked({ requestId: 'req_1', askedBy: 'sess_w' })]

    const noDecisions = personsQueueView(one, null, WORLD)
    expect(noDecisions).not.toBeNull()
    expect(noDecisions!.count).toBe(1)
    expect(noDecisions!.rows.map((row) => row.kind)).toEqual(['a-question'])
    expect(noDecisions!.partial).toBe(true)

    const noQuestions = personsQueueView(null, DECISION, WORLD)
    expect(noQuestions).not.toBeNull()
    expect(noQuestions!.count).toBe(1)
    expect(noQuestions!.rows.map((row) => row.kind)).toEqual(['a-decision'])
    expect(noQuestions!.partial).toBe(true)

    // ⛔ **Neither landed is the ONE state that draws nothing**, and it is `401`'s `null` unchanged.
    expect(personsQueueView(null, null, WORLD)).toBeNull()

    // ⚑ **The paired positive**: both landed and empty is a VIEW that says nothing is waiting,
    // which is the state a surface is allowed to state — and it is NOT partial.
    const nothing = personsQueueView([], [], WORLD)
    expect(nothing).not.toBeNull()
    expect(nothing!.count).toBe(0)
    expect(nothing!.announcement).toBe('')
    expect(nothing!.partial).toBe(false)
    expect(personsQueueView(one, DECISION, WORLD)!.partial).toBe(false)
  })

  /**
   * ⛔ **A count of nothing is never printed, and the string behind it is true anyway** (403, from
   * the review). `waitingFor(0, 0)` says *"0 decisions"* — a noun for a population that is not
   * there — and the only thing keeping it off screen is the component's `v-if`.
   */
  it('⛔ the heading at zero is a true sentence, not "0 decisions"', () => {
    const nothing = personsQueueView([], [], WORLD)
    expect(nothing!.heading).toBe('Nothing is waiting on you')
    expect(nothing!.heading).not.toContain('0')
    // ⚑ The paired positive: at one it is the specific sentence again.
    expect(personsQueueView([], DECISION, WORLD)!.heading).toBe('A decision is waiting on you')
  })

  /**
   * ⛔ **The disclosure travels to the second population too.** A permission on a conversation
   * this window IS running is a card on the live queue as well, and the row says so rather than
   * being filtered out of a corner copy that has no list beside it.
   */
  it('⚑ a decision on a held conversation says its card is also listed, and names the gesture', () => {
    const view = personsQueueView([], DECISION, {
      ...WORLD,
      held: new Set(['sess_worker']),
      answerable: new Map([['sess_worker:req_p', live('sess_worker:req_p')]]),
    })
    expect(view!.rows[0]!.held).toBe(true)
    expect(view!.rows[0]!.action).toBe('Open the conversation')
    expect(view!.rows[0]!.alsoOnScreen).toBe(true)
    // ⚑ The paired negative: nobody holding it is the other FACT — not listed on screen — and,
    // since D-017b, the same one gesture, named the same.
    const loose = personsQueueView([], DECISION, WORLD)
    expect(loose!.rows[0]!.held).toBe(false)
    expect(loose!.rows[0]!.action).toBe('Open the conversation')
    expect(loose!.rows[0]!.alsoOnScreen).toBe(false)
  })

  /**
   * ⛔ **The vocabulary is closed and this surface renders it, member by member** — a reader that
   * matched `a-permission-decision` alone would be blind to four, and the queue would go on
   * listing nothing for them as the app is taught more shapes.
   */
  it('⛔ every refusal reaches the row with its own sentence, not just the permission', () => {
    const secret = onlyAPersons(
      { requestId: 'req_s', askedBy: 'sess_worker' },
      'a-secret-only-a-person-can-type',
      'a question whose answer is a secret, which is a person’s to type',
    )
    const view = personsQueueView([], [DECISION[0]!, secret], WORLD)
    expect(view!.rows.map((row) => row.says)).toEqual([
      'a command or file approval, which is a person’s to give',
      'a question whose answer is a secret, which is a person’s to type',
    ])
    // ⚑ **And both are the same KIND of row**, so the surface groups them by who may settle them
    // rather than by which member of the vocabulary they are.
    expect(view!.rows.every((row) => row.kind === 'a-decision')).toBe(true)
  })

  /**
   * ⛔ **The announcement channel's licence, now spent exactly.** The status grammar says a
   * question and a permission are the only things that may summon attention; `401` could spend
   * only the first half. ⚠️ It is still about nothing else.
   */
  it('⛔ the announcement is about these two things and nothing else', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      DECISION,
      WORLD,
    )
    expect(view!.announcement).toBe('1 question and 1 decision waiting on you.')
    for (const forbidden of ['error', 'failed', 'finished', 'complete', 'done', 'started']) {
      expect(view!.announcement.toLowerCase()).not.toContain(forbidden)
    }
  })

  /** ⛔ **A decision row invents no actor either** — the closed vocabulary of a row, by KEY. */
  it('⛔ no decision row carries a decider, a decision or a time-of-decision', () => {
    const view = personsQueueView([], DECISION, WORLD)
    expect(Object.keys(view!.rows[0]!).sort()).toEqual([
      // 🔴 **474 · WHICH WORK this row is about**, and it passes this census for the census's own
      // reason: it names a task the ASKER recorded, never a person and never a decision. ⛔ It is
      // the one field on this row that can say *"nothing this app records says"* — see `AboutWork`.
      'about',
      'action',
      'alsoOnScreen',
      'answers',
      'blockedSince',
      'blockedSinceIs',
      'chain',
      // What the request asks, as its card discloses it: the ask's own words, never a decider, a
      // decision or an instant.
      'disclosed',
      'held',
      'key',
      'kind',
      'limit',
      // 🔴 **701 · what the provider's marks say** (`700` §5 GAP 1), and it passes this census for
      // the census's own reason: it is the ASK's own sentences — why no grant is here, why Deny
      // leads, the provider's reason — carried from the live card. ⛔ No decider, no decision, no
      // instant: they bound an answer nobody has given.
      'marksSay',
      'noAnswerHere',
      // 🔴 **487 · why the request offers no way to ALLOW it**, and it passes this census for the
      // census's own reason: it is not a decider, a decision or a time-of-decision. ⛔ It is a
      // sentence about what this row CANNOT do, on a row that is still waiting — and 487's whole
      // point is that it can still be refused, which is why it is not a {@link NoAnswerHere}.
      'noPositive',
      // 🔴 **UI-009 · a question THIS APP asked, as its card reads it** (it replaced `619`'s
      // `offered`), and it passes this census for the census's own reason: its words, the asker's
      // offer and whether this window sent an answer. ⛔ It names no decider, records no decision
      // and carries no instant.
      'question',
      // 🔴 **468 · why the last answer BOUNCED**, and it passes this census for the reason the
      // census exists: it is not a decider, a decision or a time-of-decision. ⛔ It is the
      // transcript item's own sentence about a gesture that did NOT land, on a row that is still
      // waiting — the opposite of a settlement, carried here so the surface that made the gesture
      // can say what happened to it.
      'refused',
      // 🔴 **701 · refusal is this ask's default** — a fact the PROVIDER put on the ask, about the
      // order of the answers it offers. ⛔ Not a decision: nobody has refused anything.
      'refusesFirst',
      'requestId',
      'says',
      'sentence',
      'sessionId',
      'since',
      'unfollowable',
      'words',
      'work',
    ])
    const text = JSON.stringify(view)
    for (const word of ['actor', 'Actor', 'decidedBy', 'decidedAt', 'denied', 'allowed']) {
      expect(text, `the queue invented ${word}`).not.toContain(word)
    }
    // ⚑ **Non-vacuity**: the census can go red on the exact shape it is watching for.
    expect(`${text}"decidedBy":"pm"`).toContain('decidedBy')
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────
// §9 · 434 · one place, one order, and a clear that goes through the door that exists
// ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **434 · HO-024/HO-025 criteria 17 and 20.**
 *
 * ⛔ **`403` left three things false and this is where two of them are asserted.** The list was
 * concatenated rather than ordered; the surface navigated rather than settled; and a read that
 * stopped answering was invisible. ⚑ The third is `§9.4`, and it is the one nobody would notice.
 */
describe('§9.1 · the order is one ordering over both populations', () => {
  it('🔴 oldest-blocked first, interleaved — not escalated-then-decisions', () => {
    const view = personsQueueView(
      [
        // ⚑ `escalatedAt` is the escalated row's instant; `at` is ignored for it.
        asked({ requestId: 'q_new', askedBy: 'sess_a', at: 100, escalatedAt: 80_000 }),
        asked({ requestId: 'q_old', askedBy: 'sess_b', at: 100, escalatedAt: 20_000 }),
      ],
      [
        onlyAPersons({ requestId: 'd_oldest', askedBy: 'sess_c', at: 10_000 }),
        onlyAPersons({ requestId: 'd_middle', askedBy: 'sess_d', at: 50_000 }),
      ],
      WORLD,
    )
    expect(view!.rows.map((row) => row.requestId)).toEqual([
      'd_oldest',
      'q_old',
      'd_middle',
      'q_new',
    ])
    // ⛔ **The two clocks are named on the rows**, so one ordering over two facts is honest rather
    // than one fact invented over two populations.
    expect(view!.rows.map((row) => row.blockedSinceIs)).toEqual([
      'routed',
      'told',
      'routed',
      'told',
    ])
  })

  /**
   * 🔴 **612 · a question an agent ADDRESSED to a person says `routed`, and never `told`**
   * (HO-088 §3.1).
   *
   * ⛔ **`BlockedSinceIs` exists to say WHICH EVENT a row's instant came off** — its own docblock
   * opens *"`told` and `routed` are not the same event"* — and `told` is `escalatedAt`'s word: the
   * moment a DEADLINE announced a question to somebody.
   *
   * ⚠️ **Since `612` nothing announces anything.** A row that reached a person because its asker
   * named them, or because a parent passed it up, was a person's from the instant it was ROUTED —
   * which is the argument `decisionsAwaitingAPerson` has always made for a permission, now true of
   * a second population. ⚑ **A queue saying `told` over one would be this app claiming an
   * announcement it never made**, which is `222`'s false sentence with a timestamp on it.
   *
   * ⛔ **Both arms in one view**, because the word is only worth anything if the two differ here.
   */
  it('🔴 612 · an ADDRESSED question says `routed`; only a historic stamp says `told`', () => {
    const view = personsQueueView(
      [
        asked({
          requestId: 'q_addressed',
          askedBy: 'sess_a',
          went: { is: 'the-person-the-asker-named', to: 'a-person' },
          at: 40_000,
          escalatedAt: null,
        }),
        asked({ requestId: 'q_historic', askedBy: 'sess_b', at: 10_000, escalatedAt: 50_000 }),
      ],
      [],
      WORLD,
    )
    const byId = new Map(view!.rows.map((row) => [row.requestId, row]))
    expect(byId.get('q_addressed')?.blockedSinceIs).toBe('routed')
    expect(byId.get('q_addressed')?.blockedSince).toBe(40_000)
    // ⚑ **The CONTROL, one fact over**: a row a pre-`612` deadline stamped keeps the word and the
    // instant that belong to it — so the assertion above is a distinction rather than a constant.
    expect(byId.get('q_historic')?.blockedSinceIs).toBe('told')
    expect(byId.get('q_historic')?.blockedSince).toBe(50_000)
  })

  it('⛔ a row with NO instant sorts LAST, and says where it went', () => {
    const view = personsQueueView(
      [
        asked({ requestId: 'q_none', askedBy: 'sess_a', escalatedAt: null }),
        asked({ requestId: 'q_new', askedBy: 'sess_b', escalatedAt: 80_000 }),
      ],
      [onlyAPersons({ requestId: 'd_old', askedBy: 'sess_c', at: 10_000 })],
      WORLD,
    )
    // ⛔ **Last, and never first.** `?? 0` would have put the clockless row at the TOP, which is
    // the strongest claim this list makes — *this is the one that has waited longest* — over a row
    // that cannot support it. ⚑ `attention.ts`'s `byUrgency` already ruled this for the live queue;
    // two queues in one panel may not sort an unknown two different ways.
    expect(view!.rows.map((row) => row.requestId)).toEqual(['d_old', 'q_new', 'q_none'])
    const last = view!.rows[2]!
    expect(last.blockedSince).toBeNull()
    expect(last.blockedSinceIs).toBe('not-recorded')
    // ⚠️ **Said, not only sorted** — a row at the bottom with no words reads as the newest.
    expect(last.since).toBeNull()
  })

  it('⚑ the comparator is TOTAL — equal instants break by population, then by key', () => {
    const question = { ...asked({ requestId: 'q', askedBy: 'sess_a', escalatedAt: 5_000 }) }
    const decision = onlyAPersons({ requestId: 'd', askedBy: 'sess_b', at: 5_000 })
    const view = personsQueueView([question], [decision], WORLD)
    // ⛔ **`a-decision` first on a tie, which is `byUrgency`'s ruling in this vocabulary**: a
    // permission freezes the composer as well as the turn, so of two things of one age it is the
    // one that has stopped more.
    expect(view!.rows.map((row) => row.kind)).toEqual(['a-decision', 'a-question'])
    // ⚑ Two rows of one kind and one age are ordered by key, so five seconds later the list is the
    // same list — a queue that re-orders between two looks is one a person cannot read twice.
    const twins = personsQueueView(
      [],
      [
        onlyAPersons({ requestId: 'z', askedBy: 'sess_z', at: 7_000 }),
        onlyAPersons({ requestId: 'a', askedBy: 'sess_a', at: 7_000 }),
      ],
      WORLD,
    )
    expect(twins!.rows.map((row) => row.key)).toEqual(['sess_a:a', 'sess_z:z'])
    // ⛔ …and the comparator itself never answers 0, which is what makes a sort stable across
    // engines rather than by luck.
    const [one, two] = twins!.rows
    expect(byBlockedSince(one!, two!)).toBeLessThan(0)
    expect(byBlockedSince(two!, one!)).toBeGreaterThan(0)
  })
})

describe('§9.2 · clearing it there — the answers, and why there are none', () => {
  const ROW = [asked({ requestId: 'req_1', askedBy: 'sess_worker' })]

  it('🔴 a row the live queue holds carries the card’s own answers, and nothing invents them', () => {
    const view = personsQueueView(ROW, [], {
      ...WORLD,
      held: new Set(['sess_worker']),
      answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1')]]),
    })
    const row = view!.rows[0]!
    // ⛔ **The live row's own list, in its order and in its words** — `permissionOffer` and
    // `userInputOffer` decide it, and this copies. A second computation is `214 §3`.
    expect(row.answers.map((one) => one.label)).toEqual(['Allow', 'Deny'])
    expect(row.noAnswerHere).toBeNull()
    expect(row.limit).toBeNull()
    expect(row.alsoOnScreen).toBe(true)
  })

  it('⛔ nobody is holding it, so there is nothing to press — and the reason says the next move', () => {
    const view = personsQueueView(ROW, [], WORLD)
    const row = view!.rows[0]!
    expect(row.answers).toEqual([])
    expect(row.noAnswerHere).toBe('not-yours-yet')
    expect(row.held).toBe(false)
  })

  it('⛔ held, but the card is not in this window’s page — a different absence, said differently', () => {
    const view = personsQueueView(ROW, [], { ...WORLD, held: new Set(['sess_worker']) })
    expect(view!.rows[0]!.noAnswerHere).toBe('not-in-this-window')
  })

  it('🔴 an answer already on its way takes the buttons away and says so (207 M2)', () => {
    const view = personsQueueView(ROW, [], {
      ...WORLD,
      held: new Set(['sess_worker']),
      answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1', { sent: true })]]),
    })
    const row = view!.rows[0]!
    expect(row.answers).toEqual([])
    expect(row.noAnswerHere).toBe('answer-sent')
  })

  it('⛔ a request that offers nothing is said, never drawn as an empty row of controls', () => {
    const view = personsQueueView(ROW, [], {
      ...WORLD,
      held: new Set(['sess_worker']),
      answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1', { decisions: [] })]]),
    })
    expect(view!.rows[0]!.noAnswerHere).toBe('nothing-on-offer')
  })

  /**
   * ⛔ **A limit is NOT *nothing may be done here*.** `userInputOffer` always offers Reject — the
   * protocol-safe default the contract names — so a question with four parts can still be released
   * from this row even though it cannot be answered from it.
   */
  it('⚑ a limited request keeps its answers and carries the limit beside them', () => {
    const view = personsQueueView(ROW, [], {
      ...WORLD,
      held: new Set(['sess_worker']),
      answerable: new Map([
        [
          'sess_worker:req_1',
          live('sess_worker:req_1', {
            kind: 'question',
            limit: 'multiple',
            decisions: [{ kind: 'reject', label: 'Reject' }],
          }),
        ],
      ]),
    })
    const row = view!.rows[0]!
    expect(row.limit).toBe('multiple')
    expect(row.noAnswerHere).toBeNull()
    expect(row.answers.map((one) => one.label)).toEqual(['Reject'])
  })

  /**
   * ⛔ **Exactly one of the two, on every row, in every state.**
   *
   * ⚠️ **The list is hand-written and the vocabulary is closed, which is a pairing that goes stale
   * silently** — `468` added a member and found four worlds here. ⛔ A world per member, and a new
   * member owes this list one.
   */
  it('🔴 answers and the reason there are none are never both, and never neither', () => {
    const worlds: PersonsQueueWorld[] = [
      WORLD,
      { ...WORLD, held: new Set(['sess_worker']) },
      {
        ...WORLD,
        held: new Set(['sess_worker']),
        answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1')]]),
      },
      {
        ...WORLD,
        answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1', { sent: true })]]),
      },
      // ⚑ **468 · the fifth state.** The list was four worlds while the vocabulary had four
      // members, and a hand-written list does not grow with the union — so the invariant would
      // have gone on passing over a member nothing here reaches.
      {
        ...WORLD,
        held: new Set(['sess_worker']),
        answeredFromHere: new Set(['sess_worker:req_1']),
      },
    ]
    for (const world of worlds) {
      const row = personsQueueView(ROW, [], world)!.rows[0]!
      expect(row.answers.length > 0, JSON.stringify(row.noAnswerHere)).toBe(
        row.noAnswerHere === null,
      )
    }
  })

  /**
   * 🔴 **The doors are called with the row and the decision, and the module sends nothing
   * itself** — it has no store, no bridge and no host in it, which is what keeps the clear on the
   * one path `respondPermission`/`respondUserInput` already own.
   */
  it('🔴 settle and takeOver reach the doors, with the row that was pressed', () => {
    const queue = createPersonsQueue()
    const settled: { key: string; label: string }[] = []
    const over: string[] = []
    const went: string[] = []
    queue.supply(
      walked(ROW),
      walked([]),
      {
        ...WORLD,
        held: new Set(['sess_worker']),
        answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1')]]),
      },
      {
        travel: (row) => went.push(row.key),
        settle: (row, decision) => settled.push({ key: row.key, label: decision.label }),
        takeOver: (row) => over.push(row.key),
        open: () => {},
      },
    )
    const row = queue.view.value!.rows[0]!
    queue.settle(row, row.answers[1]!)
    queue.takeOver(row)
    queue.take(row)
    expect(settled).toEqual([{ key: 'sess_worker:req_1', label: 'Deny' }])
    expect(over).toEqual(['sess_worker:req_1'])
    expect(went).toEqual(['sess_worker:req_1'])
    // ⛔ **The queue holds no idea of its own about what is closed** — the row is still there after
    // the press, because only the ledger may take it away. A surface that removed it here would be
    // a second opinion about what is settled, which is what criterion 17 forbids by name.
    expect(queue.view.value!.rows).toHaveLength(1)
    expect(queue.view.value!.count).toBe(1)
  })

  /** ⛔ **Nothing is pre-selected and nothing is default.** HO-024 §5.5, and relay 1 §5. */
  it('⛔ no answer is marked default, preferred or pre-selected', () => {
    const view = personsQueueView(ROW, [], {
      ...WORLD,
      answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1')]]),
    })
    const row = view!.rows[0]!
    for (const decision of row.answers) {
      expect(Object.keys(decision).sort()).not.toContain('default')
      expect(Object.keys(decision).sort()).not.toContain('preferred')
      expect(Object.keys(decision).sort()).not.toContain('recommended')
    }
    // ⚑ …and the order is the provider's, through `attention.ts`, not one this surface chose.
    expect(row.answers.map((one) => one.label)).toEqual(['Allow', 'Deny'])
  })
})

describe('§9.3 · what a person needs to answer it — criterion 20’s three clauses', () => {
  it('🔴 who asked is the first hop, and it is the conversation the CARD is in', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    const row = view!.rows[0]!
    expect(row.chain[0]).toEqual({ name: 'worker', you: false, did: 'asked' })
    expect(row.sessionId).toBe('sess_worker')
  })

  it('🔴 which work is the ASKER’s open work, and the row never claims it is the subject', () => {
    const view = personsQueueView(
      [
        asked({
          requestId: 'req_1',
          askedBy: 'sess_worker',
          // ⚑ D-016 · a piece reads by its label, never a task number.
          work: [{ label: 'W1.2' }, { label: 'W1.3' }],
        }),
      ],
      [],
      WORLD,
    )
    expect(view!.rows[0]!.work).toEqual([{ label: 'W1.2' }, { label: 'W1.3' }])
  })

  it('⚑ no work recorded is a FACT and not a read that failed', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(view!.rows[0]!.work).toEqual([])
  })

  it('🔴 each answer says its own IMMEDIATE effect, and nothing says what the model does next', () => {
    expect(
      whatThisAnswerDoes({ kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } }),
    ).toBe('the agent may do this once')
    expect(whatThisAnswerDoes({ kind: 'reject', label: 'Reject' })).toContain('declined')
    expect(
      whatThisAnswerDoes({ kind: 'approve', label: 'Approve', consent: 'access-for-this-turn' }),
    ).toContain('granted')
    expect(
      whatThisAnswerDoes({ kind: 'answer', label: 'Yes', questionId: 'q', option: 'Yes' }),
    ).toContain('“Yes”')
    // ⛔ **Every permission outcome, pinned** — `299 §1`'s hazard is the one this is about: the
    // three `allow` shapes differ only in how WIDE they are, and a sentence that described the
    // narrow one under the wholesale button is the defect that dispatch found on a live surface.
    const effectOf = (outcome: PermissionDecision['outcome']): string =>
      whatThisAnswerDoes({ kind: 'permission', label: outcome, decision: { outcome } })
    expect(effectOf('allow')).toBe('the agent may do this once')
    // ⚑ 736 · R94 — the CLI's own rule for the ask, no longer *"the same thing again"*.
    expect(effectOf('allow_for_session')).toBe(
      'the agent may do this, and what the provider’s own rule for it covers, for this conversation',
    )
    expect(effectOf('allow_all_for_session')).toBe(
      'the agent may do anything of this kind for this conversation',
    )
    // ⚑ 736 · R95 — the outcome that outlives the conversation, pinned with the rest. 🔴 739 ·
    // re-aimed — `736`'s placeholder became the line for a decision that carries no `keeps` (one
    // that does names the rule and the file, `always-allow-on-every-surface.render.test.ts`).
    expect(effectOf('allow_always')).toBe(
      'the agent may do this, and the provider’s own rule for it is kept beyond this conversation',
    )
    expect(effectOf('deny')).toBe('the agent is refused this one thing')
    // ⚑ **478 · the scope.** *"the request is cancelled"* read like a politer `deny`, and both
    // adapters interrupt the whole turn before they answer at all.
    // ⚠️ **492 · the CLAIM, after the act became real on the third door.** *is interrupted* said the
    // turn was over; the press sends the ask, and `interrupt_agent` performs the same act and has
    // always said `asked`. ⛔ Still one literal here and not `ASKED_TO_STOP`: an oracle computed
    // from the thing it checks is not an oracle.
    expect(effectOf('cancel')).toBe('the whole turn is asked to stop, and this request is refused')
    // ⛔ **`430`'s narrowing, held by the words themselves**: not one effect sentence promises a
    // downstream outcome, and the gap is stated once rather than implied by omission.
    for (const outcome of [
      'allow',
      'allow_for_session',
      'allow_all_for_session',
      'allow_always',
      'deny',
      'cancel',
    ] as const) {
      const said = whatThisAnswerDoes({
        kind: 'permission',
        label: outcome,
        decision: { outcome },
      })
      for (const promise of ['will ', 'then ', 'finishes', 'succeeds', 'completes']) {
        expect(said, `${outcome} promised something downstream`).not.toContain(promise)
      }
    }
    expect(WHAT_COMES_AFTER_IS_NOT_OURS).toContain('does not predict')
  })
})

describe('§9.4 · a read that has STOPPED answering, which `partial` could not see', () => {
  const ROW = [asked({ requestId: 'req_1', askedBy: 'sess_worker' })]

  it('🔴 the rows are kept and the staleness is disclosed — both halves', () => {
    const view = personsQueueView(ROW, [], {
      ...WORLD,
      lastLookAnswered: { questions: false, decisions: true },
    })
    // ⛔ **Kept**, because blanking a queue on a dropped IPC call is the strongest false claim this
    // app can make about somebody's own workload…
    expect(view!.rows).toHaveLength(1)
    // …and ⛔ **disclosed**, because a list frozen at the minute a read died omits everything that
    // has arrived since, and an omission reads as *nothing arrived*.
    expect(view!.stale).toBe(true)
    // ⚠️ **A different hole from `partial`** — this list HAS been read, just not lately.
    expect(view!.partial).toBe(false)
  })

  it('⛔ at zero rows a stale list may not say "nothing is waiting on you"', () => {
    const view = personsQueueView([], [], {
      ...WORLD,
      lastLookAnswered: { questions: true, decisions: false },
    })
    expect(view!.count).toBe(0)
    expect(view!.heading).toBe('One list has stopped answering')
    expect(view!.heading).not.toContain('Nothing is waiting')
  })

  it('⚑ both holes at once are two sentences, and the never-read one leads', () => {
    const view = personsQueueView(null, [], {
      ...WORLD,
      lastLookAnswered: { questions: false, decisions: true },
    })
    expect(view!.partial).toBe(true)
    expect(view!.stale).toBe(true)
    expect(view!.heading).toBe('One list could not be read')
  })

  it('⛔ the ordinary state says neither', () => {
    const view = personsQueueView(ROW, [], WORLD)
    expect(view!.stale).toBe(false)
    expect(view!.partial).toBe(false)
  })
})

/**
 * 🔴 **§9.5 · the LAG, as a number** (relay-adjacent; dispatch §2.1 — *"a number, not an
 * adjective"*).
 *
 * ⛔ **Criterion 17 says *clearing it there clears it everywhere*, not *instantly*.** What this
 * pins is the bound and where it comes from, so the number in the response cannot drift away from
 * the code:
 *
 * | surface | how it learns | lag |
 * |---|---|---|
 * | the card, the rail, the live overview | the answer is awaited and the record's fold closes the item — no poll | one round trip |
 * | **this queue** | the next look | **up to {@link LOOK_EVERY_MS} plus one read** |
 *
 * ⚑ **The read's own cost is measured** rather than assumed — `scripts/waiting-set-probe.mjs`:
 * 3.9 ms at a 20k-event ledger, 214 ms at 2M events. ⛔ So the worst case a person sees is
 * `LOOK_EVERY_MS + one read`, and on the biggest ledger measured that is about 5.2 s.
 */
describe('§9.5 · the lag is bounded by the look, and the bound is stated', () => {
  it('🔴 nothing in this module shortens the poll, and the bound is LOOK_EVERY_MS', () => {
    expect(LOOK_EVERY_MS).toBe(5_000)
    // ⛔ **A row settled here is still in the view until a look says otherwise**, which IS the lag
    // and is why it has to be said out loud rather than papered over with a local removal.
    const queue = createPersonsQueue()
    queue.supply(
      walked([asked({ requestId: 'req_1', askedBy: 'sess_worker' })]),
      walked([]),
      {
        ...WORLD,
        answerable: new Map([['sess_worker:req_1', live('sess_worker:req_1')]]),
      },
      { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
    )
    const row = queue.view.value!.rows[0]!
    queue.settle(row, row.answers[0]!)
    expect(queue.view.value!.rows.map((one) => one.key)).toEqual(['sess_worker:req_1'])
    // ⚑ …and the look is what removes it: the next supply carries the ledger's answer.
    queue.supply(walked([]), walked([]), WORLD, {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: () => {},
    })
    expect(queue.view.value!.rows).toEqual([])
  })
})

/**
 * 🔴 **§9.6 · the stale hole reaches Home's own claim, not only the queue's card** (434).
 *
 * ⛔ **`403` wired `partial` into `homeAttention.unread` for exactly this reason** and `434`'s hole
 * would otherwise have walked straight past it: with one list frozen and nothing in it, every count
 * on Home is zero and *"Nothing needs you. The workspace is quiet."* is drawn over a list the app
 * stopped hearing from. ⚑ `086`: not knowing is not an all-clear — and *no longer knowing* is not
 * one either.
 */
describe('§9.6 · a stale list forbids "quiet" on Home too', () => {
  it('🔴 stale alone is enough to stop the all-clear', () => {
    const quiet = homeAttention({ requests: [], onlyYou: 0, unread: false })
    expect(quiet.quiet).toBe(true)
    expect(quiet.intro).toBe('Nothing here is blocked on an answer from you.')
    const stopped = homeAttention({ requests: [], onlyYou: 0, unread: true })
    // ⛔ **The all-clear is withdrawn and a sentence about not knowing takes its place** — the
    // intro says so rather than the screen simply going silent.
    expect(stopped.quiet).toBe(false)
    expect(stopped.intro).not.toBe('Nothing here is blocked on an answer from you.')
    expect(stopped.intro).toContain('could not be read')
  })

  /**
   * ⛔ **The wiring, as a source census** — because the arithmetic above passes whatever the two
   * call sites actually pass in.
   *
   * ## 🔴 453 · this census was watching ONE of the two call sites, and the other had drifted
   *
   * ⚠️ **`403` §7 censused `partial` at both call sites; `434` widened *what forbids quiet* to
   * `partial || stale` and this test followed it into `HomeSurface.vue` alone.** ⛔ The rail's own
   * call in `RuntimeScreen.vue` went on passing `partial` by itself, so `homeNeedsYou` could say
   * *"Nothing needs you. The workspace is quiet."* over a list that had stopped answering while the
   * card beside it disclosed exactly that — `304`'s contradiction, inside the dispatch that cites
   * it.
   *
   * ⚑ **So the census is now about the SHAPE that made the drift possible**: both call sites read
   * one derived field, and neither spells a hole's name. A call site that reaches back for
   * `partial` alone fails here whichever of the two it is.
   */
  it('⛔ BOTH call sites read one derived field, and neither names a hole', () => {
    // ⛔ **The roster is DERIVED, not listed** — `606`, and the same repair as §7's census: this
    // pair named `HomeSurface.vue`, which stopped calling `homeAttention` when `EXT-008` §3 moved
    // the queue to its own destination. ⚑ Rule `27.1`: *a census is scoped by what it is ABOUT,
    // not by where the things it is about currently live.*
    const sites = everyHomeAttentionCaller()
    expect(
      sites.map((one) => one.file).sort(),
      'the homeAttention roster is not the two surfaces that draw its numbers',
    ).toEqual(['components/RuntimeScreen.vue', 'components/WaitingOnYou.vue'])
    for (const { file: name } of sites) {
      const source = readFileSync(
        fileURLToPath(new URL(`../src/renderer/src/${name}`, import.meta.url)),
        'utf8',
      )
      const at = source.indexOf('homeAttention({')
      expect(at, `${name} calls homeAttention`).toBeGreaterThan(-1)
      const whole = source.slice(at, source.indexOf('}),', at))
      // 🔴 **Comments stripped first, and this census was WRONG until a mutation said so.**
      // `434 M14` removed `stale` from the call and SURVIVED, because the comment directly above
      // the line explains the holes by name — so the census read the note that justifies the code
      // instead of the code (`a-source-census-must-strip-prose-before-it-asserts`).
      const code = whole.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
      expect(code, `${name} passes unread`).toContain('unread:')
      expect(code, `${name} reads the derived field`).toContain('mayBeShort')
      // ⛔ **And it names no hole.** Reaching for one is how the two call sites came apart.
      // ⚑ **685 · and neither reaches for a band's own field** — `limits` or `stalled` spelled at a
      // call site is the same drift one field over (`678` F3's census, tightened).
      for (const hole of ['partial', 'stale', 'noLedger', 'rowsDropped', 'limits', 'stalled']) {
        expect(code, `${name} reaches past mayBeShort for ${hole}`).not.toContain(hole)
      }
      // ⚑ **The strip is measured, not assumed**: the prose really is in the slice, so a census
      // without it would pass on a mutated file.
      expect(whole, `${name} explains itself in prose`).toMatch(/partial|stale|hole/)
      expect(code, `${name} · the strip did not remove the prose`).not.toContain('hole')
    }
  })

  /**
   * 🔴 **453 · and the derived field is the disjunction of all four, not of the two it began as.**
   *
   * ⛔ **A behavioural census, because the source one above cannot see the arithmetic.** Each hole
   * is planted ALONE, with a control that plants none — `a-positive-assertion-must-differ-from-the
   * -default`: a `mayBeShort` hard-coded `true` passes every arm but the control.
   */
  it('🔴 every one of the four holes alone sets `mayBeShort`', () => {
    const ordinary = walked([])!
    const none = foldPersonsQueue(ordinary, ordinary, WORLD)!
    expect(none.mayBeShort, 'the control').toBe(false)
    // ⛔ `partial` — one read has never answered.
    expect(foldPersonsQueue(null, ordinary, WORLD)!.mayBeShort).toBe(true)
    // ⛔ `stale` — the most recent look did not answer.
    expect(
      foldPersonsQueue(ordinary, ordinary, {
        ...WORLD,
        lastLookAnswered: { questions: true, decisions: false },
      })!.mayBeShort,
    ).toBe(true)
    // ⛔ `noLedger` — every look that answered walked nothing.
    const blind = { rows: [], walk: 'no-ledger' as const, ledgers: 0, rowsUnread: 0 }
    expect(foldPersonsQueue(blind, blind, WORLD)!.mayBeShort).toBe(true)
    // ⛔ `rowsDropped` — a ledger row this app could not read.
    expect(foldPersonsQueue({ ...ordinary, rowsUnread: 1 }, ordinary, WORLD)!.mayBeShort).toBe(true)
  })
})
