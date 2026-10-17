import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import type { AgentState } from '../../src/shared/agent-state'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { mount, parseColor, unmountAll, visible, type Mounted } from './harness'

/**
 * **2026-10-01 · the rail's conversations in two sections — BroBot's, then the other agents'.**
 *
 * The side menu separates BroBot conversations from other agents, each in its own collapsible
 * list.
 *
 * What a person sees, and what this pins:
 *
 *  1. **two sections, BroBot's first**, each with its own rows in the one list's order (newest
 *     first); BroBot's in any spelling a person typed its profile, and a conversation this app ran
 *     as nobody under the other agents;
 *  2. **a press on a section's header folds it** — its rows go, the other section's stay, and the
 *     folded header keeps its count and its *needs you* badge;
 *  3. **a folded section holding the conversation on screen says so** on its header, in the row's
 *     own selection;
 *  4. **a section with no rows is not drawn**;
 *  5. **the fold is remembered per viewer** — a remount keeps it, and a fresh viewer sees both open;
 *  6. **a row's press still selects**, in either section, and the palette still lists a folded
 *     section's conversations.
 *
 * Every negative below is paired with a reading of the same mount one fact over: a row that is gone
 * beside the rows that stay, a section that is not drawn beside the mount where it is, a header with
 * no mark beside the one that has it. A real engine, because a fold is what the DOM draws and a
 * mark is what the cascade paints.
 */

/* ------------------------------------------------------------------ fixtures */

const NOW = Date.now()
const CWD = '/Users/alex/dev/brobot-2'

const MINUTE = 60_000

/** A conversation the host lists, run as `profileId`, last moved `minutesAgo`. */
const hostRow = (
  sessionId: string,
  profileId: string | null,
  minutesAgo: number,
  state: AgentState = { is: 'idle' },
): ResumableSessionInfo => ({
  sessionId,
  provider: 'claude',
  cwd: CWD,
  status: 'idle',
  state,
  // It holds no piece, so a row is titled by its agent.
  named: null,
  approvalMode: 'ask',
  profileId,
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  lastEnding: 'completed',
  updatedAt: NOW - minutesAgo * MINUTE,
  running: 'not-running',
  ref: { provider: 'claude', sessionId: `thread-${sessionId}`, cwd: CWD, rotation: 0 },
  resumeRefusal: null,
})

/** A conversation this window holds — its row is drawn from its record, first (the host has not listed it). */
const held = (sessionId: string, over: Record<string, unknown> = {}): unknown => {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: CWD,
    profileId: DEFAULT_PROFILE_ID,
    ref: { provider: 'claude', sessionId: 'live', cwd: CWD, rotation: 0 },
    approvalMode: 'ask',
    planNeedsGoAhead: false,
    liveness: { state: 'live', since: NOW },
    ...over,
  } as never
  return record
}

/** BroBot's, in the spellings a profile reaches the rail in. */
const BRO_NEW = hostRow('sess_bro_new', DEFAULT_PROFILE_ID, 1)
/** ⚑ A person typed BroBot's profile with capitals: one identity, one section. */
const BRO_TYPED = hostRow('sess_bro_typed', 'BroBot', 3, { is: 'needs-you' })
/** ⚑ A row recorded before profiles could be chosen — the host says it ran in BroBot's. */
const BRO_OLD = hostRow('sess_bro_old', null, 5)

/** Other agents'. */
const REVIEWER = hostRow('sess_rev', 'reviewer', 2, { is: 'needs-you' })
const DEVELOPER = hostRow('sess_dev', 'developer', 4)

/** Every host row, scrambled — only `updatedAt` orders them. */
const ALL_LISTED = [DEVELOPER, BRO_OLD, REVIEWER, BRO_NEW, BRO_TYPED]

/**
 * The two held conversations: BroBot's own — launched under the profile spelled as a person typed
 * it, which is what a record's `meta.profileId` keeps — and ⛔ one this app ran as NOBODY, a
 * person's own found in a provider's folder, whose `meta` carries BroBot's id only for the type's
 * sake.
 */
const HELD = (): unknown[] => [
  held('sess_bro_held', { profileId: 'BroBot' }),
  held('sess_own', { ranAsNobody: 'user-home' }),
]

