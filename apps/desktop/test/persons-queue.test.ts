import type {
  AboutWork,
  EscalationChain,
  HowItWasRaised,
  LedgerWalk,
  LedgerWalkKind,
  OfferedAnswer,
  PersonsDecision,
  PersonsQuestion,
  RequestOnlyAPersonCanSettle,
  RoutedRequest,
  WorkInHand,
} from '../src/shared/question-contracts'
import { describe, expect, it } from 'vitest'
import {
  CHAIN_HOP_LIMIT,
  chainReading,
  NOTHING_NAMED_THE_WORK,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
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

  it('the sentence IS the reading joined, for every shape the walk can produce', () => {
    const pm = routed({ requestId: 'req_2', askedBy: 'sess_pm', parent: 'sess_lead' })
    const a = routed({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' })
    const b = routed({ requestId: 'req_b', askedBy: 'sess_b', parent: 'sess_a' })
    // An independent literal per shape: comparing the join with `chainSentence` alone would stay
    // green while both moved together.
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
      // Legal on the wire though `escalationChain` never builds it: a walk with no hops must not
      // read as a bare `you`.
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
})

describe('nobody has answered, nothing is waiting, and the walk did not arrive', () => {
  it('a walk that could not be followed is the THIRD absence, and it is on the row', () => {
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

  it('the drawn chain reconstructs the host’s own evidence line', () => {
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

  it('one is said in the singular, on both the heading and the announcement', () => {
    const view = personsQueueView(
      [asked({ requestId: 'req_1', askedBy: 'sess_worker' })],
      [],
      WORLD,
    )
    expect(view!.heading).toBe('A question is waiting on you')
    expect(view!.announcement).toBe('1 question waiting on you.')
  })

  // This poll is the whole latency between an agent asking and a person knowing, so it must
  // stay faster than the summary read.
  it('a person’s obligations are re-read more often than a summary, and that is the whole rule', () => {
    expect(LOOK_EVERY_MS).toBeLessThan(ACTIVITY_READ_EVERY_MS)
    expect(LOOK_EVERY_MS).toBeGreaterThan(0)
    expect(LOOK_EVERY_MS).not.toBe(ACTIVITY_READ_EVERY_MS)
    // Not the cheapest cadence in the app: each look folds every ledger that routed a request.
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

  it('an unread list forbids "quiet", and says so instead of counting nothing', () => {
    const unread = homeAttention({ requests: [], unread: true })
    expect(unread.quiet).toBe(false)
    expect(unread.total).toBe(0)
    expect(unread.unread).toBe(true)
    // "Not known", never "0 items": there is no number to give.
    expect(unread.stat).toBe('Not known')
    expect(unread.statTone).toBe('waiting')
    expect(unread.intro).toContain('could not be read just now')

    // The same empty world, read, is quiet.
    const known = homeAttention({ requests: [] })
    expect(known.quiet).toBe(true)
    expect(known.unread).toBe(false)
    expect(known.stat).toBe('All clear')
    expect(known.intro).toBe('Nothing here is blocked on an answer from you.')
  })

  it('⚠️ a caller that does not look for them counts none — the field is optional, not defaulted true', () => {
    const before = homeAttention({ requests: [] })
    expect(before.onlyYou).toBe(0)
    // ⛔ The claim this case makes is about `onlyYou` being absent rather than defaulted.
    expect(before.total).toBe(0)
  })
})

/** A bridge with both person-facing reads on it, carried over the wire as the app's is. */
function bridgeThat(
  answer: () => Promise<readonly PersonsQuestion[]>,
  decisions: () => Promise<readonly PersonsDecision[]> = () => Promise.resolve([]),
): RuntimeBridge {
  return everythingOverTheWire({
    questionsForAPerson: answer,
    decisionsForAPerson: decisions,
    onEvent: () => () => {},
    onLiveness: () => () => {},
  }) as unknown as RuntimeBridge
}

describe('a read that did not answer is not an all-clear', () => {
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

  it('the heading at zero is a true sentence, not "0 decisions"', () => {
    const nothing = personsQueueView([], [], WORLD)
    expect(nothing!.heading).toBe('Nothing is waiting on you')
    expect(nothing!.heading).not.toContain('0')
    // ⚑ The paired positive: at one it is the specific sentence again.
    expect(personsQueueView([], DECISION, WORLD)!.heading).toBe('A decision is waiting on you')
  })

  it('every refusal reaches the row with its own sentence, not just the permission', () => {
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

  it('the announcement is about these two things and nothing else', () => {
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

describe('what a person needs to answer it', () => {
  it('which work is the ASKER’s open work, and the row never claims it is the subject', () => {
    const view = personsQueueView(
      [
        asked({
          requestId: 'req_1',
          askedBy: 'sess_worker',
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
 * The visible lag includes the next look and the time that read takes.
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

describe('a stale list forbids "quiet" on Home too', () => {
  // Each hole is planted alone, beside a control that plants none.
  it('every one of the four holes alone sets `mayBeShort`', () => {
    const ordinary = walked([])!
    const none = foldPersonsQueue(ordinary, ordinary, WORLD)!
    expect(none.mayBeShort, 'the control').toBe(false)
    // `partial`: one read has never answered.
    expect(foldPersonsQueue(null, ordinary, WORLD)!.mayBeShort).toBe(true)
    // `stale`: the most recent look did not answer.
    expect(
      foldPersonsQueue(ordinary, ordinary, {
        ...WORLD,
        lastLookAnswered: { questions: true, decisions: false },
      })!.mayBeShort,
    ).toBe(true)
    // `noLedger`: every look that answered walked nothing.
    const blind = { rows: [], walk: 'no-ledger' as const, ledgers: 0, rowsUnread: 0 }
    expect(foldPersonsQueue(blind, blind, WORLD)!.mayBeShort).toBe(true)
    // `rowsDropped`: a ledger row this app could not read.
    expect(foldPersonsQueue({ ...ordinary, rowsUnread: 1 }, ordinary, WORLD)!.mayBeShort).toBe(true)
  })
})
