import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { liveSignalView } from '../../src/renderer/src/lib/live-signal'
import {
  providerLimitsView,
  type ProviderLimitsView,
} from '../../src/renderer/src/lib/persons-queue'
import {
  foldProviderLimits,
  readProviderLimit,
  type ProviderLimitSeen,
} from '../../src/shared/provider-limit'
import type { OneCount, WorkspaceReading } from '../../src/shared/workspace-reading'
import { mount, parseColor, unmountAll, visible, type Mounted } from './harness'
import { assertClipped, assertDrawn, drawnReady, inkRects, lineCount } from './drawn'

/**
 * 🔴 **571 · the rail's one live signal, at the width the rail really is** — `EXT-008` §4.3.
 *
 * ## ⛔ Why this is in the DOM project and not beside the unit tests
 *
 * ⚠️ **`531` / `530` F1:** *"`textContent` is identical whether a browser drew a string or clipped
 * it, and every assertion this app makes about rail rows reads `textContent`."* 🔴 **This line's
 * whole job is to be read at a glance from a 251.68px column**, so *the rail holds this string* is
 * the one claim that would not be worth making. ⚑ The sensor is `drawn.ts`, and every assertion
 * below is paired with a planted cut so *nothing was clipped* is a measurement rather than a
 * sensor that was asleep.
 *
 * ⛔ **The longest COUNTED state is the QUIET one** — *Nothing needs you* — which is the opposite
 * of the usual worry and the reason the line wraps rather than ellipsizing. ⚑ **D-017b · one count
 * now**: the reading no longer counts what is *open* (`WorkspaceReading`), so every line below
 * lost its first clause.
 *
 * ⚠️ **617 · and the longest state is no longer counted at all.** A stopped provider adds a clause,
 * so the quiet line wraps to two — measured below at both widths, and cut at neither.
 */

/** ⛔ The two widths this rail really is — `--rail-w`, and its ≥1400px step (`rail-rhythm`). */
const WIDTHS = [251.68, 266.2]

const AT = Date.now()

const inFull = (count: number): OneCount => ({ counted: 'in-full', count })
const notAtAll: OneCount = { counted: 'not-at-all', because: 'no-ledger' }

function reading(needsYou: OneCount, readAt: number = AT): WorkspaceReading {
  return { readAt, needsYou }
}

/* ⚑ **617 · the wall fixtures**, in `PHRASES`' own `stopped` spelling and read through the real
   recogniser — never a `ProviderCondition` assembled by hand, which would make the rail a second
   ANSWER about a wall rather than a second PLACE for one (`HO-080` §4).
   ⛔ **The resets are in 2126 and that is deliberate**: `AT` is the real clock here, and
   `foldProviderLimits` drops a wall whose reset has passed — a fixture dated 2026 would stop being
   a wall on a date nobody would connect to this file
   (`a-bound-written-as-the-constant-cannot-pin-it`, one axis over). */
const CLAUDE_STOPPED = 'claude is rate-limited (seven_day); resets 2126-09-23T11:00:00.000Z'
const CODEX_STOPPED =
  'codex is rate-limited (weekly) on the GPT-5.3-Codex-Spark limit; resets 2126-09-20T21:10:56.000Z'

/** ⛔ The ordinary day: the look ANSWERED and no provider has walled. */
const NOTHING_WALLED: ProviderLimitsView = { walls: [], unread: false }

function band(said: readonly string[], answered = true): ProviderLimitsView {
  const rows = said.map((one) => {
    const wall = readProviderLimit(one, AT - 60_000)
    expect(wall, `not recognised as a wall: ${one}`).not.toBeNull()
    return wall as ProviderLimitSeen
  })
  const view = providerLimitsView(
    {
      rows: foldProviderLimits(rows, [], AT),
      walk: 'every-provider-wall-recently-recorded' as const,
      ledgers: 1,
      rowsUnread: 0,
    },
    answered,
    AT,
  )
  expect(view, 'the band answered nothing to fold').not.toBeNull()
  return view as ProviderLimitsView
}