const BROBOT_ROWS = ['sess_bro_held', 'sess_bro_new', 'sess_bro_typed', 'sess_bro_old']
const OTHER_ROWS = ['sess_own', 'sess_rev', 'sess_dev']

/* ------------------------------------------------------------------ storage */

/**
 * ⚑ **This file's own `localStorage`.** The fold is kept where the app keeps a per-viewer toggle,
 * and the dom project runs files side by side on one origin — so a fold written to the real store
 * could fold another file's rail. The rail reads `globalThis.localStorage` as it always does.
 */
const memoryStorage = (): Storage => {
  const kept = new Map<string, string>()
  return {
    get length() {
      return kept.size
    },
    clear: () => kept.clear(),
    getItem: (key: string) => kept.get(key) ?? null,
    key: (index: number) => [...kept.keys()][index] ?? null,
    removeItem: (key: string) => void kept.delete(key),
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})

/* ------------------------------------------------------------------ mounting */

type RailApi = {
  runtime: {
    listResumable: () => Promise<ResumableSessionInfo[]>
    listUnresumable: () => Promise<UnresumableSessionInfo[]>
  }
}

const stubbed = (): { api?: RailApi } => window as unknown as { api?: RailApi }

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

/** The rail over these host rows, with every row press collected. */
async function rail(
  listed: ResumableSessionInfo[],
  props: Record<string, unknown> = {},
): Promise<Mounted & { selected: string[] }> {
  const selected: string[] = []
  stubbed().api = {
    runtime: {
      listResumable: () => Promise.resolve(listed),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const m = mount(
    SideRail,
    {
      open: [],
      activeId: null,
      place: null,
      onSelect: (id: string) => selected.push(id),
      ...props,
    },
    { width: 251.68, height: 900 },
  )
  await settle()
  return Object.assign(m, { selected })
}

/** A text with its runs of whitespace folded. */
const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** The session ids one section draws, top to bottom. */
const rowsIn = (m: Mounted, key: 'brobot' | 'agents'): (string | null)[] =>
  [...m.q(`rail-section-${key}`).querySelectorAll('[data-cy^="open-session-"]')].map((row) =>
    row.getAttribute('data-session-id'),
  )

/** The sections drawn, top to bottom, by their hook. */
const sectionsDrawn = (m: Mounted): (string | null)[] =>
  [...m.q('rail-conversations').querySelectorAll('[data-cy^="rail-section-"]')].map((section) =>
    section.getAttribute('data-cy'),
  )

/** What a section's header names it. */
const heading = (m: Mounted, key: 'brobot' | 'agents'): string =>
  said(m.q(`rail-toggle-${key}`).querySelector('.section-name')!)

const press = async (el: HTMLElement): Promise<void> => {
  el.click()
  await nextTick()
}

/** The palette is teleported to `body`. */
const inPalette = (cy: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-cy="${cy}"]`)

afterEach(() => {
  unmountAll()
  delete stubbed().api
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ 1 · two sections */

describe('the rail draws BroBot’s conversations and the other agents’ in two sections', () => {
  it('two sections, BroBot’s first, each with its own rows newest first — and one run as nobody is not BroBot’s', async () => {
    const m = await rail(ALL_LISTED, { open: HELD() })

    expect(sectionsDrawn(m)).toEqual(['rail-section-brobot', 'rail-section-agents'])
    expect(heading(m, 'brobot')).toBe('BroBot')
    expect(heading(m, 'agents')).toBe('Other agents')

    // ⚑ BroBot's in every spelling, the held one first (the host has not listed it), then by time.
    expect(rowsIn(m, 'brobot')).toEqual(BROBOT_ROWS)
    // ⛔ The conversation run as nobody carries BroBot's id on its meta and is NOT BroBot's.
    expect(rowsIn(m, 'agents')).toEqual(OTHER_ROWS)

    // Each header counts its own rows, and its own waiting.
    expect(said(m.q('rail-count-brobot'))).toBe('4')
    expect(said(m.q('rail-count-agents'))).toBe('3')
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(m.q('rail-needs-you-brobot').getAttribute('title')).toBe('needs you: 1')
    expect(said(m.q('rail-needs-you-agents'))).toBe('1')

    // ⛔ The one block's heading is gone — the two sections replaced it.
    expect(said(m.q('rail-conversations'))).not.toContain('Conversations')
    // ⚑ Both headers are buttons that say they are open, and name the rows they open.
    for (const key of ['brobot', 'agents'] as const) {
      const toggle = m.q(`rail-toggle-${key}`)
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      const controls = toggle.getAttribute('aria-controls')
      expect(controls, `${key} names no rows`).toBeTruthy()
      expect(document.getElementById(controls!)).toBe(m.q(`rail-rows-${key}`))
    }
  })

  it('the waiting badge is a section’s own: absent on the section with nothing waiting, beside the one that has it', async () => {
    const m = await rail([BRO_NEW, BRO_TYPED, REVIEWER])
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(said(m.q('rail-needs-you-agents'))).toBe('1')
    unmountAll()

    // One fact over: the reviewer is idle, so the other agents' header has no badge.
    const quiet = await rail([BRO_NEW, BRO_TYPED, { ...REVIEWER, state: { is: 'idle' } }])
    expect(said(quiet.q('rail-needs-you-brobot'))).toBe('1')
    expect(quiet.all('rail-needs-you-agents')).toHaveLength(0)
    expect(said(quiet.q('rail-count-agents'))).toBe('1')
  })
})

/* ------------------------------------------------------------------ 2 · folding */

describe('a press on a section’s header folds it, and only it', () => {
  it('folding BroBot’s hides its rows and keeps its count and badge, and the other agents’ rows stay', async () => {
    const m = await rail(ALL_LISTED, { open: HELD() })
    const toggle = m.q('rail-toggle-brobot')

    await press(toggle)

    // ⛔ Its rows are gone…
    expect(m.all('rail-rows-brobot')).toHaveLength(0)
    for (const id of BROBOT_ROWS) expect(m.all(`open-session-${id}`), id).toHaveLength(0)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBeNull()
    expect(toggle.querySelector('.chev')!.classList.contains('down')).toBe(false)
    // …and its header is not traceless: the count and the badge, on screen.
    expect(said(m.q('rail-count-brobot'))).toBe('4')
    expect(visible(m.q('rail-needs-you-brobot'))).toBe(true)
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(heading(m, 'brobot')).toBe('BroBot')
    // ⚑ The other section is untouched.
    expect(m.q('rail-toggle-agents').getAttribute('aria-expanded')).toBe('true')
    expect(rowsIn(m, 'agents')).toEqual(OTHER_ROWS)
    for (const id of OTHER_ROWS) expect(visible(m.q(`open-session-${id}`)), id).toBe(true)

    // A second press unfolds it, in the order it had.
    await press(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.querySelector('.chev')!.classList.contains('down')).toBe(true)
    expect(rowsIn(m, 'brobot')).toEqual(BROBOT_ROWS)
  })

  it('folding the other agents’ hides theirs and leaves BroBot’s', async () => {
    const m = await rail(ALL_LISTED, { open: HELD() })

    await press(m.q('rail-toggle-agents'))

    expect(m.all('rail-rows-agents')).toHaveLength(0)
    for (const id of OTHER_ROWS) expect(m.all(`open-session-${id}`), id).toHaveLength(0)
    expect(said(m.q('rail-count-agents'))).toBe('3')
    expect(said(m.q('rail-needs-you-agents'))).toBe('1')
    expect(m.q('rail-toggle-agents').getAttribute('aria-expanded')).toBe('false')
    expect(rowsIn(m, 'brobot')).toEqual(BROBOT_ROWS)
  })
})

/* ------------------------------------------------------------------ 3 · the one on screen */

describe('a folded section holding the conversation on screen says so', () => {
  /** The header's accent: its fill and its bar, as the cascade paints them. */
  const accent = (toggle: HTMLElement): { fill: number; bar: string } => ({
    fill: parseColor(getComputedStyle(toggle).backgroundColor)?.[3] ?? 0,
    bar: getComputedStyle(toggle, '::before').content,
  })

  it('folded, BroBot’s header carries the selection; the other agents’ folded header does not', async () => {
    const m = await rail(ALL_LISTED, { open: HELD(), activeId: 'sess_bro_typed' })
    const brobot = m.q('rail-toggle-brobot')
    const agents = m.q('rail-toggle-agents')

    // Open: the ROW says it, and the header does not repeat it.
    expect(m.q('open-session-sess_bro_typed').getAttribute('data-active')).toBe('true')
    expect(brobot.getAttribute('data-active')).toBe('false')

    await press(brobot)
    await press(agents)

    // ⛔ Folded, the row is gone and the header holds the selection — in words and in paint.
    expect(m.all('open-session-sess_bro_typed')).toHaveLength(0)
    expect(brobot.getAttribute('data-active')).toBe('true')
    expect(brobot.getAttribute('title')).toBe('The conversation on screen is in here')
    expect(accent(brobot).fill).toBeGreaterThan(0)
    expect(accent(brobot).bar).toBe('""')
    // ⚑ The other folded header, one fact over: it does not hold the conversation on screen.
    expect(agents.getAttribute('data-active')).toBe('false')
    expect(agents.getAttribute('title')).toBeNull()
    expect(accent(agents).fill).toBe(0)
    expect(accent(agents).bar).toBe('none')
  })

  it('with a destination on screen instead, the folded header holding that conversation is not marked', async () => {
    // The same rows and the same `activeId` — but the screen is on *Waiting on you*.
    const m = await rail(ALL_LISTED, {
      open: HELD(),
      activeId: 'sess_bro_typed',
      place: 'waiting',
    })
    await press(m.q('rail-toggle-brobot'))
    expect(m.q('rail-toggle-brobot').getAttribute('data-active')).toBe('false')
    expect(said(m.q('rail-count-brobot'))).toBe('4')
    unmountAll()

    // The pair: the same viewer — so the same fold, remembered — with the conversation on screen.
    const onScreen = await rail(ALL_LISTED, { open: HELD(), activeId: 'sess_bro_typed' })
    expect(onScreen.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('false')
    expect(onScreen.q('rail-toggle-brobot').getAttribute('data-active')).toBe('true')
  })
})

/* ------------------------------------------------------------------ 4 · an empty section */

describe('a section with no rows is not drawn', () => {
  it('only BroBot’s conversations: no other agents’ section — beside the mount where one is drawn', async () => {
    const m = await rail([BRO_NEW, BRO_TYPED])
    expect(sectionsDrawn(m)).toEqual(['rail-section-brobot'])
    expect(m.all('rail-section-agents')).toHaveLength(0)
    expect(m.all('rail-toggle-agents')).toHaveLength(0)
    expect(heading(m, 'brobot')).toBe('BroBot')
    expect(said(m.q('rail-count-brobot'))).toBe('2')
    unmountAll()

    // One fact over: one more conversation, an agent's, and its section is drawn.
    const withOne = await rail([BRO_NEW, BRO_TYPED, DEVELOPER])
    expect(sectionsDrawn(withOne)).toEqual(['rail-section-brobot', 'rail-section-agents'])
    expect(heading(withOne, 'agents')).toBe('Other agents')
    expect(said(withOne.q('rail-count-agents'))).toBe('1')
  })

  it('only other agents’ conversations: no BroBot section — beside the mount where it is drawn', async () => {
    const m = await rail([REVIEWER, DEVELOPER])
    expect(sectionsDrawn(m)).toEqual(['rail-section-agents'])
    expect(m.all('rail-section-brobot')).toHaveLength(0)
    expect(heading(m, 'agents')).toBe('Other agents')
    expect(said(m.q('rail-count-agents'))).toBe('2')
    unmountAll()

    const withBroBot = await rail([REVIEWER, DEVELOPER, BRO_OLD])
    expect(sectionsDrawn(withBroBot)).toEqual(['rail-section-brobot', 'rail-section-agents'])
    expect(heading(withBroBot, 'brobot')).toBe('BroBot')
    expect(rowsIn(withBroBot, 'brobot')).toEqual(['sess_bro_old'])
  })
})

/* ------------------------------------------------------------------ 5 · remembered */

describe('the fold is remembered per viewer', () => {
  it('a remount keeps a folded section folded, and a fresh viewer sees both open', async () => {
    expect(globalThis.localStorage, 'the rail would write to the shared store').toBe(storage)
    const first = await rail(ALL_LISTED)
    expect(storage.getItem('brobot2.railBroBotOpen')).toBeNull()

    await press(first.q('rail-toggle-brobot'))
    // ⚑ Written where a per-viewer toggle is written, under BroBot's own key and no other.
    expect(storage.getItem('brobot2.railBroBotOpen')).toBe('false')
    expect(storage.getItem('brobot2.railOtherAgentsOpen')).toBeNull()
    unmountAll()

    // The same viewer, a new mount: still folded, still counted; the other section still open.
    const again = await rail(ALL_LISTED)
    expect(again.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('false')
    expect(again.all('open-session-sess_bro_new')).toHaveLength(0)
    expect(said(again.q('rail-count-brobot'))).toBe('3')
    expect(again.q('rail-toggle-agents').getAttribute('aria-expanded')).toBe('true')
    expect(rowsIn(again, 'agents')).toEqual(['sess_rev', 'sess_dev'])
    unmountAll()

    // ⚑ The pair: a viewer with nothing remembered sees BroBot's rows.
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const fresh = await rail(ALL_LISTED)
    expect(fresh.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('true')
    expect(rowsIn(fresh, 'brobot')).toEqual(['sess_bro_new', 'sess_bro_typed', 'sess_bro_old'])
  })
})

describe('the fold is remembered per section', () => {
  it('the other agents’ section keeps its own fold, under its own key — BroBot’s stays open', async () => {
    const first = await rail(ALL_LISTED)
    await press(first.q('rail-toggle-agents'))
    expect(storage.getItem('brobot2.railOtherAgentsOpen')).toBe('false')
    expect(storage.getItem('brobot2.railBroBotOpen')).toBeNull()
    unmountAll()

    // The same viewer, a new mount: the agents' fold is back, BroBot's section still open.
    const again = await rail(ALL_LISTED)
    expect(again.q('rail-toggle-agents').getAttribute('aria-expanded')).toBe('false')
    expect(again.all('open-session-sess_rev')).toHaveLength(0)
    expect(said(again.q('rail-count-agents'))).toBe('2')
    expect(again.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('true')
    expect(rowsIn(again, 'brobot')).toEqual(['sess_bro_new', 'sess_bro_typed', 'sess_bro_old'])
  })
})

describe('BroBot’s section is named as BroBot is named', () => {
  it('a roster that names BroBot *Jarvis* heads its section *Jarvis* — the same rail with no roster says *BroBot*', async () => {
    const named = await rail(ALL_LISTED, {
      agents: {
        identities: [{ id: 'aid:brobot', slug: 'brobot', displayName: 'Jarvis' }],
        foldersWithoutARow: [],
      } as never,
    })
    expect(heading(named, 'brobot')).toBe('Jarvis')
    expect(heading(named, 'agents')).toBe('Other agents')
    unmountAll()
    const plain = await rail(ALL_LISTED)
    expect(heading(plain, 'brobot')).toBe('BroBot')
  })
})

/* ------------------------------------------------------------------ 6 · the press */

describe('a row is still the press that opens its conversation', () => {
  it('a row’s press selects it in either section, and a header’s press selects nothing', async () => {
    const m = await rail(ALL_LISTED, { open: HELD() })

    await press(m.q('open-session-sess_bro_new'))
    await press(m.q('open-session-sess_rev'))
    expect(m.selected).toEqual(['sess_bro_new', 'sess_rev'])

    await press(m.q('rail-toggle-agents'))
    expect(m.selected).toEqual(['sess_bro_new', 'sess_rev'])
    expect(m.q('rail-toggle-agents').getAttribute('aria-expanded')).toBe('false')
  })

  it('the palette still lists a folded section’s conversations', async () => {
    const m = await rail(ALL_LISTED)
    await press(m.q('rail-toggle-brobot'))
    expect(m.all('open-session-sess_bro_new')).toHaveLength(0)

    await press(m.q('command-palette'))
    const row = inPalette('palette-row-open-sess_bro_new')
    expect(row, 'the folded conversation left the palette').not.toBeNull()
    expect(said(row!)).toContain('claude · idle')
  })
})
