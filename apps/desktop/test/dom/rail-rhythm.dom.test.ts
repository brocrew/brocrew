import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/** Rail geometry, compact text, and footer placement at both shipped widths. */
const RAIL_W = 251.68
const RAIL_W_WIDE = 266.2
/** Where the step is. ⚠️ The query is `min-width`, so this width is ON the wide side of it. */
const STEP = 1400
const NOW = Date.now()

/** The viewport is shared across this whole directory, so it is captured once and put back. */
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const safety = useSpawnSafety()

/** An open conversation the rail can draw. Only the shape the rail reads is filled in. */
function conversation(sessionId: string): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'codex',
    cwd: `/Users/alex/dev/workspace-${sessionId}`,
    profileId: 'default',
    ref: { provider: 'codex', sessionId: 'live', cwd: '/Users/alex/dev', rotation: 0 },
    approvalMode: 'ask',
    liveness: { state: 'live', since: NOW },
  } as never
  return record
}

const agents = (over: Partial<AgentIdentities> = {}): AgentIdentities => ({
  identities: [
    {
      id: 'agp:default:pm',
      slug: 'pm',
      displayName: null,
      createdAt: NOW,
      // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
      createdBy: null,
      provider: null,
      // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
      chosen: {
        maxDepth: 'default',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        canWriteRules: 'default',
      },
    },
  ],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  // 500 · required on `AgentIdentities`; none of these fixtures is about the launch default.
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
  ...over,
})

/**
 * The rail at its real width and a SHORT height, which is the state the finding is about.
 *
 * ⚑ **520px, not 900.** The rail is `height: 100%` of the shell and the shell is the window; a
 * mount tall enough to fit everything is a mount in which nothing scrolls, and a test that never
 * overflows the scroller cannot see a control fall out of it.
 */
