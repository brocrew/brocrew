import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import type { ContextReading, TranscriptEvent } from '../../src/shared/runtime-ipc'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  channelGap,
  luminance,
  mount,
  paintedBackground,
  paneProps,
  parseColor,
  permission,
  record,
  show,
  unmountAll,
  type Mounted,
  type Rgba,
} from './harness'
import { CLAUDE_COMPACTION_NOTE } from '../provider-capability-fixture'

/**
 * **The context meter in a real engine** (087 acceptance 8) — the Dropped tab's body until W4.208,
 * the Context popup the card's context figure opens since.
 *
 * The first new surface built since 083's harness landed, and it is *exactly the shape of the defect
 * that justified building it*: a theme-scoped column beside paper, whose appearance is decided by
 * what its tokens resolve to where it sits rather than by what it declares. 080 shipped two of those
 * past 2,043 green tests.
 *
 * ⚠️ **The colour assertions here are about HUE, not about a specific value.** 086's ruling is that
 * context pressure is a different REGISTER from attention — a fuel gauge, not a summons — and the
 * strongest possible form of that is `--waiting` being absent from the feature entirely. A test that
 * pinned exact rgb values would fail on any palette tweak and would say nothing about the rule; a
 * test that asks "is any of this amber" is the rule.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const reading = (r: ContextReading): TranscriptEvent[] =>
  r.kind === 'unknown'
    ? []
    : [{ type: 'context_reading', reading: r, source: 'test/reading' } as never]

const compaction = (over: Record<string, unknown> = {}): TranscriptEvent =>
  ({ type: 'compaction', source: 'compact_boundary', ...over }) as never

/**
 * ⚑ **W4.208** — the pane, its drawer on Open, and the card's context figure pressed, in a window
 * at least the app's own floor wide: the popup is sized against the window, and the runner's
 * default 414 px page leaves it no room at all.
 *
 * ⚠️ **`theme` is set on the pane's carrier after mount** (344): the pane renders
 * `data-chat-theme="light"` unconditionally, so a test that wants the page under the popup dark
 * has to say so on the element that owns that scope.
 */
async function openContext(
  events: TranscriptEvent[],
  over: Record<string, unknown> & { theme?: 'light' | 'dark' } = {},
  box = 1200,
): Promise<Mounted> {
  const { theme, ...props } = over
  await page.viewport(1440, 1000)
  const m = mount(
    ConversationPane,
    paneProps({ record: record(events), drawerOpen: true, drawerTab: 'open', ...props }),
    { width: box },
  )
  if (theme) m.q('conversation-pane').setAttribute('data-chat-theme', theme)
  await nextTick()
  m.q('card-run-context').click()
  await nextTick()
  m.q('context-dialog')
  return m
}

/* --------------------------------------------------------------- the palette */

/**
 * The three hues, read from the LIVE cascade at the element that would paint them.
 *
 * ⚠️ Read from the page rather than hard-coded, because `tokens.css` gives all three different
 * values in the light scope (`--waiting` goes from `#f2b865` to `#92400e`, which is brown). A test
 * carrying dark-scope constants would compare the paper meter against a palette it never uses and
 * pass for the wrong reason.
 */
function hues(scope: Element): { accent: Rgba; waiting: Rgba; danger: Rgba } {
  const style = getComputedStyle(scope)
  const read = (name: string): Rgba => {
    const raw = style.getPropertyValue(name).trim()
    const parsed = parseColor(raw) ?? hexToRgba(raw)
    expect(parsed, `${name} resolved to "${raw}", which this test cannot parse`).not.toBeNull()
    return parsed!
  }
  return { accent: read('--accent'), waiting: read('--waiting'), danger: read('--danger') }
}

function hexToRgba(value: string): Rgba | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
}

/** Every element inside `root` that paints something, with what it paints. */
function painted(root: Element): { el: Element; bg: Rgba }[] {
  return [root, ...root.querySelectorAll('*')].map((el) => ({ el, bg: paintedBackground(el) }))
}

