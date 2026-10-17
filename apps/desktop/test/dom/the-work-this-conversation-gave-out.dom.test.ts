import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { DRAWER_TABS, DRAWER_W_MIN, type DrawerTab } from '../../src/renderer/src/lib/drawer'
import type { WorkGivenOutReading } from '../../src/renderer/src/lib/work-given-out'
import type { WorkGivenOut } from '../../src/shared/tasks'
import { META, drawerProps, mount, parseColor, unmountAll } from './harness'

/**
 * 🔴 **508 · the seventh tab, measured in the strip it had to fit into.**
 *
 * ## ⛔ Why this file exists at all
 *
 * ⚠️ **`088` measured the strip's width over FOUR tabs and the number has been prose about six ever
 * since** — *"at the narrow floor the strip is 319px and its content overflows by 0px on every one
 * of the four tabs, the worst being `Controls` at 85px."* ⛔ `079`'s bet was that a six-tab layout
 * tested icon-only would survive whatever filled the two RESERVED slots; `work` is outside that bet
 * — it is the first tab this strip has gained with no slot held for it — so the fit is a
 * measurement this dispatch owed rather than a number it could inherit.
 * ⚑ `a-number-can-survive-the-death-of-its-derivation`.
 *
 * ## ⚠️ What a strip that does not fit actually does
 *
 * `.drawer-tabs` is a plain flex row with no wrap and no overflow rule, so content past the box does
 * not scroll and does not wrap — **it is drawn outside the column**, over the transcript or under
 * the drawer's own border, and the last tab is the one that goes. ⛔ A tab behind an overflow is an
 * attention signal you cannot see, which is `079`'s own reason for refusing a *"more"* menu.
 */

afterEach(unmountAll)

const Harness = defineComponent({
  props: {
    start: { type: String, required: true },
    fit: { type: String, required: true },
    work: { type: Object, default: null },
  },
  setup(p) {
    const tab = ref<DrawerTab>(p.start as DrawerTab)
    return () =>
      h(SessionDrawer as never, {
        ...drawerProps({ tab: tab.value, fit: p.fit, work: p.work }),
        'onUpdate:tab': (next: DrawerTab) => {
          tab.value = next
        },
      })
  },
})

const AT = 9_000_000

const workRow = (over: Partial<WorkGivenOut> = {}): WorkGivenOut => ({
  piece: 'work_one',
  label: 'W1.4',
  title: 'read the brief and report',
  state: 'working',
  givenToProfile: 'worker',
  givenAt: AT - 120_000,
  ...over,
})

/** ⚑ `META.sessionId` is what `drawerProps` builds the drawer around — the reading must name it. */
const reading = (rows: readonly WorkGivenOut[]): WorkGivenOutReading => ({
  conversation: META.sessionId,
  walk: {
    rows,
    walk: 'every-conversation-this-one-gave-work-to',
    ledgers: rows.length,
    rowsUnread: 0,
  },
  answered: true,
  at: AT,
})