async function rail(
  open: unknown[] = [],
  height = 520,
  props: Record<string, unknown> = {},
  window_ = 1200,
): Promise<Mounted> {
  // ⛔ **The window before the mount.** `--rail-w` is a media query now, and a token read after a
  // viewport change but a layout taken before it would be two different rails in one assertion.
  await page.viewport(window_, 900)
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  // ⚠️ **390 · the switch is supplied, not passed.** It is drawn on two layers now, so its state
  // lives in `lib/spawn-safety.ts` and `RuntimeScreen` hands it over; the `agents` prop below is
  // still the identities SECTION's, which is this rail's alone.
  safety.supply(('agents' in props ? props.agents : agents()) as AgentIdentities | null, () => {})
  const m = mount(
    SideRail,
    { open, activeId: null, place: null, agents: agents(), ...props },
    { width: railWidth(), height },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

/** The token, resolved — never the constant, so the mount box is the width the app would give it. */
function railWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--rail-w').trim()
  expect(raw, '--rail-w is not declared in tokens.css').toMatch(/^\d+(?:\.\d+)?px$/)
  return Number.parseFloat(raw)
}

/** Is this element inside the rail's own box, top to bottom — the way an eye would answer. */
function onScreen(element: Element, within: Element): boolean {
  const box = element.getBoundingClientRect()
  const frame = within.getBoundingClientRect()
  return box.height > 0 && box.top >= frame.top - 0.5 && box.bottom <= frame.bottom + 0.5
}

afterEach(async () => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
  safety.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ------------------------------------------------------------------- §1 · the rhythm's numbers */

describe('§1 · v2.3’s rhythm, measured where it lands (385 §3)', () => {
  it('the rail is 251.68px below the step', async () => {
    const m = await rail([], 520, {}, 1200)
    const aside = m.host.firstElementChild as HTMLElement
    // The token, resolved — not the string in the stylesheet.
    expect(getComputedStyle(document.documentElement).getPropertyValue('--rail-w').trim()).toBe(
      `${RAIL_W}px`,
    )
    // ⚠️ The rail fills the column it is given; what this asserts is that the column is the one the
    // token names, which is how `.shell` lays it out (`grid-template-columns: var(--rail-w) 1fr`).
    expect(aside.getBoundingClientRect().width).toBeCloseTo(RAIL_W, 1)
  })

  it('⛔ one 20px gap between sections, and none under the last one', async () => {
    const m = await rail()
    const sections = [...m.host.querySelectorAll<HTMLElement>('.rail-section')]
    // ⚑ **D-017b · two sections are left** — the destinations and the ONE list of conversations
    // (the kept-open and closed sections went with the split) — so there is one gap to measure.
    expect(sections.length, 'there is no gap between sections to measure').toBeGreaterThan(1)
    for (const [index, section] of sections.entries()) {
      const style = getComputedStyle(section)
      expect(style.marginTop, `section ${String(index)} top`).toBe(index === 0 ? '0px' : '20px')
      // ⚑ **The half that was wrong**: it used to be `12px 0 18px`, so neighbours stacked to 30px
      // and the last section left 18px of dead space above the anchored end.
      expect(style.marginBottom, `section ${String(index)} bottom`).toBe('0px')
    }
  })

  it('⚠️ the section labels are 12px semibold in sentence case, with an 8px gap under them', async () => {
    // ⚑ **2026-10-01 · a conversation, because a label is a section's** — the conversations are in
    // BroBot's section and the other agents', and a section with no rows is not drawn.
    const m = await rail([conversation('sess_0')])
    const labels = [...m.host.querySelectorAll<HTMLElement>('.section-label')]
    // ⚑ **D-017b · one label per conversations' section** — the kept-open and closed headings went
    // with the split. ⛔ The floor is that one IS drawn, or the loop below measures nothing.
    expect(labels.length, 'no section label was drawn').toBeGreaterThan(0)
    for (const label of labels) {
      const style = getComputedStyle(label)
      // The caption size, the type floor.
      expect(style.fontSize).toBe('12px')
      expect(style.marginBottom).toBe('8px')
      expect(style.textTransform).toBe('none')
      expect(style.fontWeight).toBe('600')
    }
    // Compact row titles keep the shared 12px floor without bold navigation.
    const title = m.q('open-session-sess_0').querySelector<HTMLElement>('.rail-copy strong')!
    expect(parseFloat(getComputedStyle(title).fontSize)).toBe(12)
    expect(getComputedStyle(title).fontWeight).toBe('500')
    for (const cy of ['rail-waiting', 'rail-away', 'rail-sessions', 'rail-team', 'rail-settings']) {
      const label = m.q(cy).querySelector('strong')!
      expect(getComputedStyle(label).fontSize).toBe('12px')
      expect(getComputedStyle(label).fontWeight).toBe('400')
    }
  })
})

/* ------------------------------------------------ §2 · the anchored end, and what anchoring fixed */

describe('§2 · the kill switch is anchored, and it was not (385 §3)', () => {
  it('🔴 with the rail overflowing, the switch is on screen and a row in the scroller is not', async () => {
    const m = await rail([...Array(14).keys()].map((n) => conversation(`sess_${String(n)}`)))
    const aside = m.host.firstElementChild as HTMLElement
    const scroller = m.host.querySelector<HTMLElement>('.rail-scroll')
    expect(scroller).not.toBe(null)

    // ⛔ **The control comes first: the scroller really is overflowing.** Without this the assertion
    // below is about a rail that fits, where everything is on screen and nothing is proved.
    const overflow = (scroller as HTMLElement).scrollHeight - (scroller as HTMLElement).clientHeight
    expect(overflow, 'the rail is not overflowing, so nothing here is measured').toBeGreaterThan(
      100,
    )

    // ⚑ The switch, always.
    expect(onScreen(m.q('rail-spawning'), aside)).toBe(true)

    // ⚠️ **And the control is the app's own material, from inside the scroller.** Until `385` §3
    // the switch was the FIRST row of the identities section, inside the scroller, and a section
    // down there is off the bottom at this height — which is the defect, measured, rather than
    // described.
    //
    // 🔴 **570 · the witness is the LAST section in the scroller, and it has moved twice.** ⛔
    // `EXT-008` §4.4 took the agents section out of the column and `572` took the two project
    // ones, so this reads `rail-closed-conversations` — which is genuinely last, so a rail deep
    // enough to push it off the bottom is the same measurement rather than a weaker one.
    // ⚠️ **The assertion below would have gone quiet, not red, if the query had simply been
    // deleted**: `m.q` throws on a missing hook, which is what made this a re-aim rather than a
    // silent disarm, both times.
    // 🔴 **D-017b · and a third time**: the closed section went with the split, so the witness is
    // the LAST ROW of the one list — the file header's own words, *a row that IS in the scroller*.
    // ⚑ The row is found by its own id, and `m.q` still throws if the hook is gone.
    const lastRow = m.q('open-session-sess_13')
    const rowsDrawn = m.host.querySelectorAll('[data-cy^="open-session-"]')
    expect(rowsDrawn[rowsDrawn.length - 1], 'the witness is not the last row').toBe(lastRow)
    expect(lastRow.closest('.rail-scroll'), 'the witness left the scroller').not.toBe(null)
    expect(
      onScreen(lastRow, aside),
      'the last row is on screen too — this rail is not deep enough to measure',
    ).toBe(false)
    // ⛔ …and it is genuinely BELOW the fold rather than merely clipped at the top.
    expect(lastRow.getBoundingClientRect().top).toBeGreaterThan(
      aside.getBoundingClientRect().bottom,
    )
  })

  it('⛔ …and it stays put when the scroller is scrolled to the bottom', async () => {
    const m = await rail([...Array(14).keys()].map((n) => conversation(`sess_${String(n)}`)))
    const aside = m.host.firstElementChild as HTMLElement
    const scroller = m.host.querySelector<HTMLElement>('.rail-scroll') as HTMLElement
    const before = m.q('rail-spawning').getBoundingClientRect().top

    scroller.scrollTop = scroller.scrollHeight
    await nextTick()

    expect(scroller.scrollTop, 'the scroller did not move').toBeGreaterThan(0)
    expect(m.q('rail-spawning').getBoundingClientRect().top).toBe(before)
    expect(onScreen(m.q('rail-spawning'), aside)).toBe(true)
  })

  it('⚑ the anchored end is outside the scroller, with the user card under the switch', async () => {
    const m = await rail()
    const bottom = m.host.querySelector('.rail-bottom')
    expect(bottom).not.toBe(null)
    // ⛔ Outside — a card inside the scroller is a card that scrolls, whatever it looks like when
    // the list is short.
    expect(m.q('rail-spawning').closest('.rail-scroll')).toBe(null)
    expect(m.q('rail-spawning').closest('.rail-bottom')).toBe(bottom)

    // v2.3's order: the cards, then the user card at the very foot.
    const footer = (bottom as Element).querySelector('.rail-footer')
    expect(footer).not.toBe(null)
    expect(m.q('rail-spawning').getBoundingClientRect().bottom).toBeLessThanOrEqual(
      (footer as Element).getBoundingClientRect().top,
    )
  })

  it('⚠️ …and it is still absent entirely before the identities have arrived', async () => {
    // ⛔ The `v-if` that 355 put on it survived the move, and survived 390 moving the state into
    // `spawn-safety.ts` — the module answers `null` for the same reason the prop did. *Not asked*
    // and *asked and empty* are two facts, and a kill switch drawn before anybody knows the answer
    // is a claim the rail has not earned.
    const m = await rail([], 520, { agents: null })
    expect(m.all('rail-spawning')).toHaveLength(0)
    expect(m.host.querySelector('.rail-bottom')).not.toBe(null)
    expect(m.host.querySelector('.rail-footer')).not.toBe(null)
  })
})

/* ------------------------------------------------------------ §3 · the step, which is new (390 §4) */

/**
 * 🔴 **v2.5 widens the rail at ≥1400px, and this is the first width-dependent rail since `385 §3`
 * flattened the old one.**
 *
 * Check widening in its own section because the breakpoint introduces another width rule. The
 * 1440 × 1000 reference size is above it, so the wider rail is visible there even though
 * earlier tests never visit that window size.
 */
describe('§3 · the ≥1400px widening (390 §4)', () => {
  it('🔴 at the step the rail is 266.2px, and one pixel below it 251.68px', async () => {
    const wide = await rail([], 520, {}, STEP)
    expect(getComputedStyle(document.documentElement).getPropertyValue('--rail-w').trim()).toBe(
      `${RAIL_W_WIDE}px`,
    )
    expect((wide.host.firstElementChild as HTMLElement).getBoundingClientRect().width).toBeCloseTo(
      RAIL_W_WIDE,
      1,
    )

    // ⛔ **The pair, one pixel over the boundary** — a `min-width` query written as `max-width`, or
    // written at the wrong number, passes the assertion above and fails this one.
    unmountAll()
    const narrow = await rail([], 520, {}, STEP - 1)
    expect(getComputedStyle(document.documentElement).getPropertyValue('--rail-w').trim()).toBe(
      `${RAIL_W}px`,
    )
    expect(
      (narrow.host.firstElementChild as HTMLElement).getBoundingClientRect().width,
    ).toBeCloseTo(RAIL_W, 1)
  })

  /**
   * The rhythm is the rail's, not the width's: `20px` sections and 12px sentence-case labels hold
   * on both sides of the step, so the step changes the column and nothing else.
   */
  it('⛔ the section rhythm and the label size do not move with the width', async () => {
    // ⚑ A conversation, so a section's label is drawn — see §1.
    const m = await rail([conversation('sess_0')], 900, {}, STEP)
    const sections = [...m.host.querySelectorAll<HTMLElement>('.rail-section')]
    // ⚑ **D-017b · two sections, one label** — see §1.
    expect(sections.length, 'there is no gap between sections to measure').toBeGreaterThan(1)
    for (const [index, section] of sections.entries()) {
      const style = getComputedStyle(section)
      expect(style.marginTop, `section ${String(index)} top`).toBe(index === 0 ? '0px' : '20px')
      expect(style.marginBottom, `section ${String(index)} bottom`).toBe('0px')
    }
    const labels = [...m.host.querySelectorAll<HTMLElement>('.section-label')]
    expect(labels.length, 'no section label was drawn').toBeGreaterThan(0)
    for (const label of labels) {
      expect(getComputedStyle(label).fontSize).toBe('12px')
      expect(getComputedStyle(label).textTransform).toBe('none')
      expect(getComputedStyle(label).fontWeight).toBe('600')
    }
  })

  /**
   * ⛔ **And the anchored end is still anchored at the wide width.** `385 §3`'s whole finding is
   * that the switch scrolled away; a second rail width is a second layout, and a layout in which
   * the safety card is back inside the scroller would pass every assertion in §2 above.
   */
  it('⚠️ the kill switch is still outside the scroller and on screen at 1400px', async () => {
    const m = await rail(
      [...Array(14).keys()].map((n) => conversation(`sess_${String(n)}`)),
      520,
      {},
      STEP,
    )
    const aside = m.host.firstElementChild as HTMLElement
    const scroller = m.host.querySelector<HTMLElement>('.rail-scroll') as HTMLElement
    expect(
      scroller.scrollHeight - scroller.clientHeight,
      'the rail is not overflowing',
    ).toBeGreaterThan(100)
    expect(m.q('rail-spawning').closest('.rail-scroll')).toBe(null)
    expect(onScreen(m.q('rail-spawning'), aside)).toBe(true)
  })
})
