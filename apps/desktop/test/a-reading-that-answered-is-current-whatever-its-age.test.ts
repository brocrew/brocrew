import { describe, expect, it } from 'vitest'
import { workingTogetherView, type CastReading } from '../src/renderer/src/lib/working-together'
import { agoWords } from '../src/renderer/src/lib/clock'

/**
 * # 🔴 W4.74 · D-033 · the band says no age while its read answered, however old
 *
 * ⚑ The band (`workingTogetherView`) re-read every half minute until W4.74, and drew *"Read N ago"*
 * once a reading was older than one poll. ⚑ Since D-033 every move of the work is pushed and the
 * band is read again on it, so an answered reading is the current one whatever its age — ⛔ an age
 * on it would say *stale* about a band that is not. The age is said only for a reading KEPT after a
 * read that did not answer: the one that may be behind.
 *
 * ⚑ The Work tab's twin (`workGivenOutView`) is pinned in `the-work-this-conversation-gave-out`; the
 * band's is pinned here through the fold, where `the-first-picture-of-who-called-whom` pins the line
 * a person reads.
 */

const NOW = 1_800_000_000_000
const PARENT = 'sess_parent'

/** ⚑ One child on the band — `a-childs-state`'s planted reading, read at `readAt`. */
function reading(answered: boolean, readAt: number): CastReading {
  return {
    conversation: PARENT,
    read: {
      conversation: PARENT,
      readAt,
      parent: null,
      children: {
        rows: [
          {
            conversation: 'sess_child',
            identity: 'worker',
            provider: 'claude',
            running: 'unwatched',
          },
        ],
        walk: 'every-conversation-this-one-spawned',
        ledgers: 1,
        rowsUnread: 0,
      },
      workGivenOut: {
        rows: [],
        walk: 'every-conversation-this-one-gave-work-to',
        ledgers: 1,
        rowsUnread: 0,
      },
      workTakenIn: {
        rows: [],
        walk: 'every-piece-of-work-this-one-was-given',
        ledgers: 1,
        rowsUnread: 0,
      },
    },
    answered,
    atWork: null,
  }
}

const viewOf = (answered: boolean, readAt: number) =>
  workingTogetherView({
    reading: reading(answered, readAt),
    forConversation: PARENT,
    identities: null,
    now: NOW,
  })

describe('W4.74 · the band’s age line', () => {
  it('🔴 an ANSWERED reading says no age — an hour old, a day old', () => {
    for (const age of [0, 30_000, 3_600_000, 86_400_000]) {
      const view = viewOf(true, NOW - age)
      expect(view, 'the band drew nothing at all').not.toBeNull()
      expect(view?.asOf, `an answered reading ${String(age)} ms old said an age`).toBeNull()
    }
  })

  it('⛔ …a reading KEPT after a read that did not answer says its age — even a young one', () => {
    const old = viewOf(false, NOW - 600_000)
    expect(old?.asOf).toBe(agoWords(NOW - 600_000, NOW))
    expect(old?.asOf).toBe('10m ago')
    // ⚑ No threshold below which a kept reading goes quiet: the poll it was measured against is gone.
    const young = viewOf(false, NOW - 5_000)
    expect(young?.asOf).toBe('5s ago')
  })

  it('⛔ the line is decided by whether the read answered, not by the reading’s age', () => {
    // ⚑ The same reading, the same instant, one fact over.
    expect(viewOf(true, NOW - 600_000)?.asOf).toBeNull()
    expect(viewOf(false, NOW - 600_000)?.asOf).not.toBeNull()
  })
})
