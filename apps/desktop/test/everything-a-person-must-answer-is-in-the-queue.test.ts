import type { LedgerWalkKind } from '../src/shared/question-contracts'
import { describe, expect, it } from 'vitest'
import { attentionQueue } from '../src/renderer/src/lib/attention'
import { personsQueueView, type PersonsQueueKind } from '../src/renderer/src/lib/persons-queue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { applyEvent, isAwaitingAnswer } from '../src/renderer/src/lib/transcript'
import { decisionReading, readingSentence } from '../src/shared/questions'
import type { CreatedSession, RuntimeEvent } from '../src/shared/runtime-ipc'

/**
 * Everything this app can be waiting on a person for appears in the queue: a card that waits is
 * counted, listed in the panel and listed live, and every queue population can be placed.
 */

/** A card of each kind, keyed by the item kind `isAwaitingAnswer` admits. */
const A_CARD_OF_EACH_KIND: Readonly<Record<string, RuntimeEvent>> = {
  permission: {
    type: 'permission_request',
    id: 'req_perm',
    kind: 'command',
    action: 'Bash',
    detail: 'rm -rf /tmp/build',
    scope: {
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny'],
      underDisclosed: false,
    },
  } as RuntimeEvent,
  userInput: {
    type: 'user_input_request',
    id: 'req_ask',
    prompt: 'Which colour?',
    questions: [{ id: 'q1', prompt: 'Pick a colour', options: [{ label: 'Red' }] }],
  } as RuntimeEvent,
}

function recordWith(sessionId: string, events: readonly RuntimeEvent[]): SessionRecord {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: `/Users/alex/work/${sessionId}`,
    profileId: 'default',
  } as CreatedSession
  record.phase = 'open'
  for (const event of events) applyEvent(record.control, event, 1_000)
  return record
}

describe('§4 · every card a person must answer reaches every surface that counts them', () => {
  it.each(Object.keys(A_CARD_OF_EACH_KIND))(
    '🔴 a waiting %s is counted, panelled and listed live — none of the three may miss it',
    (kind) => {
      const record = recordWith('sess_1', [A_CARD_OF_EACH_KIND[kind]!])
      const state = record.control
      const waiting = state.items.filter(isAwaitingAnswer)
      // ⚑ The fixture really did land as a waiting card — or everything below is vacuous.
      expect(waiting).toHaveLength(1)
      expect(waiting[0]!.kind).toBe(kind)

      // 1 · the O(1) counter `attentionQueue` gates on, and the rail badge reads.
      const counted = state.pending.permissions + state.pending.questions
      expect(counted).toBe(1)

      // The panel lists the item and counts it as blocked on the person, withholding the
      // empty paragraph. Its heading names all three populations, so omitting a kind from the
      // count would make the sentence false as well as the gate wrong.
      const panel = sessionPanel(state)
      expect(panel.waiting).toBe(1)
      expect(panel.empty).toBe(false)

      // 3 · the cross-conversation queue lists it, with an answer on it. ⛔ `106`: a row that can
      //     name no gesture is a control that cannot act.
      const live = attentionQueue([record], () => 'waiting')
      expect(live).toHaveLength(1)
      expect(live[0]!.decisions.length).toBeGreaterThan(0)
    },
  )

  it('⚑ and all of them at once — the counts are sums and not a first-match', () => {
    const record = recordWith('sess_all', Object.values(A_CARD_OF_EACH_KIND))
    const kinds = Object.keys(A_CARD_OF_EACH_KIND).length
    expect(record.control.items.filter(isAwaitingAnswer)).toHaveLength(kinds)
    expect(record.control.pending.permissions + record.control.pending.questions).toBe(kinds)
    expect(sessionPanel(record.control).waiting).toBe(kinds)
    expect(attentionQueue([record], () => 'waiting')).toHaveLength(kinds)
  })

  it('⛔ and a card that STOPPED waiting leaves all three — the negative, so the sum is not a constant', () => {
    const record = recordWith('sess_gone', [A_CARD_OF_EACH_KIND.userInput!])
    applyEvent(record.control, { type: 'request_resolved', id: 'req_ask' })
    expect(record.control.items.filter(isAwaitingAnswer)).toHaveLength(0)
    expect(record.control.pending.questions).toBe(0)
    expect(sessionPanel(record.control).waiting).toBe(0)
    expect(attentionQueue([record], () => 'waiting')).toHaveLength(0)
  })
})

