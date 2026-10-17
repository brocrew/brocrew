import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import ReadingPane from '../../src/renderer/src/components/ReadingPane.vue'
import { createWindow } from '../../src/renderer/src/lib/transcript-window'
import { TRANSCRIPT_MIN } from '../../src/renderer/src/lib/drawer'
import { WINDOW_CONTROLS } from '../../src/shared/window-controls'
import type { LibraryEntry, ProviderUsageReading } from '../../src/shared/runtime-ipc'
import {
  META,
  contrast,
  mount,
  paneProps,
  record,
  parseColor,
  paintedBackground,
  unmountAll,
  visible,
  type Mounted,
} from './harness'
import { usageCards } from './usage-cards'

/**
 * 🔴 **One title bar, and one shelf that is not a second one** (389 §2 and §3).
 *
 * ## ⛔ Why this file exists at all, and it is a gap `385` left open
 *
 * `385` shipped the frameless window and three working controls, and everything the repository knew
 * about the RESULT was a string. `dom/window-controls.dom.test.ts` says so on its own face — it
 * **reproduces** the bar with an inline `webkitAppRegion: 'drag'` because `.titlebar` was scoped CSS
 * inside `RuntimeScreen.vue`, and nothing mounts `RuntimeScreen`. `build-identity.test.ts` said the
 * same thing about the build chip in more words. ⚠️ So the two claims a person actually cares about
 * — *the bar is the drag region* and *the bar is 32px* — were checked only by two live rigs that
 * are not in `ci`.
 *
 * `389 §2` moved the bar into `AppTitleBar.vue` **without changing it**, and this is what the move
 * buys: the real element, the real scoped cascade, measured at the widths the app actually opens at.
 *
 * ## ⚑ The geometry every section here uses
 *
 * `main/index.ts` declares `1200 × 840` with `frame: false`, so the web contents are 840 tall and
 * the shell **below our own 32px bar** is `1200 × 808` — which is why this directory writes
 * `1200 × 808` everywhere and why §1 alone wants the whole `1200 × 840`.
 *
 * ⛔ **The viewport is shared, so this file puts it back.**
 *
 * ## ⚠️ What this does NOT cover
 *
 * The reveal-on-hover of the control glyphs is not simulated: nothing in this directory drives a
 * pointer, and a `:hover` rule read back out of the stylesheet would be a string assertion wearing a
 * measurement's clothes. §1.3 asserts the two halves that ARE readings — the glyph exists and is
 * distinct per control, and the colour it is revealed in is legible on all three fills.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  delete (window as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const INFO = {
  name: 'BroBot2',
  version: '0.0.0',
  build: { id: 'e76e7c6', commit: 'e76e7c6dead', dirty: false },
  db: { migrationsApplied: 24 },
} as never

/** The bar, in a box it does not choose — the viewport is what decides its width. */
function bar(width: number, error: string | null = null): Mounted {
  return mount(AppTitleBar, { info: INFO, error }, { width, height: 32 })
}

/** Centre of a box on the x axis, which is the only axis the title's placement is about. */
function centreX(el: Element): number {
  const box = el.getBoundingClientRect()
  return box.x + box.width / 2
}

/* ------------------------------------------------------------------ §1 · the bar, actually mounted */

