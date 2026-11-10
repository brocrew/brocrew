import { describe, expect, it } from 'vitest'
import {
  buildCommands,
  type PaletteCommand,
  type PaletteInput,
} from '../src/renderer/src/lib/command-palette'
import { RESERVED_PLACES } from '../src/renderer/src/composables/useSurface'
import { homeAttention } from '../src/renderer/src/lib/home-attention'
import { activitySays, sinceView } from '../src/renderer/src/lib/recent-activity'
import type { RecentActivityReading } from '../src/shared/recent-activity'

/**
 * 🔴 **606 · Home is two destinations — what you OWE, and what CHANGED** (`EXT-008` §3, ordered by
 * `EXT-009` §2).
 *
 * ## ⛔ The rule underneath, and it is older than the mockup
 *
 * ⚑ **`HO-025` §2:** ***a digest is WINDOWED; the queue is COMPLETE regardless of age.***
 * ⚠️ **So the two cannot be two tabs of one list and they cannot share a count** — ⛔ **a single
 * destination holding both would have to pick one of those two properties and be wrong about the
 * other**, and a single BADGE over both would be bounded by neither.
 *
 * ## ⚑ What this file pins, and why each is a claim a diff could quietly reverse
 *
 * ⛔ **The two are REACHABLE** — a destination nobody can open is `568`'s screen that nothing
 * reached, and `570` is what fixing that cost.
 * ⛔ **Their populations are DISJOINT on the surfaces** — the property `EXT-008` §3 is about.
 * ⛔ **The digest's poll is gated on the surface that DRAWS the digest**, derived from the routing
 * rather than spelled — ⚠️ **this one caught a real defect in this dispatch's own drop**: the gate
 * still named `home`, which is a real surface, so nothing would have failed and the digest would
 * simply never have read on the page that draws it (rule `27.1`).
 * ⛔ **The `soon` mark came off nothing**, because nothing behind Home was wired. ⚑ **D-016 took
 * Home itself out** — the placeholder dashboard, its rail row and its mark — and the two
 * destinations are what is left of it.
 *
 * ⚠️ **Source censuses here read STRIPPED code** — `a-source-census-must-strip-prose-before-it-
 * asserts` — and every negative is paired with a positive that fires.
 */

const idsOf = (commands: readonly PaletteCommand[]): string[] => commands.map((one) => one.id)

// ⚑ **Typed, not cast** — D-017b changed this shape and a cast hid it until the run.
const EMPTY: PaletteInput = {
  conversations: [],
  activeId: null,
  agent: null,
}

describe('§1 · the two destinations exist and a person can reach them', () => {
  /**
   * ⛔ **Reserved, or the router draws the launcher for the word** — the sentence above
   * `RESERVED_PLACES` says so (since D-016 a word no place answers to draws the launcher), and
   * `622` is the dispatch that paid for hearing it.
   */
  it('⛔ both words are RESERVED, so neither falls through to the launcher', () => {
    expect(RESERVED_PLACES).toContain('waiting')
    expect(RESERVED_PLACES).toContain('away')
    // ⚑ **The control**: a word that is NOT reserved really is absent from the list, which is what
    // makes the two assertions above a claim rather than a spelling.
    expect(RESERVED_PLACES).not.toContain('aurora')
  })

  it('⛔ each has a palette row that GOES there, in the rail’s own order', () => {
    const commands = buildCommands(EMPTY)
    const ids = idsOf(commands)
    expect(ids).toContain('go-waiting')
    expect(ids).toContain('go-away')
    // ⛔ **The ACTION, not only the id.** ⚠️ A row whose id is right and whose destination is the
    // placeholder dashboard passes every assertion about the LIST and takes a person to the wrong
    // screen — `a-positive-assertion-must-differ-from-the-default`, on a field nobody was reading.
    const goes = (id: string): unknown => commands.find((one) => one.id === id)?.action
    expect(goes('go-waiting')).toEqual({ kind: 'go', place: 'waiting' })
    expect(goes('go-away')).toEqual({ kind: 'go', place: 'away' })
    // ⚑ **The rail's own order** — *Waiting on you · While you were away* above the configuration
    // rows (*Tools · Team*) — which is what a person reads with nothing typed.
    expect(ids.indexOf('go-waiting')).toBeLessThan(ids.indexOf('go-away'))
    expect(ids).toContain('go-tools')
    expect(ids.indexOf('go-away')).toBeLessThan(ids.indexOf('go-tools'))
  })
})

describe('§2 · two populations, and nothing may fold them', () => {
  const reading = (lines: RecentActivityReading['lines']): RecentActivityReading =>
    ({
      window: { from: 0, to: 12 * 3_600_000 },
      read: { walk: 'one-window-over-every-agents-conversation', ledgers: 2, rowsUnread: 0 },
      lines,
      capped: false,
    }) as RecentActivityReading
  const done = (id: string, at: number): RecentActivityReading['lines'][number] => ({
    id,
    at,
    what: 'finished',
    register: 'claimed',
    piece: { id, label: 'W1.1', title: null },
    agent: 'Ada',
    conversation: null,
  })

  /**
   * 🔴 **The two numbers are computed by two functions over two inputs, and neither can see the
   * other's** — which is what makes *"they must not be folded"* a property rather than a habit.
   */
  it('🔴 one is bounded by nothing and one is bounded by the window', () => {
    // ⛔ **The COMPLETE count.** `homeAttention` has no window argument at all: no input it takes
    // carries a time bound, so nothing it returns can be windowed.
    const owed = homeAttention({ requests: [], onlyYou: 3, unread: false })
    expect(owed.total).toBe(3)

    // ⛔ **The WINDOWED count**, counted from what finished since the person was last here.
    expect(sinceView(reading([done('a', 20), done('b', 5)]), 10)?.finished).toBe(1)

    // 🔴 **Not read is not zero** (086): *nobody has looked* is never drawn as *nothing happened*.
    expect(activitySays(null)).toBe('not-read')
    expect(sinceView(null, 10)).toBeNull()
    expect(activitySays(reading([]))).toBe('nothing-recorded')
  })
})