const describeEl = (el: Element): string =>
  el.getAttribute('data-cy') ?? `${el.tagName.toLowerCase()}.${el.className || '—'}`

/* ------------------------------------------------------------------- the tests */

/**
 * The meter paints the overlay’s light paper regardless of the underlying page. The overlay
 * host carries `data-chat-theme="light"` for every sheet and popup; verify both the popup
 * surface and its independence from the page beneath.
 */
describe('the meter is on the overlay’s paper — 080’s escape, on the popup', () => {
  it.each([{ theme: 'dark' as const }, { theme: 'light' as const }])(
    'the meter paints the popup’s light surface over a $theme page',
    async ({ theme }) => {
      const m = await openContext(reading({ kind: 'proportional', used: 128000, window: 258400 }), {
        theme,
      })
      const panel = paintedBackground(m.q('session-context'))
      const dialog = paintedBackground(m.q('context-dialog'))
      expect(
        channelGap(panel, dialog),
        `the meter paints ${show(panel)} on a popup at ${show(dialog)}`,
      ).toBeLessThanOrEqual(24)
      expect(luminance(panel), 'the meter is not on paper').toBeGreaterThan(0.8)
      // Non-vacuity: the page under it really is the theme asked for.
      expect(luminance(paintedBackground(m.q('reading-surface'))), `the ${theme} page`)[
        theme === 'light' ? 'toBeGreaterThan' : 'toBeLessThan'
      ](theme === 'light' ? 0.8 : 0.1)
    },
  )

  it('nothing inside it follows the page — every element paints the same over both themes', async () => {
    // ⚠️ **The compaction is in the fixture because of review finding 18**: without it the
    // `.reclaimed` banner never renders and the walk never sees the `--success-*` tokens.
    const events = [
      ...reading({ kind: 'proportional', used: 128000, window: 258400 }),
      compaction({ before: 128000, after: 24000 }),
    ]
    const dark = await openContext(events, { theme: 'dark' })
    const darkPaint = painted(dark.q('session-context'))
    dark.unmount()

    const light = await openContext(events, { theme: 'light' })
    const lightPaint = painted(light.q('session-context'))

    expect(lightPaint).toHaveLength(darkPaint.length)
    const moved = darkPaint
      .map((d, i) => ({ d, l: lightPaint[i]! }))
      .filter(({ d, l }) => channelGap(d.bg, l.bg) !== 0)
      .map(
        ({ d, l }) =>
          `${describeEl(d.el)} paints ${show(d.bg)} over dark, ${show(l.bg)} over light`,
      )
    expect(moved).toEqual([])

    // Paired positive: the panel really did render a non-trivial tree, so the empty list above is a
    // result rather than a walk over nothing.
    expect(darkPaint.length).toBeGreaterThan(20)
  })
})

/** WCAG contrast between ink and the surface it sits on. 4.5 is the AA floor for body text. */
function contrast(ink: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(ink), luminance(bg)].sort((x, y) => y - x) as [number, number]
  return (a + 0.05) / (b + 0.05)
}

describe('the reclaimed note is legible on paper — the escape the walk could not see', () => {
  it.each([{ theme: 'dark' as const }, { theme: 'light' as const }])(
    'reads against its own background in $theme',
    async ({ theme }) => {
      // ⚠️ **This exists because the stranded-walk above did NOT catch review finding 5, and I checked
      // rather than assumed.** Removing the three light `--success-*` values leaves that walk green:
      // it composites BACKGROUNDS and filters for dark ones, and `--success-text` is ink while
      // `--success-bg` is a translucent green that composites LIGHT on paper. The token-level guard in
      // `chat-theme.test.ts` is what actually failed. So this asserts the thing a reader cares about —
      // can you read it — which is the one question neither of those two answers.
      const m = await openContext(
        [
          ...reading({ kind: 'proportional', used: 128000, window: 258400 }),
          compaction({ before: 128000, after: 24000 }),
        ],
        { theme },
      )
      const note = m.q('context-reclaimed')
      const ink = parseColor(getComputedStyle(note).color)!
      const bg = paintedBackground(note)
      expect(
        contrast(ink, bg),
        `the reclaimed note is ${show(ink)} on ${show(bg)}`,
      ).toBeGreaterThanOrEqual(4.5)
      // Non-vacuity: the note really rendered its number, so the contrast is of real text.
      expect(note.textContent).toContain('104k')
    },
  )
})

