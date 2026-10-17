import { describe, expect, it } from 'vitest'
import { whatTheWaitsCouldNotRead } from '../src/renderer/src/lib/conversation-waits'
import { forestView } from '../src/renderer/src/lib/the-forest'
import type { WhatEachConversationIsWaitingOn } from '../src/shared/tasks'
import type { ForestNode, TheWholeForest } from '../src/shared/the-whole-forest'

/**
 * # 🔴 685 · §2.3 — the waits reading's own unread rows, said where its plates are (`676` F-R18a)
 *
 * ⚑ **`676` gave `whatEachConversationIsWaitingOn` a `rowsUnread`** — a torn row there cannot say
 * whose wait it was, so a plate can read *idle* over a conversation that is waiting — and **no
 * renderer code read it**: every consumer goes through `theWaitIn`, which returns one wait and drops
 * the count. ⛔ The rail and the Team page's forest draw plates from that reading and said nothing.
 *
 * ⚑ **The sentence is spelled as a LITERAL here**, never through `rowsUnreadSays`
 * (`a-fixture-built-with-the-helper-under-test-proves-nothing`), and its load-bearing clause —
 * *"or its state may be wrong"* — is asserted by name (standing rule 5).
 */

const NOW = 1_800_000_000_000
/** ⚑ The waits count's sentence — what a torn row there can do: a plate reads *idle* while it waits. */
const SAYS = (n: number): string =>
  `${String(n)} ${n === 1 ? 'row' : 'rows'} of this app’s record could not be read, so a conversation shown here may be waiting without saying so.`
/** The forest walk's own sentence (`678`) — work may be missing, or its state wrong. */
const WORK_SAYS = (n: number): string =>
  `${String(n)} ${n === 1 ? 'row' : 'rows'} of this app’s record could not be read, so a piece of work may be missing here, or its state may be wrong.`

const reading = (
  rowsUnread: number,
  conversations: readonly string[] = ['sess_a'],
): WhatEachConversationIsWaitingOn => ({
  readAt: NOW,
  conversations: conversations.map((conversation) => ({
    conversation,
    identity: 'worker',
    waiting: null,
    work: null,
  })),
  rowsUnread,
})

describe('685 §2.3 · `whatTheWaitsCouldNotRead`', () => {
  it('🔴 a reading that could not read 2 rows, over a drawn plate, says the one sentence', () => {
    expect(whatTheWaitsCouldNotRead(reading(2), ['sess_a'])).toBe(SAYS(2))
    expect(whatTheWaitsCouldNotRead(reading(1), ['sess_a'])).toBe(SAYS(1))
    // ⛔ …and NOT the work sentence: no row the rail or the forest draws comes from this reading, so
    // *a piece of work may be missing here* would be false of it (`685`'s review).
    expect(whatTheWaitsCouldNotRead(reading(2), ['sess_a'])).toContain(
      'may be waiting without saying so',
    )
    expect(whatTheWaitsCouldNotRead(reading(2), ['sess_a'])).not.toContain('may be missing')
  })

  it('⛔ the controls — each moves ONE fact, and each says nothing', () => {
    // nothing unread
    expect(whatTheWaitsCouldNotRead(reading(0), ['sess_a'])).toBeNull()
    // nobody has looked
    expect(whatTheWaitsCouldNotRead(null, ['sess_a'])).toBeNull()
    // the reading covers none of the plates this surface drew
    expect(whatTheWaitsCouldNotRead(reading(2, ['sess_b']), ['sess_a'])).toBeNull()
    // nothing drawn at all
    expect(whatTheWaitsCouldNotRead(reading(2), [])).toBeNull()
    // ⚠️ a hand-built reading with no count — the wire is a trust boundary
    expect(
      whatTheWaitsCouldNotRead({ ...reading(0), rowsUnread: undefined } as never, ['sess_a']),
    ).toBeNull()
  })
})

const conversation = (id: string): ForestNode =>
  ({
    node: 'a-conversation',
    conversation: id,
    under: { is: 'the-person' },
    identity: 'worker',
    provider: 'claude',
    status: 'idle',
    running: 'unwatched',
    standsInFor: [],
    inItsPlace: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW - 1_000,
    spawnedAt: null,
    spawnReason: null,
  }) as ForestNode

const forest = (forestUnread: number, waits: WhatEachConversationIsWaitingOn | null) =>
  forestView({
    forest: {
      readAt: NOW,
      nodes: {
        rows: [conversation('sess_a')],
        walk: 'every-conversation-this-app-placed',
        ledgers: 1,
        rowsUnread: forestUnread,
      },
      conversations: 1,
      heldByNoAgent: 0,
    } as TheWholeForest,
    atWork: null,
    waits,
    identities: null,
    held: new Set<string>(),
  })!

describe('685 §2.3 · the forest carries the waits reading’s count BESIDE its own, never summed', () => {
  it('🔴 forest 3, waits 2 — two sentences, two counts', () => {
    const view = forest(3, reading(2))
    expect(view.coverage.rowsUnread).toBe(3)
    expect(view.coverage.short).toBe(WORK_SAYS(3))
    expect(view.coverage.waitsShort).toBe(SAYS(2))
  })

  it('⛔ the controls — waits 0, and a waits reading that covers no drawn plate', () => {
    expect(forest(3, reading(0)).coverage.waitsShort).toBeNull()
    expect(forest(0, reading(2, ['sess_elsewhere'])).coverage.waitsShort).toBeNull()
    expect(forest(0, null).coverage.waitsShort).toBeNull()
  })
})