describe('§1 · the strip still fits the column it lives in', () => {
  /**
   * ⛔ **The narrow floor is where this is decided.** `drawerFit` yields 380 → 320 before it floats
   * the drawer, so 320 is the smallest box the strip is ever laid out in — a fit at 380 would prove
   * nothing about the state a person reaches by narrowing the window.
   */
  it('shows a complete multiline condition at narrow width, and distinguishes legacy absence from unread knowledge', async () => {
    const condition = `${'A long fictional result must be recorded. '.repeat(8)}\nA separate check must pass.`
    const show = (row: WorkGivenOut) =>
      mount(
        Harness,
        { start: 'work', fit: 'docked', work: reading([row]) },
        { width: 380, height: 700 },
      )
    const known = show(workRow({ definitionOfDone: condition }))
    await nextTick()
    const done = known.q('work-row-done')
    expect(done.textContent).toContain(condition)
    expect(getComputedStyle(done).whiteSpace).toBe('pre-wrap')
    expect(done.scrollWidth).toBeLessThanOrEqual(done.clientWidth + 1)
    expect(done.getBoundingClientRect().height).toBeGreaterThan(40)
    unmountAll()
    const legacy = show(workRow({ definitionOfDone: null }))
    await nextTick()
    expect(legacy.q('work-row-done').textContent?.trim()).toBe('Done when: Not recorded')
    unmountAll()
    const unread = show(workRow())
    await nextTick()
    expect(unread.all('work-row-done')).toHaveLength(0)
    expect(unread.host.textContent).not.toContain('Not recorded')
  })

  it('🔴 every tab fits at the narrow floor, whichever one is carrying its label', () => {
    const widths: { tab: DrawerTab; client: number; scroll: number }[] = []
    for (const active of DRAWER_TABS) {
      const m = mount(Harness, { start: active.id, fit: 'docked' }, { width: DRAWER_W_MIN })
      const strip = m.q('drawer-tabs')
      widths.push({ tab: active.id, client: strip.clientWidth, scroll: strip.scrollWidth })
      m.unmount()
    }
    // ⚠️ Non-vacuity: the strip was actually laid out, rather than measured at zero in a box that
    // never got a width.
    expect(widths).toHaveLength(DRAWER_TABS.length)
    for (const one of widths)
      expect(one.client, `${one.tab}: the strip has no width`).toBeGreaterThan(0)
    // ⛔ **The measurement**: nothing overflows, on any active tab.
    for (const one of widths) {
      expect(
        one.scroll,
        `${one.tab} overflows the strip by ${one.scroll - one.client}px`,
      ).toBeLessThanOrEqual(one.client)
    }
  })

  /**
   * 🔴 **And the headroom, because *it fits* is not the fact the next dispatch needs.**
   *
   * ⛔ **This is the number that says the strip is FULL.** It is derived rather than typed: the
   * widest layout's spare pixels, against the width of the narrowest tab there is plus the gap it
   * would bring. ⚑ An eighth tab is therefore a dispatch about the strip — a drop to icon-only
   * padding, a smaller glyph, or the *"more"* menu `079` refused — and not a line in `drawer.ts`.
   */
  it('⛔ …and one more would not — the headroom, measured against the narrowest tab', () => {
    const m = mount(Harness, { start: 'changes', fit: 'docked' }, { width: DRAWER_W_MIN })
    const strip = m.q('drawer-tabs')
    const buttons = [...strip.querySelectorAll<HTMLElement>('button')]
    expect(buttons).toHaveLength(DRAWER_TABS.length)

    const widest = Math.max(...buttons.map((b) => b.getBoundingClientRect().width))
    const narrowest = Math.min(...buttons.map((b) => b.getBoundingClientRect().width))
    // ⚠️ The label is what makes the active tab the widest, so the two numbers must differ — a strip
    // whose buttons were all one width would make the headroom below meaningless.
    expect(widest).toBeGreaterThan(narrowest)

    const gap = Number.parseFloat(getComputedStyle(strip).columnGap || '0')
    const headroom = strip.clientWidth - strip.scrollWidth
    expect(headroom).toBeGreaterThanOrEqual(0)
    // 🔴 **The claim**: there is not room for one more icon-only tab and its gap.
    expect(headroom, `one more tab would still fit — headroom ${headroom}px`).toBeLessThan(
      narrowest + gap,
    )
  })
})