describe('pressure is a different register from attention (086 §2)', () => {
  it.each([{ theme: 'dark' as const }, { theme: 'light' as const }])(
    'no element in the panel paints the amber `--waiting` — $theme',
    async ({ theme }) => {
      // ⚠️ **The strongest form of the ruling.** Not "amber is used sparingly" — absent. 063 exists
      // because a question that fails to reach the user is a defect we paid to fix; if a full context
      // window lit the same hue, the one signal that must never be ignored becomes the one that is
      // always on. Run at the REDLINE, which is the state most tempted to borrow it.
      const m = await openContext(reading({ kind: 'proportional', used: 258000, window: 258400 }), {
        theme,
      })
      const { waiting, danger } = hues(m.q('context-dialog'))
      const amber = painted(m.q('session-context'))
        .filter(({ bg }) => channelGap(bg, waiting) <= 6)
        .map(({ el }) => describeEl(el))
      expect(amber).toEqual([])

      // Non-vacuity in two directions. First: the redline really is painted, so the panel under test
      // is in the state the rule is about…
      const fill = getComputedStyle(m.q('context-fill')).backgroundColor
      expect(
        channelGap(parseColor(fill)!, danger),
        `the redline fill is ${fill}`,
      ).toBeLessThanOrEqual(6)
      // …and second: red and amber are far enough apart in THIS scope that "no amber" is a real
      // finding rather than a tolerance that would have accepted either.
      expect(channelGap(danger, waiting)).toBeGreaterThan(6)

      // ⚠️ **Review finding 10: the amber sweep above reads BACKGROUNDS, and an icon is coloured by
      // `color`.** At the redline the reading line draws `#i-alert` — the attention bar's own glyph —
      // so it is the one element in this panel where amber could appear and the walk would miss it.
      const icon = m.q('context-reading-line').querySelector('svg')!
      const ink = parseColor(getComputedStyle(icon).color)!
      expect(channelGap(ink, danger), `the redline glyph is ${show(ink)}`).toBeLessThanOrEqual(6)
      expect(channelGap(ink, waiting)).toBeGreaterThan(6)
    },
  )

  it('a healthy reading paints `--accent`, not `--danger` — the redline is a threshold, not a style', async () => {
    const m = await openContext(reading({ kind: 'proportional', used: 100000, window: 258400 }))
    const { accent, danger } = hues(m.q('context-dialog'))
    const fill = parseColor(getComputedStyle(m.q('context-fill')).backgroundColor)!
    expect(channelGap(fill, accent)).toBeLessThanOrEqual(6)
    expect(channelGap(fill, danger)).toBeGreaterThan(6)
  })
})

describe('pressure raises no attention trace (086 §2 / 087 §3)', () => {
  // ⚑ **W4.208 · the strip's level line left with the Context tab**; what stays is the rule it
  // kept: a full context window is not a question.
  it('at the redline the amber attention dot and bar are still nowhere', async () => {
    const m = await openContext(reading({ kind: 'proportional', used: 258000, window: 258400 }))
    // The whole of acceptance 5, in the DOM: with nothing waiting, no attention trace is in the
    // document at any reading — including the one most tempted to raise one.
    expect(m.all('drawer-tab-attention')).toEqual([])
    expect(m.host.querySelector('[data-cy="drawer-attention-bar"]')).toBeNull()
    // Non-vacuity: the meter really is at the redline.
    expect(m.q('context-figure').textContent).toContain('100')
  })
})

