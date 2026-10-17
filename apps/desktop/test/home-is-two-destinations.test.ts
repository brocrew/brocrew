import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

const SRC = new URL('../src/renderer/src/', import.meta.url)
const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, SRC)), 'utf8')

/** Every comment out, so a census reads code rather than the prose that explains it. */
const stripped = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const SCREEN = read('components/RuntimeScreen.vue')
const RAIL = read('components/SideRail.vue')
const WAITING = read('components/WaitingOnYou.vue')
const AWAY = read('components/RecentActivity.vue')
const SINCE = read('components/SinceYouWereLastHere.vue')

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

  /**
   * ⛔ **A rail row and a palette row, both**, because `570` measured what having only the second
   * costs: a screen the product could not take a person to.
   */
  it('⛔ each has a rail row, and each rail row is marked WIRED', () => {
    const code = stripped(RAIL)
    for (const [cy, place] of [
      ['rail-waiting', 'waiting'],
      ['rail-away', 'away'],
    ] as const) {
      const at = code.indexOf(`data-cy="${cy}"`)
      expect(at, `the rail has no ${cy} row`).toBeGreaterThan(-1)
      const row = code.slice(code.lastIndexOf('<button', at), code.indexOf('</button>', at))
      expect(row, `${cy} does not navigate`).toContain(`emit('go', '${place}')`)
      // 🔴 **§3.2's rule, in the direction that is easy to get wrong.** ⛔ A `not-wired` mark on a
      // destination that IS wired is as false as a missing one on a destination that is not —
      // `front-door-words.ts`: *nothing unwired implies a working state.*
      expect(row, `${cy} does not declare itself wired`).toContain('data-wired="true"')
      expect(row, `${cy} carries a soon mark over a wired surface`).not.toContain('not-wired')
    }
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

  /**
   * ⛔ **A place with no branch in `<main>` renders NOTHING**, which is the failure `568` shipped
   * and `570` found: a component that exists and a window that can never show it.
   */
  it('⛔ each place has a branch in RuntimeScreen’s <main>, and it mounts its own component', () => {
    const code = stripped(SCREEN)
    expect(code.indexOf('<main class="main">'), 'the census is reading nothing').toBeGreaterThan(-1)
    const main = code.slice(code.indexOf('<main class="main">'), code.indexOf('</main>'))
    // An archived conversation's read-only history, opened from a link, is drawn over any place.
    expect(main).toMatch(/^<main class="main">\s*<LinkedHistory\s+v-if="linkedHistory"/)
    expect(main).toMatch(/<WaitingOnYou\s+v-else-if="surface === 'waiting'"/)
    expect(main).toMatch(/<RecentActivity\s+v-else-if="surface === 'away'"/)
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

  /**
   * ⛔ **The RAIL draws exactly one count, and it is the complete one** — `EXT-008` §5:
   * *"Destinations only… No counts, no `+`, no lists, no explanatory sentences."*
   */
  it('⛔ the windowed count is NOT on the rail, and the rail never imports it', () => {
    const code = stripped(RAIL)
    // ⚑ The positive first, or the negatives below are about a file with no badges in it.
    expect(code).toContain('data-cy="waiting-badge"')
    expect(code).not.toContain('data-cy="away-badge"')
    expect(code).not.toContain('recent-activity')
    // ⛔ **And the `away` row draws no `count badge` at all**, which is the claim the handle above
    // could not make on its own: a badge with a different handle would pass it.
    const at = code.indexOf('data-cy="rail-away"')
    expect(at).toBeGreaterThan(-1)
    const row = code.slice(code.lastIndexOf('<button', at), code.indexOf('</button>', at))
    expect(row).not.toContain('count badge')
  })

  /**
   * 🔴 **Waiting on you's stat is the complete count alone.** The "Since you were last here" box
   * on the same page draws its windowed counts itself, from what it is handed, and the stat never
   * reads them.
   */
  it('🔴 the windowed counts are drawn beside the complete one and never inside it', () => {
    const waiting = stripped(WAITING)
    expect(waiting).toContain('homeAttention(')
    expect(waiting).not.toMatch(/sinceLastHere[^\n]*\.(finished|failed)/)
    expect(stripped(SINCE)).not.toContain('homeAttention')
    expect(stripped(AWAY)).not.toContain('homeAttention')
  })

  it('⛔ nothing anywhere adds an activity count to a queue count', () => {
    const fold = /\.(finished|failed)[^\n]*\+[^\n]*total|total[^\n]*\+[^\n]*\.(finished|failed)/
    for (const file of [
      'components/SideRail.vue',
      'components/RuntimeScreen.vue',
      'components/WaitingOnYou.vue',
    ]) {
      expect(stripped(read(file)), `${file} sums the two populations`).not.toMatch(fold)
    }
    // ⚑ **Non-vacuity**: the pattern really does catch the fold it is written for.
    expect('const bad = homeNeedsYou.total + since.view.finished').toMatch(fold)
  })
})

describe('§3 · activity is read only where it is drawn', () => {
  /**
   * 🔴 **DERIVED from the routing, not spelled.** ⛔ `606`'s own drop once left the digest's read
   * gated on a place that no longer drew it, and nothing went red. So the place is read off the
   * `v-else-if` that MOUNTS `RecentActivity`, and the read is asserted against it.
   */
  it('🔴 the read names the place Recent activity is routed on, and Waiting on you for its box', () => {
    const code = stripped(SCREEN)
    const routed = /<RecentActivity\s+v-else-if="surface === '([a-z]+)'"/.exec(code)
    expect(routed, 'RecentActivity is not routed in this file at all').not.toBeNull()
    const place = routed![1]!
    expect(place).toBe('away')

    const body = code.slice(code.indexOf('async function readActivity('))
    expect(body).toContain(`if (surface.value === '${place}') return readPage()`)
    expect(body).toContain(`if (surface.value === 'waiting') return readSince()`)
    // ⚑ **And arriving reads again at once**, so neither page shows a reading a tick old.
    expect(code).toContain(`if (now === '${place}' || now === 'waiting') void readActivity()`)
  })
})

describe('§4 · the soon mark came off nothing, because nothing was wired', () => {
  /**
   * ⛔ **§3.2, and `front-door-words.ts` names the defect:** *nothing unwired implies a working
   * state.* ⚑ The two destinations are wired, so neither carries a mark — and since D-016 the
   * placeholder dashboard that kept its own mark is gone.
   *
   * ⚠️ A `not wired` group inside a destination the rail badges as wired is the same defect one
   * level in.
   */
  it('⛔ neither destination carries a placeholder mark', () => {
    for (const [name, source] of [
      ['WaitingOnYou', WAITING],
      ['RecentActivity', AWAY],
    ] as const) {
      const code = stripped(source)
      expect(code, `${name} declares itself unwired`).toContain('data-wired="true"')
      expect(code, `${name} carries a placeholder banner`).not.toContain('PlaceholderBanner')
      expect(code, `${name} carries a soon chip`).not.toContain('SoonChip')
      expect(code, `${name} draws a seeded row`).not.toContain('AttentionRow')
    }
  })
})