describe('§2 · the tab draws the work, and nothing about the worker', () => {
  it('🔴 clicking Work mounts the list, and every row says who, what and how it is going', async () => {
    const m = mount(
      Harness,
      { start: 'open', fit: 'docked', work: reading([workRow()]) },
      { width: 380, height: 700 },
    )
    const button = m.q('drawer-tab-work')
    expect(
      button.dataset.active,
      'the Work tab was already active — the click proves nothing',
    ).toBe('false')
    button.click()
    await nextTick()
    expect(button.dataset.active).toBe('true')

    m.q('session-work')
    const row = m.q('work-row-work_one')
    expect(row.textContent).toContain('W1.4')
    expect(m.q('work-row-who').textContent?.trim()).toBe('worker')
    // ⛔ **The state word comes from `work-report.ts`** — the same line the transcript's work-report
    // row draws, through the same component.
    expect(m.q('work-report-word').textContent?.trim()).toBe('being worked on')
    // ⚠️ The piece's TITLE is the line (D-016: a title is one line, and its own hover).
    expect(m.q('work-row-said').textContent?.trim()).toBe('read the brief and report')
    expect(m.q('work-row-said').getAttribute('title')).toBe('read the brief and report')
    // ⛔ **The heading is the bare label** — ⚑ D-016 took the project out of a piece's name (`718`
    // had put it there for another project's work; the whole-list chip before it is gone too), so
    // the heading is what is asserted, exactly.
    expect(row.querySelector('.heading')?.textContent?.trim()).toBe('W1.4')
    expect(m.all('work-row-project')).toEqual([])
  })

  it('⛔ nothing on this tab says whether the worker is alive', async () => {
    const m = mount(
      Harness,
      {
        start: 'open',
        fit: 'docked',
        work: reading([
          workRow(),
          workRow({ piece: 'work_two', state: 'stalled', stalledBecause: 'turn_ended' }),
        ]),
      },
      { width: 380, height: 700 },
    )
    m.q('drawer-tab-work').click()
    await nextTick()

    const body = m.host.querySelector('.drawer-body')!
    // 🔴 **`505`'s bound, drawn as an absence.** The only thing this app can say about a conversation
    // it is not running is who is WATCHING it, so a plate here would claim a freshness and a health
    // nothing measured. ⚑ Asserted over the hooks `AgentState` mounts rather than over a class name.
    for (const claim of ['agent-avatar', 'agent-unknown', 'session-bot', 'agent-plate']) {
      expect(
        body.querySelectorAll(`[data-cy="${claim}"]`),
        `the Work tab draws ${claim}`,
      ).toHaveLength(0)
    }
    // ⚠️ **The positive control**: the tab DID render, and it rendered the state of the TASK — so
    // the absences above are a choice rather than a body that failed to mount.
    expect(m.all('work-row-said')).toHaveLength(2)
    // ⚑ **624 · re-aimed onto the words `UNDRIVEN_SENTENCES` now holds** (`HO-095` §5.2) — the
    // clause *and it replied nothing* was false beside the quotation the notice carries, and the
    // row here draws the same one table every other surface does, which is what this assertion
    // is for.
    expect(m.q('work-row-work_two').textContent).toContain(
      'its turn ended with this work still open',
    )
  })

  it('⚑ the tally rides the Work icon, is muted, and is absent when nothing is open', async () => {
    const open = mount(
      Harness,
      { start: 'open', fit: 'docked', work: reading([workRow()]) },
      { width: 380, height: 700 },
    )
    const tally = open.q('drawer-tab-work-count')
    expect(tally.textContent?.trim()).toBe('1')
    // ⛔ **Its own hook, and not `drawer-tab-count`** — that one is the Changes tab's and four
    // instruments address it.
    expect(open.all('drawer-tab-count')).toEqual([])
    // ⛔ **`--muted`, and never the amber attention colour**: work being open is not a question, so
    // this tally may not spend the channel `063`/`080` built for *"something is waiting on you"*.
    //
    // ⚠️ **Both sides are resolved through `parseColor`, and the first draft compared the computed
    // `color` to the raw token string** — `rgb(…)` against `#…`, which can never be equal and made
    // the negative pass over any colour at all. ⛔ The POSITIVE is what makes this measure something:
    // it is `--muted`, and `--muted` and `--waiting` are shown to differ in the same sample.
    const tokens = getComputedStyle(document.documentElement)
    const amber = parseColor(tokens.getPropertyValue('--waiting').trim())
    const muted = parseColor(tokens.getPropertyValue('--muted').trim())
    const drawn = parseColor(getComputedStyle(tally).color)
    expect(amber, 'the --waiting token did not resolve').not.toBeNull()
    expect(muted, 'the --muted token did not resolve').not.toBeNull()
    expect(amber).not.toEqual(muted)
    expect(drawn).toEqual(muted)
    // ⚠️ …and it rides the ICON, so it survives the six tabs that have no label.
    expect(tally.closest('[data-cy="drawer-tab-work"]')).not.toBeNull()
    open.unmount()

    // ⛔ **Absent, never `0`** — `081`'s rule, on a strip with no room for the sentence that would
    // make a zero mean something.
    const closed = mount(
      Harness,
      { start: 'open', fit: 'docked', work: reading([workRow({ state: 'answered' })]) },
      { width: 380, height: 700 },
    )
    expect(closed.all('drawer-tab-work-count')).toEqual([])
    closed.unmount()

    // ⚑ …and so is a conversation whose work has not been read at all.
    const unread = mount(Harness, { start: 'open', fit: 'docked' }, { width: 380, height: 700 })
    expect(unread.all('drawer-tab-work-count')).toEqual([])
  })

  /**
   * The Open tab lists no work and includes no sentence pointing to this tab.
   */
  it('⛔ the Open tab lists none of the work, and draws no sentence about it', async () => {
    const m = mount(
      Harness,
      { start: 'open', fit: 'docked', work: reading([workRow()]) },
      { width: 380, height: 700 },
    )
    expect(m.q('session-panel')).toBeTruthy()
    expect(m.all('session-panel-empty')).toEqual([])
    expect(m.q('session-panel').textContent).not.toContain('Work tab')
    expect(m.all('work-rows')).toEqual([])
  })

  it('⚠️ the tab does not overflow either drawer width', async () => {
    for (const [fit, width] of [
      ['narrow', DRAWER_W_MIN],
      ['comfortable', 380],
    ] as const) {
      const m = mount(
        Harness,
        {
          start: 'open',
          fit,
          work: reading([workRow({ givenToProfile: 'a-rather-long-identity-slug' })]),
        },
        { width, height: 700 },
      )
      m.q('drawer-tab-work').click()
      await nextTick()
      const body = m.q('session-work')
      expect(
        body.scrollWidth,
        `the Work tab overflows at ${fit} by ${body.scrollWidth - body.clientWidth}px`,
      ).toBeLessThanOrEqual(body.clientWidth + 1)
      m.unmount()
    }
  })
})