/** The rail, with the closed list stubbed out — `attention-rail.dom.test.ts`' helper, one prop over. */
async function rail(
  workspace: WorkspaceReading | null,
  width = WIDTHS[0] as number,
  limits: ProviderLimitsView | null = NOTHING_WALLED,
): Promise<Mounted> {
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const m = mount(
    SideRail,
    { open: [], activeId: null, place: null, workspace, limits },
    { width, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await drawnReady()
  return m
}

/**
 * ⚑ **A box that CAN cut, TRAPPED THE WAY THE SUBJECT IS** — planted as the live signal's own
 * sibling, inside `.rail-primary-action`, at the same width and font.
 *
 * ⛔ **`a-control-must-be-trapped-the-way-the-subject-is`.** A control in `document.body` proves
 * the sensor runs; it does not prove the sensor can see a cut *in this rail's box*, which is the
 * only thing the negatives above are about.
 */
function plantedBeside(line: HTMLElement, text: string): HTMLElement {
  const box = document.createElement('p')
  box.className = line.className
  // ⛔ **617 · the WIDTH is pinned to the subject's own box, and it was not.** ⚠️ Measured here:
  // `.rail-primary-action` is a flex COLUMN, so a `nowrap` child's `min-width: auto` lets it grow
  // past the rail — the 85-character control below reached **466.8px** in a 187px line's place and
  // was reported cut by the BROWSER VIEWPORT rather than by this rail. 🔴 A 59-character one
  // reached 341.3px and was not cut at all, which is a control that says *drawn in full* for a
  // string two and a half times too wide. ⚑ Pinning the width is what makes
  // `a-control-must-be-trapped-the-way-the-subject-is` true of this planter.
  box.setAttribute(
    'style',
    `width: ${String(line.getBoundingClientRect().width)}px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis`,
  )
  box.textContent = text
  line.parentElement!.append(box)
  return box
}

afterEach(() => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('the line a person can actually read', () => {
  for (const width of WIDTHS) {
    it(`🔴 the busy line is drawn in full at ${String(width)}px`, async () => {
      const m = await rail(reading(inFull(1)), width)
      const line = m.q('rail-live-signal')
      expect(visible(line)).toBe(true)
      expect(line.textContent?.trim()).toBe('1 needs you')
      assertDrawn(line, 'the live signal')
    })

    it(`⛔ the QUIET line — the longest one — is drawn in full at ${String(width)}px`, async () => {
      // 🔴 **The state `571` §5.2 asked to derive.** *Nothing running. Start one above, or reopen
      // one below.* is gone; what stands here is the same claim the counts make, at zero.
      const m = await rail(reading(inFull(0)), width)
      const line = m.q('rail-live-signal')
      expect(line.textContent?.trim()).toBe('Nothing needs you')
      assertDrawn(line, 'the quiet live signal')
      // ⚑ **The headroom, as a number** — the component's comment claims one and this is where it
      // is taken. ⛔ The first version of that comment said this line does NOT fit; it does, on one
      // line. ⚠️ **617 · what is no longer true is the sentence that followed** — *the wrap is for
      // a state that does not exist yet*: a stopped provider is that state and it exists, which
      // the block below measures (`a-number-can-survive-the-death-of-its-derivation`, twice now).
      expect(lineCount(line), 'the longest state no longer fits on one line').toBe(1)
      const widest = Math.max(...inkRects(line).map((rect) => rect.width))
      expect(widest).toBeLessThan(line.getBoundingClientRect().width)
    })

    it(`⚑ …and the sensor that said so can see a cut in the SAME box at ${String(width)}px`, async () => {
      // ⛔ **`a-positive-assertion-must-differ-from-the-default`.** The *nothing was clipped*
      // verdicts above are worth nothing unless this sensor reports a cut where they were taken.
      const m = await rail(reading(inFull(0)), width)
      const control = plantedBeside(
        m.q('rail-live-signal'),
        'Nothing needs you · and a clause far, far wider than this narrow column could ever hold',
      )
      assertClipped(control, 'the control planted beside the live signal')
    })
  }

  it('⛔ four digits still fit, so the line does not quietly depend on small numbers', async () => {
    const m = await rail(reading(inFull(1234)))
    const line = m.q('rail-live-signal')
    expect(line.textContent?.trim()).toBe('1234 needs you')
    assertDrawn(line, 'the live signal at four digits')
  })
})

describe('what the rail says, and what it no longer says', () => {
  it('🔴 the sentence this replaced is not on the rail in any state', async () => {
    // ⛔ **`EXT-008` §2's fourth bullet.** ⚠️ Asserted on a rail with NOTHING open, which is the
    // one state that used to render it — a negative taken anywhere else would be vacuous.
    const m = await rail(reading(inFull(0)))
    expect(m.all('no-open-sessions')).toHaveLength(0)
    expect(m.host.textContent).not.toContain('Nothing running')
    // ⚑ **The paired positive, in the same mount**: the rail really did render, and the line that
    // took its place is on screen.
    expect(visible(m.q('rail-live-signal'))).toBe(true)
    expect(visible(m.q('new-conversation'))).toBe(true)
  })

  it('⛔ a counted zero is DRAWN, and the line says nothing of what is open', async () => {
    // 🔴 **Honesty rule 1, on the surface rather than in the shape.** ⚑ **D-017b · the scope this
    // test left uncounted, `open`, is gone from the reading** — so the half that proved an
    // uncounted scope ABSENT is the no-line test below, and what stays here is the drawn zero and
    // that no *open* reaches the line.
    const m = await rail(reading(inFull(0)))
    const line = m.q('rail-live-signal')
    expect(line.textContent?.trim()).toBe('Nothing needs you')
    expect(line.textContent).not.toContain('open')
    assertDrawn(line, 'the one-cell live signal')
  })

  it('⚠️ nothing counted at all draws NO LINE, which is not a zero', async () => {
    const m = await rail(reading(notAtAll))
    expect(m.all('rail-live-signal')).toHaveLength(0)
    // ⚑ **The control**: the same rail WITH a reading draws it, so the absence above is the arm
    // and not a prop this mount never passed.
    const drawn = await rail(reading(inFull(0)))
    expect(drawn.all('rail-live-signal')).toHaveLength(1)
  })

  it('⛔ before any reading lands the rail says nothing about the workspace', async () => {
    const m = await rail(null)
    expect(m.all('rail-live-signal')).toHaveLength(0)
    expect(m.host.textContent).not.toContain('needs you')
  })
})

describe('the moment is on the hover, never on the line', () => {
  it('🔴 a reading older than one re-read says so, and only in the title', async () => {
    const m = await rail(reading(inFull(1), AT - 600_000))
    const line = m.q('rail-live-signal')
    expect(line.textContent?.trim()).toBe('1 needs you')
    expect(line.title).toContain('10m ago')
    expect(line.dataset.asOf).toBe('10m ago')
    assertDrawn(line, 'the live signal beside a stale stamp')
  })

  it('⚑ a fresh reading carries no age at all — the paired negative', async () => {
    const m = await rail(reading(inFull(1)))
    const line = m.q('rail-live-signal')
    expect(line.title).toBe('1 needs you')
    expect(line.dataset.asOf).toBeUndefined()
  })
})

/**
 * 🔴 **617 · the wall, on the one line a person actually looks at** — `HO-080` §4.
 *
 * A condition missed while the person is specifically looking for it needs a measurable
 * surface check rather than an assumption about attention.
 *
 * ⚠️ **So the claims here are the ones only a real engine can answer**: is the clause DRAWN in the
 * 187px box, does it survive two providers, and is it a different colour from the counts it sits
 * beside — which is the whole of why a person would see it. ⛔ **Never a class name**
 * (`a-scoped-class-matches-nothing-in-another-component`): the assertion is the resolved rgba.
 */
describe('617 · a provider that has stopped, on the rail', () => {
  for (const width of WIDTHS) {
    it(`🔴 one walled provider is drawn in full at ${String(width)}px`, async () => {
      const m = await rail(reading(inFull(1)), width, band([CLAUDE_STOPPED]))
      const line = m.q('rail-live-signal')
      expect(line.textContent).toBe('1 needs you · Claude stopped')
      assertDrawn(line, 'the live signal with one wall')
      assertDrawn(m.q('rail-live-stopped'), 'the stopped clause')
    })

    it(`⛔ TWO walled providers — 617 §4.3's case — are drawn in full at ${String(width)}px`, async () => {
      const m = await rail(reading(inFull(0)), width, band([CLAUDE_STOPPED, CODEX_STOPPED]))
      const line = m.q('rail-live-signal')
      expect(line.textContent).toBe('Nothing needs you · Codex and Claude stopped')
      // ⚑ **It WRAPS, and that is the state the component's comment was holding open for.** ⛔ The
      // claim being measured is *nothing is cut*, not *it fits on one line* — the rail has no
      // `text-overflow`, so a second line is the designed outcome and a cut would be the defect.
      assertDrawn(line, 'the live signal with two walls')
      expect(lineCount(line)).toBeGreaterThan(1)
    })
  }

  it('⚑ …and the sensor can still see a cut in the SAME box, with the wall clause in it', async () => {
    // ⛔ `a-control-must-be-trapped-the-way-the-subject-is`, re-taken for the longest state this
    // line now has — the negatives above are worth nothing without it.
    const m = await rail(reading(inFull(0)), WIDTHS[0], band([CLAUDE_STOPPED, CODEX_STOPPED]))
    const control = plantedBeside(
      m.q('rail-live-signal'),
      'Nothing needs you · Codex and Claude stopped',
    )
    assertClipped(control, 'the two-wall line planted in a box that cannot wrap')
  })

  it('🔴 the clause is a different colour from the counts beside it', async () => {
    // ⚠️ **The property a person perceives, not a class.** ⛔ `.rail-live` is `--faint`; the clause
    // is the band's own summons token, which is what makes it the thing that stops a scan.
    const m = await rail(reading(inFull(1)), WIDTHS[0], band([CLAUDE_STOPPED]))
    const line = m.q('rail-live-signal')
    const clause = m.q('rail-live-stopped')
    const faint = parseColor(getComputedStyle(line).color)
    const summons = parseColor(getComputedStyle(clause).color)
    expect(faint).not.toBeNull()
    expect(summons).not.toBeNull()
    expect(summons, 'the stopped clause is drawn in the line’s own ink').not.toEqual(faint)
    // ⚑ **And heavier**, as the band draws a `stopped` wall — one treatment, two surfaces.
    expect(Number(getComputedStyle(clause).fontWeight)).toBeGreaterThan(
      Number(getComputedStyle(line).fontWeight),
    )
  })

  it('⛔ what a person SEES is the string the title carries — one derivation, two spellings', async () => {
    // 🔴 **The rail renders the two halves and the module composes the whole.** ⚑ This is the only
    // thing keeping them from drifting (`169` §1), and it is asserted on the state with both.
    const limits = band([CLAUDE_STOPPED], false)
    const held = reading(inFull(1))
    const m = await rail(held, WIDTHS[0], limits)
    const line = m.q('rail-live-signal')
    const view = liveSignalView(held, limits, AT)
    expect(line.textContent).toBe(view!.line)
    expect(line.title).toBe(view!.said)
    // ⚠️ **The mark is on screen too** — the read that finds a wall did not answer.
    expect(line.textContent).toContain('Claude stopped*')
  })

  it('⚠️ an ordinary day adds nothing at all, and the element is absent', async () => {
    // ⛔ **The paired negative in the same file**: every positive above is about a wall and not
    // about a clause this rail now always draws.
    const m = await rail(reading(inFull(1)))
    expect(m.q('rail-live-signal').textContent).toBe('1 needs you')
    expect(m.all('rail-live-stopped')).toHaveLength(0)
  })

  it('🔴 a wall look that has not answered is MARKED on the rail, not read as quiet', async () => {
    const m = await rail(reading(inFull(1)), WIDTHS[0], null)
    const line = m.q('rail-live-signal')
    expect(line.textContent).toBe('1 needs you · nothing stopped*')
    assertDrawn(line, 'the live signal with an unread wall look')
    expect(line.title).toContain('the read that finds a walled provider did not answer')
  })
})