describe('§1 · the real title bar, measured rather than matched (389 §2)', () => {
  it('🔴 IS the drag region, and it is the token tall — the first reading of the real element', async () => {
    await page.viewport(1200, 840)
    const m = bar(1200)
    const strip = m.q('app-titlebar')

    // ⛔ This is the assertion `window-controls.dom.test.ts` could only make against a reproduction:
    // the app's OWN `.titlebar`, with the app's own scoped rule, computed by the engine.
    expect(getComputedStyle(strip).getPropertyValue('-webkit-app-region').trim()).toBe('drag')
    expect(Math.round(strip.getBoundingClientRect().height)).toBe(32)
    // …and the token it is keyed to is the one the arithmetic in `one-title-bar.test.ts` uses.
    expect(getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h').trim()).toBe(
      '32px',
    )
    // ⚑ The control, one fact over: the build chip inside it opts back OUT, so the reading above
    // distinguishes a region from an inherited default rather than reporting the same word twice.
    expect(getComputedStyle(m.q('app-info')).getPropertyValue('-webkit-app-region').trim()).toBe(
      'no-drag',
    )
  })

  it('⛔ the three controls are pressable where they sit, inside that region', async () => {
    await page.viewport(1200, 840)
    const m = bar(1200)
    for (const control of WINDOW_CONTROLS) {
      const button = m.q(`window-${control}`)
      expect(getComputedStyle(button).getPropertyValue('-webkit-app-region').trim()).toBe('no-drag')
      const box = button.getBoundingClientRect()
      expect(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        `${control} is not the thing at its own centre`,
      ).toBe(button)
      expect(visible(button)).toBe(true)
    }
  })

  it('⚠️ each control carries its own glyph, and the colour it is revealed in is legible on all three', async () => {
    await page.viewport(1200, 840)
    const m = bar(1200)
    const buttons = WINDOW_CONTROLS.map((control) => m.q(`window-${control}`))

    // 🔴 **The first mark.** `tokens.css` says the colour is the second mark and never the only one;
    // 385 shipped three fills and no glyph, so which control a dot was could only be answered by a
    // reader who separates the hues.
    const glyphs = buttons.map((b) => b.textContent?.trim() ?? '')
    expect(glyphs.every((g) => g.length > 0)).toBe(true)
    expect(new Set(glyphs).size).toBe(3)

    // ⚑ **At rest the bar is exactly what 385 shipped** — the glyph is laid out and invisible, so
    // revealing it moves nothing and the resting window is unchanged.
    for (const button of buttons) expect(parseColor(getComputedStyle(button).color)?.[3]).toBe(0)

    // ⛔ **And when it IS revealed it can be read on every fill.** This is the reading that could
    // have been wrong: one dark ink over red, amber and green is three different contrasts.
    const ink = parseColor(
      getComputedStyle(document.documentElement).getPropertyValue('--traffic-glyph').trim(),
    )
    expect(ink, 'the glyph token did not resolve — the stylesheet did not load').not.toBeNull()
    for (const button of buttons) {
      const fill = paintedBackground(button)
      const ratio = contrast([...ink!.slice(0, 3), 1] as never, fill)
      expect(
        ratio,
        `${button.dataset['cy']} reads ${ratio.toFixed(2)} against its own fill`,
      ).toBeGreaterThan(3)
    }
  })

  /**
   * 🔴 **The one thing 389 §2 changed about the bar, and what it was worth** — measured at 1200 with
   * a long `startup-error` in the right-hand cluster, as the offset of the title's centre from the
   * bar's:
   *
   * | declarations | title off centre |
   * |---|---:|
   * | ours (`minmax(0, 1fr)` + `min-width: 0`) | **0.0px** |
   * | track floor back only | 0.0px |
   * | cluster floor back only | 0.0px |
   * | **385's pair, both floors back** | **169.8px** |
   *
   * ⚠️ So the two declarations are redundant with each other and neither is decorative: `1fr` is
   * `minmax(auto, 1fr)`, and a flex row refuses to shrink below its content, so BOTH floors have to
   * be present for the third track to steal from the second. ⛔ 385 had both, and a provider error —
   * an arbitrary string this app does not author — walked the window's own name 170px to the left.
   */
  it('🔴 the title stays centred on the WINDOW when the right cluster grows (389 §2)', async () => {
    await page.viewport(1200, 840)

    // The ordinary bar: a short build chip on the right.
    const quiet = bar(1200)
    const quietOffset = centreX(quiet.q('window-title')) - centreX(quiet.q('app-titlebar'))
    expect(Math.abs(quietOffset)).toBeLessThan(1)
    quiet.unmount()

    // ⚠️ **A real startup error is an arbitrary provider string**, and it lands in this cluster.
    const loud = bar(1200, 'the capabilities read failed: ' + 'ENOENT '.repeat(12))
    const loudOffset = centreX(loud.q('window-title')) - centreX(loud.q('app-titlebar'))
    expect(
      Math.abs(loudOffset),
      `a long error moved the title ${loudOffset.toFixed(1)}px off centre`,
    ).toBeLessThan(1)

    const strip = loud.q('app-titlebar')
    const cluster = loud.q('app-info')
    const read = (): number => centreX(loud.q('window-title')) - centreX(strip)
    const table: Record<string, number> = { ours: read() }
    strip.style.gridTemplateColumns = '1fr auto 1fr'
    await nextTick()
    table.gridOnly = read()
    strip.style.gridTemplateColumns = ''
    // ⚑ The cluster's floor is three declarations now: `min-width: 0`, and the `overflow: hidden` and
    // `max-width: 100%` that keep it inside its own track beside a long title. Each alone gives it a
    // zero minimum, so all three are taken off to restore the cluster as it was before the fix.
    cluster.style.minWidth = 'auto'
    cluster.style.overflow = 'visible'
    cluster.style.maxWidth = 'none'
    await nextTick()
    table.clusterOnly = read()
    strip.style.gridTemplateColumns = '1fr auto 1fr'
    await nextTick()
    table.both = read()
    // ⚑ **Either declaration alone holds it, and both are present** — measured, not assumed.
    expect(Math.abs(table.gridOnly!), 'the track floor alone moves it').toBeLessThan(1)
    expect(Math.abs(table.clusterOnly!), 'the cluster floor alone moves it').toBeLessThan(1)
    // ⛔ **385's exact pair of declarations, and this is the defect being fixed**: the title left
    // the centre of the window by 170px — half the bar — the first time a provider error was long.
    expect(
      Math.abs(table.both!),
      `385's declarations keep the title within ${Math.abs(table.both!).toFixed(1)}px of centre — this test measures nothing`,
    ).toBeGreaterThan(100)
  })
})