describe('§4 · every population of the person’s queue can be placed in it', () => {
  /**
   * ⛔ **A `Record` over the vocabulary, so the compiler is the census.** A fourth
   * {@link PersonsQueueKind} does not compile until somebody has said what a row of it looks like,
   * and the assertion then proves `personsQueueView` can actually place one.
   */
  /**
   * ⚑ **453 · the ordinary walk around a fixture list** — `personsQueueView` takes a `LedgerWalk`
   * per population now, and every case here means *a walk that opened a ledger and dropped
   * nothing*.
   */
  const walked = <Row>(
    rows: readonly Row[],
    walk: LedgerWalkKind = 'every-conversation-that-routed',
  ) => ({
    rows,
    walk,
    ledgers: Math.max(rows.length, 1),
    rowsUnread: 0,
  })

  const ONE_OF_EACH: Record<PersonsQueueKind, () => ReturnType<typeof personsQueueView>> = {
    'a-question': () =>
      personsQueueView(
        walked([
          {
            request: {
              requestId: 'req_q',
              askedBy: 'sess_w',
              parent: 'sess_p',
              at: 1_000,
              state: 'open',
              escalatedAt: 2_000,
              went: { is: 'the-parent', to: 'the-parent' },
            },
            // ⚑ **611 · the moment it became a person's** — the deadline's stamp here, which is
            // what `RuntimeHost.questionsForAPerson` copies onto the row.
            aPersonsSince: 2_000,
            chain: [],
            reading: decisionReading('sess_w', (id) => id),
            sentence: readingSentence(decisionReading('sess_w', (id) => id)),
            work: [],
            // ⚑ **D-017 · R6 — spelled as the host serves them.** The row's offer is read now
            // whoever holds the asker, so a fixture that left it out would be read as an offer with
            // nothing in it. ⚠️ A provider raised this one, so its card was drawn and it offers
            // nothing to press from the row (`whatTheAskerOffered` is this app's questions only).
            raisedBy: 'the-provider',
            offered: null,
            asked: null,
          },
        ] as never),
        walked([]),
        WORLD,
      ),
    'a-decision': () =>
      personsQueueView(
        walked([]),
        walked([
          {
            request: {
              requestId: 'req_d',
              askedBy: 'sess_w',
              parent: null,
              at: 1_000,
              state: 'open',
              escalatedAt: null,
              because: 'permission-shaped',
            },
            reading: decisionReading('sess_w', (id) => id),
            sentence: readingSentence(decisionReading('sess_w', (id) => id)),
            says: 'a command or file approval, which is a person’s to give',
            work: [],
          },
        ] as never),
        WORLD,
      ),
  }

  const WORLD = {
    held: new Set<string>(),
    answerable: new Map(),
    now: 60_000,
    lastLookAnswered: { questions: true, decisions: true },
    /** ⚑ **468 · this window has answered nothing.** */
    answeredFromHere: new Set<string>(),
  }

  it.each(Object.keys(ONE_OF_EACH) as PersonsQueueKind[])(
    '🔴 a %s row is placed, counted once and says which instant its age is',
    (kind) => {
      const view = ONE_OF_EACH[kind]()
      expect(view).not.toBeNull()
      expect(view!.count).toBe(1)
      expect(view!.rows[0]!.kind).toBe(kind)
      // ⛔ **Every row says WHICH instant its number is** (434), and `not-recorded` would mean the
      // fixture's stamp never crossed — which would make the ordering assertion below vacuous.
      expect(view!.rows[0]!.blockedSinceIs).not.toBe('not-recorded')
      // ⚑ **And the heading names this population in the singular**, which is the derived sentence
      // rather than a branch: a kind with no noun cannot reach here at all.
      expect(view!.heading).toMatch(/^A [a-z]+ is waiting on you$/)
      expect(view!.announcement).not.toBe('')
    },
  )
})
