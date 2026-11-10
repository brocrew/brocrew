import type {
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
} from '../../src/shared/question-contracts'
import { afterEach, describe, expect, it } from 'vitest'
import type { AttentionRequest } from '../../src/renderer/src/lib/attention'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'

import type { WaitingOnWhoWrote } from '../../src/shared/waiting-on-who-wrote'

/** A later clock ages the row of work waiting on a person's reply. */

const NOW = 1_700_000_000_000

const queue = usePersonsQueue()

afterEach(() => {
  queue.forget()
})

function aPieceWaiting(): WaitingOnWhoWrote {
  return {
    piece: 'work_1',
    label: 'W1.1',
    title: 'Build the pages',
    owner: 'sess_ada',
    ownerName: 'Ada',
    answeredAt: NOW - 300_000,
  }
}

function fullLedger<Row>(walk: LedgerWalkKind): LedgerWalk<Row> {
  return { rows: [], walk, ledgers: 1, rowsUnread: 0 }
}

/** The queue handed one owed row and nothing else, against `now`. */
function supplyAt(now: number): void {
  queue.supply(
    fullLedger<PersonsQuestion>('every-conversation-that-routed'),
    fullLedger<PersonsDecision>('every-conversation-that-routed'),
    {
      held: new Set<string>(),
      answerable: new Map<string, AttentionRequest>(),
      now,
      lastLookAnswered: { questions: true, decisions: true },
      answeredFromHere: new Set<string>(),
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
    undefined,
    undefined,
    undefined,
    {
      walked: {
        rows: [aPieceWaiting()],
        walk: 'every-conversation-that-was-given-work',
        ledgers: 1,
        rowsUnread: 0,
      },
      lastLookAnswered: true,
    },
  )
}

describe('a later clock ages the owed row', () => {
  it('says 5m ago when read, and 6m ago a minute later', () => {
    supplyAt(NOW)
    expect(queue.waitingOnWhoWrote.value?.rows.map((row) => row.since)).toEqual(['5m ago'])
    supplyAt(NOW + 60_000)
    expect(queue.waitingOnWhoWrote.value?.rows.map((row) => row.since)).toEqual(['6m ago'])
  })
})