describe('the blank, and the compaction control (acceptance 4 and 7; 718 · R60)', () => {
  it('a session with no report shows an em-dash — the string "0" is not in the figure', async () => {
    const m = await openContext([])
    expect(m.q('context-figure').textContent?.trim()).toBe('—')
    // The gauge draws no fill at all: a bar at 0% and "no reading" must not look alike.
    expect(m.host.querySelector('[data-cy="context-fill"]')).toBeNull()
    // The ring is dashed, which is 081's `unknown` vocabulary reused rather than reinvented.
    expect(
      getComputedStyle(m.q('session-context').querySelector('.gauge-track')!).borderTopStyle,
    ).toBe('dashed')
  })

  it('a tokens-only reading PAINTS its magnitude bar — the one review finding 2 made invisible', async () => {
    // ⚠️ The bar is the primary indicator for every Claude session, and it was 0px wide: `fill`
    // computed `0.00%` for a reading with no window and the inline style beat
    // `.meter.m-tokens .gauge-fill { width: 100% }`. Measured, because "the element exists" was
    // exactly what the old test checked and exactly what stayed true while nothing was drawn.
    const m = await openContext(reading({ kind: 'tokens', used: 46975 }))
    const bar = m.q('context-fill').getBoundingClientRect()
    const track = m.q('session-context').querySelector('.gauge-track')!.getBoundingClientRect()
    expect(track.width).toBeGreaterThan(0)
    expect(bar.width / track.width).toBeCloseTo(1, 1)
    // Paired with the proportional case, which must NOT be full — otherwise "full bar" would be
    // satisfied by a component that ignores the reading entirely.
    const half = await openContext(reading({ kind: 'proportional', used: 129200, window: 258400 }))
    const halfBar = half.q('context-fill').getBoundingClientRect()
    const halfTrack = half
      .q('session-context')
      .querySelector('.gauge-track')!
      .getBoundingClientRect()
    expect(halfBar.width / halfTrack.width).toBeCloseTo(0.5, 1)
  })

  it('a tokens-only reading shows a magnitude and NO percent sign', async () => {
    const m = await openContext(reading({ kind: 'tokens', used: 46975 }))
    expect(m.q('context-figure').textContent).toContain('47k')
    expect(m.q('context-figure').textContent).not.toContain('%')
    expect(m.q('context-caption').textContent).toContain('not reported')
    // Paired with the case that DOES earn one, so "no percent" is a property of this reading.
    const other = await openContext(reading({ kind: 'proportional', used: 129200, window: 258400 }))
    expect(other.q('context-figure').textContent).toContain('%')
  })

  it('"Compact now…" is present, disabled, and states its reason', async () => {
    const m = await openContext(reading({ kind: 'tokens', used: 46975 }))
    const button = m.q('context-compact-now') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // A real click must change nothing — the attribute is the mechanism, this is the consequence.
    button.click()
    expect(button.disabled).toBe(true)
    // With no capabilities declared the reason says so rather than going blank, which is the state
    // a failed capabilities read actually produces.
    expect(m.q('context-compact-why').textContent).toContain('Not declared')
  })

  /**
   * 🔴 **718 · re-aimed: the control is LIVE now** (`R60`). It asserted *"stays off for the missing
   * confirm"* — true from `713` until the confirm existed, and the one clause `718` was sent to make
   * false. ⚑ What it still pins: the real declaration's road, in the foot. What it pins instead of
   * the dark button: a live one, whose press asks first (`compact-now-and-what-main-now-carries.dom`).
   */
  it('…and with the real declaration it names the provider’s road — and the control is live (718)', async () => {
    // 🔴 **713 · the real declaration is `available` on both providers now** (`R59`, `R60`) — the
    // `absent` this planted until then, *"has no method to request one"*, is history.
    const m = await openContext(reading({ kind: 'tokens', used: 46975 }), {
      capabilities: {
        claude: {
          requestCompaction: {
            state: 'available',
            // ⚑ The fixture's copy, which `press-read-and-a-word.test.ts` pins to the real map.
            note: CLAUDE_COMPACTION_NOTE,
          },
        },
      },
    })
    const why = m.q('context-compact-why').textContent ?? ''
    expect(why).toContain('The provider can be asked — by /compact')
    expect(why).not.toContain('no confirm step yet')
    expect((m.q('context-compact-now') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the history and the boundary are the same fact (acceptance 6)', () => {
  it('the tally, the rows and the transcript boundaries all agree', async () => {
    const m = await openContext([
      { type: 'assistant_message', text: 'before' } as never,
      compaction({ before: 128000, after: 24000 }),
      { type: 'assistant_message', text: 'after' } as never,
      compaction({ compactionId: 'c2' }),
    ])
    const boundaries = m.all('compaction-boundary')
    expect(boundaries).toHaveLength(2)
    expect(m.q('context-tally').textContent?.trim()).toBe('2')
    expect(m.host.querySelectorAll('[data-cy^="context-compaction-"]')).toHaveLength(2)
  })

  it('a row whose boundary is on screen offers the jump; the row says so either way', async () => {
    const m = await openContext([compaction({ before: 128000, after: 24000 })])
    const row = m.host.querySelector<HTMLButtonElement>('[data-cy^="context-compaction-"]')!
    expect(row.disabled).toBe(false)
    expect(row.textContent).toContain('jump to it')
    // The magnitude is shown because this provider reported one…
    expect(row.textContent).toContain('128k')
  })

  it('…and a compaction with no size says so rather than showing a blank', async () => {
    const m = await openContext([compaction()])
    const row = m.host.querySelector<HTMLButtonElement>('[data-cy^="context-compaction-"]')!
    expect(row.textContent).toContain('no size reported')
    // Paired: the boundary row in the transcript drops its magnitude clause entirely rather than
    // rendering an arrow with nothing on either side of it.
    expect(m.host.querySelector('[data-cy="compaction-magnitude"]')).toBeNull()
    expect(m.q('compaction-source').textContent).toBe('compact_boundary')
  })

  it('everything above the newest boundary reads as summarised-out', async () => {
    const m = await openContext([
      { type: 'assistant_message', text: 'long ago' } as never,
      compaction({ compactionId: 'c1' }),
      { type: 'assistant_message', text: 'since then' } as never,
    ])
    const entries = [...m.host.querySelectorAll('.entry')]
    const faded = entries.map((el) => el.getAttribute('data-summarised'))
    // Exactly the rows BEFORE the boundary — the boundary itself is not faded, nor is what follows.
    expect(faded).toEqual(['true', 'false', 'false'])
    // Measured, not asserted from the class: opacity is what a reader actually sees.
    expect(Number(getComputedStyle(entries[0]!).opacity)).toBeLessThan(1)
    expect(Number(getComputedStyle(entries[2]!).opacity)).toBe(1)
  })

  it('…but a card still WAITING on you is never dimmed, wherever the boundary falls', async () => {
    // ⚠️ **Review finding 3, and it is the inverse of the rule this whole feature is about.** The
    // fade was unconditional, so a permission that arrived before a compaction — which nothing
    // prevents — rendered at 50% opacity: the attention traces still fired, but the one control for
    // ANSWERING it looked exactly like settled history. 087 was not allowed to raise the attention
    // channel; lowering it is worse. The old fixture held only assistant messages, so it could not
    // see this (finding 9) — the permission below is what makes the test able to fail.
    const m = await openContext([
      { type: 'assistant_message', text: 'long ago' } as never,
      permission('req_ctx'),
      compaction({ compactionId: 'c1' }),
      { type: 'assistant_message', text: 'since then' } as never,
    ])
    const entries = [...m.host.querySelectorAll('.entry')]
    expect(entries.map((el) => el.getAttribute('data-summarised'))).toEqual([
      'true', // the old message above the boundary — faded, as it should be
      'false', // the UNANSWERED permission, above the boundary and NOT faded
      'false',
      'false',
    ])
    // Measured rather than read off the attribute — full opacity is what makes it answerable.
    expect(Number(getComputedStyle(entries[1]!).opacity)).toBe(1)
    expect(Number(getComputedStyle(entries[0]!).opacity)).toBeLessThan(1)
    // Non-vacuity: the card really is the permission and really is unanswered.
    expect(entries[1]!.querySelector('[data-cy="permission-card"]')).not.toBeNull()
  })
})
