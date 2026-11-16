import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import ReadingPane from '../../src/renderer/src/components/ReadingPane.vue'
import { createWindow } from '../../src/renderer/src/lib/transcript-window'
import { TRANSCRIPT_MIN } from '../../src/renderer/src/lib/drawer'
import type { LibraryEntry, ProviderUsageReading } from '../../src/shared/runtime-ipc'
import {
  META,
  mount,
  paneProps,
  record,
  parseColor,
  visible,
  type Mounted,
} from './harness'
import { resetUsageCards, usageCards } from './usage-cards'
import { providerConnectionFixtures } from '../../look/fixtures/providers'
import { railFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { attributedUsageFixtures, runningSignInFixtures } from './provider-launch.fixture'

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(() => resetUsageCards(ORIGINAL.width, ORIGINAL.height))

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

describe('the native title bar', () => {
  it('is a 32px drag region with selectable diagnostics outside the drag region', async () => {
    await page.viewport(1200, 840)
    const m = bar(1200, 'The startup read failed')
    const strip = m.q('app-titlebar')
    expect(getComputedStyle(strip).getPropertyValue('-webkit-app-region').trim()).toBe('drag')
    expect(Math.round(strip.getBoundingClientRect().height)).toBe(32)
    expect(getComputedStyle(m.q('app-info')).getPropertyValue('-webkit-app-region').trim()).toBe(
      'no-drag',
    )
    expect(m.q('startup-error').textContent).toBe('The startup read failed')
    expect(getComputedStyle(m.q('startup-error')).userSelect).toBe('text')
    expect(m.host.querySelector('.window-controls')).toBeNull()
    for (const control of ['close', 'minimize', 'zoom']) {
      expect(m.all(`window-${control}`)).toHaveLength(0)
    }
    expect(m.host.textContent).not.toContain('Saved locally')
    expect(m.host.querySelector('.sync-dot')).toBeNull()
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
  railFacts().update({ runningConversations: runningSignInFixtures() })
  ;(window as { api?: unknown }).api = {
    runtime: {
      providerConnections: async () => providerConnectionFixtures(),
      providerUsage: () => Promise.resolve(attributedUsageFixtures(usage)),
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

async function cardsWithUnreadWeeks() {
  await page.viewport(1200, 808)
  const now = Date.now()
  return cards({
    claude: [
      {
        window: 'five_hour',
        period: { word: '5-hour', durationMs: 5 * HOUR, bucket: false, bucketName: null },
        usedPercent: 28,
        resetsAt: now + 3 * HOUR,
        at: now - 60_000,
      },
    ],
    codex: [],
  })
}

describe('§2 · the usage cells, and each one answers for itself', () => {
  it('🔴 an empty answer keeps each running group unknown, then agents and memory; the shelf spans the transcript AND the companion', async () => {
    await page.viewport(1200, 808)
    const usage = await cards(NO_USAGE)
    expect(
      [...usage.q('app-usage-cards').querySelectorAll<HTMLElement>('[data-cy^="shelf-usage-"]')]
        .map((el) => el.dataset['cy'])
        .filter((cy) => cy !== 'shelf-usage-age' && cy !== 'shelf-usage-value'),
    ).toEqual([
      'shelf-usage-claude-unknown',
      'shelf-usage-codex-unknown',
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

  it('🔴 unreported windows stay absent beside a read window and an unknown running group', async () => {
    const m = await cardsWithUnreadWeeks()
    expect(m.q('shelf-usage-claude-5h').querySelector('[data-cy="shelf-missing"]')).toBeNull()
    expect(m.q('shelf-usage-claude-5h').innerText).toContain('28% · resets in 3 h')
    for (const key of ['claude-week', 'codex-week', 'codex-5h']) {
      expect(m.all(`shelf-usage-${key}`)).toHaveLength(0)
    }
    expect(m.q('shelf-usage-codex-unknown').innerText).toContain('Not read yet')
    expect(m.all('shelf-missing')).toHaveLength(1)
  })

  it('⚠️ an absence is drawn by its colour, at the same weight as a value', async () => {
    const m = await cardsWithUnreadWeeks()
    const missing = m.q('shelf-usage-codex-unknown').querySelector('[data-cy="shelf-missing"]')
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
      { entry: ENTRY, history: createWindow() },
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