/* ---------------------------------------------------------------------------- §2 · the shared shelf */

type Usage = Record<'claude' | 'codex', ProviderUsageReading[]>

/** A conversation at the shell's own size, with the shelf in it, reading these usage readings. */
function pane(over: Record<string, unknown> = {}, usage: Usage = NO_USAGE): Mounted {
  ;(window as { api?: unknown }).api = {
    runtime: {
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
      providerUsage: () => Promise.resolve(usage),
      onProvidersChanged: () => () => {},
    },
  }
  return mount(ConversationPane, paneProps(over), { width: 1200, height: 808 })
}

const NO_USAGE: Usage = { claude: [], codex: [] }
const HOUR = 3_600_000

/** The title bar's usage cards, opened, reading these usage readings. */
async function cards(usage: Usage): Promise<Mounted> {
  ;(window as { api?: unknown }).api = {
    runtime: {
      providerUsage: () => Promise.resolve(usage),
      onProvidersChanged: () => () => {},
    },
  }
  const m = await usageCards(1200, 400)
  await settled()
  return m
}

/** Readings that settle once the shelf's read has answered. */
async function settled(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

describe('§2 · the usage cells, and each one answers for itself', () => {
  it('🔴 the title bar draws three usage blocks, provider by provider, then agents and memory; the shelf spans the transcript AND the companion', async () => {
    await page.viewport(1200, 808)
    const usage = await cards(NO_USAGE)
    expect(
      [...usage.q('app-usage-cards').querySelectorAll<HTMLElement>('[data-cy^="shelf-usage-"]')]
        .map((el) => el.dataset['cy'])
        .filter((cy) => cy !== 'shelf-usage-age' && cy !== 'shelf-usage-value'),
    ).toEqual([
      'shelf-usage-claude-5h',
      'shelf-usage-claude-week',
      'shelf-usage-codex-week',
      'shelf-usage-agents',
      'shelf-usage-memory',
    ])
    // ⛔ The session's settings left the strip for the Agent panel; named so their removal is a
    // measurement rather than a list that forgot them.
    for (const key of ['model', 'reasoning', 'profile', 'plan', 'approval', 'home']) {
      expect(usage.all(`shelf-${key}`), `the cards still draw ${key}`).toHaveLength(0)
    }
    usage.unmount()

    // ⛔ **The usage left the conversation for the title bar**, and the shelf that is left still
    // spans both columns — the point of a SHARED shelf.
    const m = pane({ drawerOpen: true })
    await settled()
    const shelf = m.q('session-shelf')
    expect(m.all('shelf-settings')).toHaveLength(0)
    const shelfBox = shelf.getBoundingClientRect()
    const reading = m.q('reading-surface').getBoundingClientRect()
    const drawer = m.q('session-drawer').getBoundingClientRect()
    expect(Math.round(shelfBox.width)).toBe(Math.round(reading.width + drawer.width))
    expect(shelfBox.width).toBeGreaterThan(reading.width)
    expect(shelfBox.bottom).toBeLessThanOrEqual(reading.top + 0.5)
  })

  it('⛔ costs the reading column nothing — the drawer still docks at its widest at 1200', async () => {
    await page.viewport(1200, 808)
    const m = pane({ drawerOpen: true })
    await nextTick()
    const body = m.host.querySelector<HTMLElement>('.pane-body')
    expect(body?.dataset['fit']).toBe('docked')
    expect(m.q('reading-surface').getBoundingClientRect().width).toBeGreaterThanOrEqual(
      TRANSCRIPT_MIN,
    )
  })

  it('🔴 an unread window is unread ON ITS OWN — the pair, in one mount', async () => {
    await page.viewport(1200, 808)
    const now = Date.now()
    const m = await cards({
      claude: [
        { window: 'five_hour', usedPercent: 28, resetsAt: now + 3 * HOUR, at: now - 60_000 },
      ],
      codex: [],
    })
    expect(m.q('shelf-usage-claude-5h').querySelector('[data-cy="shelf-missing"]')).toBeNull()
    expect(m.q('shelf-usage-claude-5h').innerText).toContain('28% · resets in 3 h')
    // ⛔ The neighbours have no reading and say so, each in its own cell: nothing composite.
    for (const key of ['claude-week', 'codex-week']) {
      expect(m.q(`shelf-usage-${key}`).innerText).toContain('Not read yet')
    }
    // Codex no longer reports a 5-hour window, so no cell waits for one.
    expect(m.all('shelf-usage-codex-5h')).toHaveLength(0)
    expect(m.all('shelf-missing')).toHaveLength(2)
  })

  it('⚠️ an absence is drawn by its colour, at the same weight as a value', async () => {
    await page.viewport(1200, 808)
    const now = Date.now()
    const m = await cards({
      claude: [
        { window: 'five_hour', usedPercent: 28, resetsAt: now + 3 * HOUR, at: now - 60_000 },
      ],
      codex: [],
    })
    const missing = m.q('shelf-usage-codex-week').querySelector('[data-cy="shelf-missing"]')
    const present = m.q('shelf-usage-claude-5h').querySelector('[data-cy="shelf-usage-value"]')
    expect(missing).not.toBeNull()
    expect(present).not.toBeNull()
    const a = getComputedStyle(missing as Element)
    const b = getComputedStyle(present as Element)
    expect(a.color).not.toBe(b.color)
    // ⚑ Every value line in the strip is one weight, read or not.
    expect(a.fontWeight).toBe(b.fontWeight)
  })

  it('⚠️ a conversation the host has not described yet draws no shelf, and nothing fills in', async () => {
    await page.viewport(1200, 808)
    const props = paneProps()
    const record = props['record'] as { meta: unknown }
    record.meta = null
    ;(window as { api?: unknown }).api = {
      runtime: {
        listResumable: () => Promise.resolve([]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const m = mount(ConversationPane, props, { width: 1200, height: 808 })
    await nextTick()
    expect(m.all('session-shelf')).toHaveLength(0)
    expect(m.all('shelf-missing')).toHaveLength(0)
    // ⚑ The positive: the pane itself rendered, so the absence above is the shelf's and not a
    // mount that failed.
    expect(m.all('reading-surface')).toHaveLength(1)
  })
})

/* -------------------------------------------------------------- §3 · NOW, and what may summon you */

describe('§3 · NOW is separate from pending human attention (389 §3)', () => {
  it('🔴 a permission gets its OWN row, and no activity string is in it', async () => {
    await page.viewport(1200, 808)
    // `paneProps` opens with a pending permission — the state the whole rule is about.
    const m = pane()
    await nextTick()

    const attention = m.q('shelf-attention')
    expect(attention.dataset['needing']).toBe('permission')
    expect(attention.innerText).toContain('needs you (permission)')
    // ⛔ **The separation, as a reading**: the attention row is the shelf's, and the activity and
    // its stamp end the header's status line. Ordinary activity may not wear this treatment.
    expect(m.q('session-shelf').contains(attention)).toBe(true)
    expect(m.q('session-header').contains(attention)).toBe(false)
    expect(
      attention.querySelector('[data-cy="shelf-activity"], [data-cy="shelf-last-report"]'),
    ).toBeNull()
    expect(attention.innerText).not.toContain('NOW')

    // ⚠️ **Amber is the attention channel, and the row is all the shelf holds** — the usage is the
    // title bar's now, so nothing else on the shelf can wear it.
    expect([...m.q('session-shelf').children]).toEqual([attention])
  })

  it('⛔ …and with nothing waiting the row is gone while the shelf stays — the pair', async () => {
    await page.viewport(1200, 808)
    // ⚠️ **A record with no request in it, not a zeroed count.** `facetInput` derives the needing
    // from the panel's own projection over the transcript's items, so blanking a count would leave
    // the fact that produces it untouched — and the row would still draw.
    const m = pane({ record: record([]) })
    await nextTick()

    expect(m.all('shelf-attention')).toHaveLength(0)
    // ⚑ The positive: the shelf is still there, so the absence above is the attention row's alone.
    expect(m.all('session-shelf')).toHaveLength(1)
    // …and with nothing in it the shelf is only its rule under the header.
    expect(m.q('session-shelf').getBoundingClientRect().height).toBeLessThanOrEqual(1.5)
  })

  it('🔴 a plan waiting for a go-ahead is a NEEDING and is NOT attention — where the two diverge', async () => {
    await page.viewport(1200, 808)
    // ⛔ **The pair, tested where the readings differ.** `needingFor` answers `plan` here, so the
    // facet IS set — a shelf keyed on *"is anything needing?"* would paint amber. The rule is
    // narrower: a go-ahead blocks nothing and can be pressed whenever, so it may not summon.
    const props = paneProps({ record: record([]) })
    const held = props['record'] as { meta: typeof META }
    held.meta = { ...META, planNeedsGoAhead: true }
    ;(window as { api?: unknown }).api = {
      runtime: {
        listResumable: () => Promise.resolve([]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const m = mount(ConversationPane, props, { width: 1200, height: 808 })
    await nextTick()

    // ⚑ The premise: the go-ahead really is on screen, so this is a conversation in that state and
    // not one where the fixture failed to set it.
    expect(m.all('plan-go-ahead')).toHaveLength(1)
    expect(m.all('shelf-attention')).toHaveLength(0)
    // …and the shelf did render, so the absence is the row's and not the surface's.
    expect(m.all('session-shelf')).toHaveLength(1)
  })

  it('⚑ a RUNNING conversation says the word and the provider’s own tool name, in its own colour', async () => {
    await page.viewport(1200, 808)
    // ⚠️ **The state the NOW row is actually for**, and the one the fixture does not open in — which
    // matters twice over: it is the positive half of the pair below, and it is the state
    // `.now-copy`'s colour is READ in. A colour asserted only where `.missing` overrides it is a
    // colour nothing measures (`a-style-mutations-control-is-the-state-it-falls-back-to`).
    const m = pane({
      record: record([
        { type: 'status', state: 'working' } as never,
        { type: 'activity', phase: 'tool', detail: 'Bash' } as never,
      ]),
    })
    await nextTick()

    const activity = m.q('shelf-activity')
    // ⛔ The pill's rule and nothing more: the word this app owns, plus the name the provider sent.
    expect(activity.innerText.trim()).toBe('running Bash')
    expect(activity.dataset['doing']).toBe('tool')
    // …and no attention row, because running is not waiting.
    expect(m.all('shelf-attention')).toHaveLength(0)
    // ⛔ **Blue, not amber.** `080` reserves amber for the attention channel, and ordinary progress
    // may not spend it.
    // ⛔ **The token is read on the HEADER, not on the root** — and a mutation caught that too. The
    // conversation pane carries `data-chat-theme="light"`, which redeclares `--waiting-text-label`;
    // a reading taken from `document.documentElement` returns the DARK value, so an activity line
    // painted the light amber would have compared unequal to it and passed
    // (`an-inherited-property-carries-a-resolved-colour-past-a-token-scope`).
    const waiting = getComputedStyle(m.q('session-header'))
      .getPropertyValue('--waiting-text-label')
      .trim()
    expect(parseColor(waiting), 'the amber token did not resolve in this scope').not.toBeNull()
    expect(parseColor(getComputedStyle(activity).color)).not.toEqual(parseColor(waiting))
  })

  it('⚠️ with no activity and no report the status line says nothing of either', async () => {
    await page.viewport(1200, 808)
    const m = pane()
    await nextTick()
    // The fixture publishes no `activity` event, so `activityLine` answers `null`, and its record
    // holds no ledger entries, so there is no report to time: the standing beside the plate says
    // the rest.
    expect(m.all('shelf-now')).toHaveLength(0)
    expect(m.all('shelf-activity')).toHaveLength(0)
    expect(m.all('shelf-last-report')).toHaveLength(0)
    const said = m.q('session-header').innerText
    expect(said).not.toContain('No activity reported')
    expect(said).not.toContain('Time not reported')
    // ⚑ The positive: the line itself drew.
    expect(visible(m.q('session-status'))).toBe(true)
  })

  it('⛔ the last-report stamp is the newest event’s clock time, never a zero and never "just now"', async () => {
    await page.viewport(1200, 808)
    const at = new Date(2026, 9, 11, 1, 55).getTime()
    const held = record([
      { type: 'status', state: 'working' } as never,
      { type: 'activity', phase: 'tool', detail: 'Bash' } as never,
    ])
    held.window.entries = [
      {
        sessionId: 'sess_1',
        ordinal: 0,
        at: at - 1000,
        event: { type: 'status', state: 'working' } as never,
      },
      {
        sessionId: 'sess_1',
        ordinal: 1,
        at,
        event: { type: 'activity', phase: 'tool', detail: 'Bash' } as never,
      },
    ]
    const m = pane({ record: held })
    await nextTick()
    const stamp = m.q('shelf-last-report')
    expect(stamp.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^last report 0?1[:.]55/)
    expect(stamp.querySelector('time')?.getAttribute('datetime')).toBe(String(at))
    expect(stamp.textContent).not.toMatch(/\bnow\b/i)
    // ⚑ Both facts end the status line, after the standing, in one line.
    const now = m.q('shelf-now')
    expect(m.q('session-header').contains(now)).toBe(true)
    expect(now.innerText.replace(/\s+/g, ' ')).toContain('running Bash')
    const status = m.q('session-status').getBoundingClientRect()
    expect(Math.abs(now.getBoundingClientRect().top - status.top)).toBeLessThan(status.height)
  })
})

/* ------------------------------------------------------- §4 · a record is not a live session */

const ENTRY: LibraryEntry = {
  id: 'rec_1',
  provider: 'claude',
  providerSessionId: 'th_1',
  recordId: 'rec_1',
  cwd: '/work/checkout',
  title: 'A recorded conversation',
  preview: 'the first thing it said',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
  bytes: 1024,
  origin: 'ours',
  onDisk: true,
  readable: true,
  derived: null,
  lastEnding: null,
  unresumableReason: null,
  child: null,
}

describe('§4 · the archived variant is reduced, and it cannot borrow (389 §3)', () => {
  it('🔴 a record draws no shelf and none of the six facts', async () => {
    await page.viewport(1200, 808)
    const m = mount(
      ReadingPane,
      { entry: ENTRY, history: createWindow(), mode: 'normal' },
      { width: 1200, height: 808 },
    )
    await nextTick()

    expect(m.all('session-shelf')).toHaveLength(0)
    for (const key of ['model', 'reasoning', 'profile', 'plan', 'approval', 'home']) {
      expect(m.all(`shelf-${key}`), `a record drew ${key}`).toHaveLength(0)
    }
    // ⛔ **And no absence of them either.** A record has no model, and *"Model — Not reported"*
    // would be this surface answering a question a `LibraryEntry` cannot be asked.
    expect(m.all('shelf-missing')).toHaveLength(0)
    expect(m.all('shelf-now')).toHaveLength(0)
    // ⚑ The positive: the pane rendered its own reduced header, so the absences are deliberate.
    expect(m.q('reading-title').innerText).toContain('A recorded conversation')
  })

  it('⚑ …and the very same directory’s live pane DOES draw them — the pair', async () => {
    await page.viewport(1200, 808)
    const m = pane()
    await nextTick()
    expect(m.all('session-shelf')).toHaveLength(1)
  })
})
