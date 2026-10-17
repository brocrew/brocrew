import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { AgentState } from '../../src/shared/agent-state'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * **D-017b · the ONE list says what the host says, newest first** — the rail's list as a person
 * reads it, and the two places the screen wires it to the conversation on screen.
 *
 * The rail draws one conversation list, using records for this window’s held conversations
 * and host rows for the rest. `closed-rail.dom.test.ts` checks row structure, and
 * `rail-identity.dom.test.ts` checks the held row’s opening line. This file checks what the
 * list does with the host rows:
 *
 *  1. **the order** — newest activity first, by the HOST's row, with a conversation the host has not
 *     listed yet (a launch whose row is being written) first;
 *  2. **the words** — a row the host lists says the one state in the host's words, detail and all,
 *     and the waiting badge counts the rows that say a person is owed;
 *  3. **the opening line** — the recorded conversation on screen says how it was opened, and no
 *     other row borrows it;
 *  4. **a failed later read** keeps the rows an earlier read drew, and says why;
 *  5. **the palette in the rail** is told whether the list has answered and what its failure said,
 *     and a conversation only the host lists is one of its rows;
 *  6. **what the rail exposes** to the screen (`listedIds`, `listedOf`);
 *  7. **the screen's two hops** — it looks again at a recorded conversation whose row moved, and it
 *     hands the rail the record it is drawing — as a source census, because nothing in either test
 *     tree mounts `RuntimeScreen`.
 *
 * A real engine, because the order of the drawn rows and the teleported palette are both about the
 * DOM. Every negative below has a positive from the same reader beside it: the shared `rail()`
 * helper counts the rows it drew, so a fetch that never landed is loud instead of silent, and each
 * source census asserts the slice is the right one before it asserts what the slice does not hold.
 */

/* ------------------------------------------------------------------ fixtures */

const NOW = Date.now()

const CWD = '/Users/alex/dev/brobot-2'

const resumableBase = {
  provider: 'claude' as const,
  cwd: CWD,
  status: 'idle' as const,
  state: { is: 'idle' as const },
  // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so a row is titled by its agent, as it was.
  named: null,
  approvalMode: 'ask' as const,
  profileId: DEFAULT_PROFILE_ID,
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  lastEnding: 'completed' as const,
  updatedAt: NOW - 240_000,
}

/** An ordinary conversation nothing runs: the host lists it, idle. */
const OPENABLE: ResumableSessionInfo = {
  ...resumableBase,
  running: 'not-running',
  sessionId: 'sess_openable',
  ref: { provider: 'claude', sessionId: 'thread-1', cwd: CWD, rotation: 0 },
  resumeRefusal: null,
}

/** A second host row, in a folder of its own, so the two are told apart on screen. */
const READABLE: ResumableSessionInfo = {
  ...resumableBase,
  running: 'not-running',
  sessionId: 'sess_child',
  cwd: '/Users/alex/dev/acme/billing-api',
  ref: {
    provider: 'claude',
    sessionId: 'thread-2',
    cwd: '/Users/alex/dev/acme/billing-api',
    rotation: 0,
  },
  profileId: 'reviewer',
  child: { parentSessionId: 'thread-1', depth: 1, nickname: 'Turing', role: null },
  resumeRefusal: 'a sub-agent conversation — another agent drove it',
}

/** A personal Claude conversation found in its provider home stays off the app list. */
const USER_HOME: UnresumableSessionInfo = {
  sessionId: 'sess_userhome',
  provider: 'claude',
  cwd: '/Users/alex/dev/other/thing',
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  named: null,
  profileId: null,
  adoptedAt: NOW - 172_800_000,
  updatedAt: NOW - 7_200_000,
  hasTranscript: true,
  lastEnding: 'completed',
  foundInUserHome: true,
  restoredFromBundle: false,
  reason: "one of your own Claude conversations, found in Claude's own folder",
}

/**
 * A host row in a given state.
 *
 * Every row a test draws has its own `updatedAt`, so no two rows tie and every order asserted below
 * is the order the times give.
 */
const hostRow = (
  sessionId: string,
  state: AgentState,
  over: Partial<ResumableSessionInfo> = {},
): ResumableSessionInfo => ({ ...OPENABLE, sessionId, state, ...over })

/** A conversation this window holds — its row is drawn from its record. */
const heldRecord = (sessionId: string, cwd: string): unknown => {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd,
    profileId: DEFAULT_PROFILE_ID,
    ref: { provider: 'claude', sessionId: 'live', cwd, rotation: 0 },
    approvalMode: 'ask',
    planNeedsGoAhead: false,
    liveness: { state: 'live', since: NOW },
  } as never
  return record
}

/* ------------------------------------------------------------------ mounting */

type RailApi = {
  runtime: {
    listResumable: () => Promise<ResumableSessionInfo[]>
    listUnresumable: () => Promise<UnresumableSessionInfo[]>
  }
}

const stubbed = (): { api?: RailApi } => window as unknown as { api?: RailApi }

/** A macrotask and a tick: the fetch is a `Promise.all` inside a `try`, whose hops are not this file's. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

/**
 * The rail over a stubbed pair of host lists, with every press it raises collected.
 *
 * The row-count assertion at the end is what makes a fetch that never landed loud: one row per
 * conversation this window holds, plus one per listed row it does not (a host row this window also
 * holds is drawn once, from its record), and none for a row found in a person's own folder.
 */
async function rail(
  rows: { resumable?: ResumableSessionInfo[]; unresumable?: UnresumableSessionInfo[] } = {},
  props: Record<string, unknown> = {},
): Promise<Mounted & { selected: string[] }> {
  const selected: string[] = []
  stubbed().api = {
    runtime: {
      listResumable: () => Promise.resolve(rows.resumable ?? []),
      listUnresumable: () => Promise.resolve(rows.unresumable ?? []),
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
  const held = new Set(
    ((props.open as { sessionId: string }[] | undefined) ?? []).map((r) => r.sessionId),
  )
  const expected =
    held.size +
    [...(rows.resumable ?? []), ...(rows.unresumable ?? [])].filter(
      (session) =>
        !held.has(session.sessionId) &&
        !('foundInUserHome' in session && session.foundInUserHome) &&
        !('restoredFromBundle' in session && session.restoredFromBundle),
    ).length
  expect(
    m.host.querySelectorAll('[data-cy^="open-session-"]'),
    'the stubbed fetch never reached the rail',
  ).toHaveLength(expected)
  return Object.assign(m, { selected })
}

/** The session ids of the drawn rows, top to bottom. */
const drawnOrder = (m: Mounted): (string | null)[] =>
  [...m.host.querySelectorAll<HTMLElement>('[data-cy^="open-session-"]')].map((row) =>
    row.getAttribute('data-session-id'),
  )

/** One row's status line — the `<small>` that carries the standing. */
const standingOf = (m: Mounted, sessionId: string): HTMLElement => {
  const line = m.q(`open-session-${sessionId}`).querySelector<HTMLElement>('small[data-standing]')
  expect(line, `open-session-${sessionId} has no status line`).not.toBeNull()
  return line!
}

/** A text with its runs of whitespace folded, so a template's line breaks do not decide an answer. */
const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** The palette is TELEPORTED to `body`, so a query scoped to the rail's own box finds nothing. */
const inPalette = (cy: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-cy="${cy}"]`)

const openPalette = async (m: Mounted): Promise<void> => {
  m.q('command-palette').click()
  await nextTick()
}

/** The sentence under the palette's rows, read once the palette is open. */
const palettesFoot = (): string => {
  const foot = inPalette('palette-searched')
  expect(foot, 'the palette drew no foot').not.toBeNull()
  return said(foot!)
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

/* ------------------------------------------------------------------ 1 · the order */

describe('the rail draws its one list newest activity first, by the host’s row', () => {
  it('the rail draws the newest activity first, by the row the host keeps — a held record the host lists goes where the host puts it', async () => {
    // ⚠️ The host's rows arrive scrambled, and the held record's OWN liveness (`NOW`) is newer than
    // any of them: only the host row's `updatedAt` puts it last.
    const m = await rail(
      {
        resumable: [
          hostRow('sess_mid', { is: 'idle' }, { updatedAt: NOW - 3_600_000 }),
          hostRow('sess_held_old', { is: 'idle' }, { updatedAt: NOW - 10_800_000 }),
          hostRow('sess_new', { is: 'idle' }, { updatedAt: NOW - 60_000 }),
        ],
      },
      { open: [heldRecord('sess_held_old', CWD)] },
    )

    // The positive that makes the order mean something: all three are on screen, and the held one
    // is drawn from its record (it carries no host-only state word of its own).
    for (const id of ['sess_new', 'sess_mid', 'sess_held_old']) {
      expect(visible(m.q(`open-session-${id}`))).toBe(true)
    }
    expect(drawnOrder(m)).toEqual(['sess_new', 'sess_mid', 'sess_held_old'])
    expect(m.vm.listedIds).toEqual(['sess_new', 'sess_mid', 'sess_held_old'])
  })

  it('a conversation this window holds that the host has not listed yet goes first, and the same one listed goes by its row', async () => {
    const open = [heldRecord('sess_launching', CWD)]
    const others = [
      hostRow('sess_mid', { is: 'idle' }, { updatedAt: NOW - 3_600_000 }),
      hostRow('sess_new', { is: 'idle' }, { updatedAt: NOW - 60_000 }),
    ]

    // A · nothing the host lists names it: a launch whose row is being written.
    const before = await rail({ resumable: others }, { open })
    expect(drawnOrder(before)).toEqual(['sess_launching', 'sess_new', 'sess_mid'])
    unmountAll()

    // B · the moment the host lists it, it falls to its own place. The two mounts are each other's
    // control: the order changes with the one fact that differs.
    const after = await rail(
      {
        resumable: [
          ...others,
          hostRow('sess_launching', { is: 'idle' }, { updatedAt: NOW - 10_800_000 }),
        ],
      },
      { open },
    )
    expect(drawnOrder(after)).toEqual(['sess_new', 'sess_mid', 'sess_launching'])
  })
})

/* ------------------------------------------------------------------ 2 · the words */

describe('a row the host lists says the host’s state', () => {
  const stateRows = (): ResumableSessionInfo[] => [
    hostRow('sess_needs', { is: 'needs-you' }, { updatedAt: NOW - 60_000 }),
    hostRow(
      'sess_answer',
      { is: 'waiting-on-an-answer', from: 'Ada' },
      { updatedAt: NOW - 120_000 },
    ),
    hostRow(
      'sess_bg',
      { is: 'in-the-background', what: 'npm run build' },
      { updatedAt: NOW - 180_000 },
    ),
    hostRow('sess_sched', { is: 'scheduled', dueAt: null }, { updatedAt: NOW - 240_000 }),
    hostRow('sess_active', { is: 'active' }, { updatedAt: NOW - 300_000 }),
    hostRow('sess_idle', { is: 'idle' }, { updatedAt: NOW - 360_000 }),
  ]

  it('a row the host lists says its state in the words the host gives, and the waiting badge counts the ones waiting on a person', async () => {
    // A · one row per arm of the one state.
    const all = await rail({ resumable: stateRows() })
    const expected: [string, string, string][] = [
      ['sess_needs', 'waiting', 'claude · needs you'],
      ['sess_answer', 'elsewhere', 'claude · waiting on an answer from Ada'],
      ['sess_bg', 'background', 'claude · running in the background · npm run build'],
      ['sess_sched', 'scheduled', 'claude · scheduled'],
      ['sess_active', 'working', 'claude · active'],
      ['sess_idle', 'idle', 'claude · idle'],
    ]
    for (const [id, standing, words] of expected) {
      const line = standingOf(all, id)
      expect(line.getAttribute('data-standing'), `${id}: the coarse word`).toBe(standing)
      expect(said(line), `${id}: the words`).toContain(words)
    }
    // The host row that needs a person counts; the row that waits on an agent's answer does not.
    // ⚑ Every row is BroBot's, so the badge and the count are BroBot's section's.
    const badge = all.q('rail-needs-you-brobot')
    expect(visible(badge)).toBe(true)
    expect(said(badge)).toBe('1')
    expect(badge.getAttribute('title')).toBe('needs you: 1')
    expect(said(all.q('rail-count-brobot'))).toBe('6')
    unmountAll()

    // B · the same rail without the row that needs a person: the badge is gone, the rest is drawn.
    const without = await rail({
      resumable: stateRows().filter((row) => row.sessionId !== 'sess_needs'),
    })
    expect(said(without.q('rail-count-brobot'))).toBe('5')
    expect(standingOf(without, 'sess_answer').getAttribute('data-standing')).toBe('elsewhere')
    expect(without.all('rail-needs-you-brobot')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ 3 · the opening line */

describe('the conversation on screen says how it was opened when the host lists it', () => {
  it('the conversation on screen says how it was opened when the host lists it, and no other row does', async () => {
    // A recorded record the screen is drawing: NOT in `open`, so its row is the host's.
    const onScreen = heldRecord('sess_openable', CWD) as { opening: string | null }
    onScreen.opening = 'Fix the failing build'

    const drawing = await rail(
      { resumable: [OPENABLE, READABLE] },
      { activeId: 'sess_openable', onScreen },
    )
    const line = drawing.q('session-opening-sess_openable')
    expect(visible(line)).toBe(true)
    expect(said(line)).toBe('Fix the failing build')
    // The other host row is on screen too, and does not borrow the line.
    expect(visible(drawing.q('open-session-sess_child'))).toBe(true)
    expect(drawing.all('session-opening-sess_child')).toHaveLength(0)
    unmountAll()

    // B · the same rows with nothing on screen: the line comes from the on-screen record, not from
    // the host's row.
    const nothing = await rail({ resumable: [OPENABLE, READABLE] }, { onScreen: null })
    expect(visible(nothing.q('open-session-sess_openable'))).toBe(true)
    expect(nothing.all('session-opening-sess_openable')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ 4 · a failed later read */

describe('a read of the list that fails after one that succeeded', () => {
  it('a later read that fails keeps the rows and says why, and the next one that succeeds takes the line away', async () => {
    const m = await rail({ resumable: [OPENABLE] })
    expect(visible(m.q('open-session-sess_openable'))).toBe(true)
    expect(said(m.q('rail-count-brobot'))).toBe('1')
    expect(m.all('conversations-error')).toHaveLength(0)

    const refresh = m.vm.refreshResumable as () => Promise<void>

    // The database is locked for one announcement.
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.reject(new Error('the database is locked')),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    await refresh()
    await nextTick()
    const error = m.q('conversations-error')
    expect(visible(error)).toBe(true)
    expect(said(error)).toContain('the database is locked')
    // …and the row the earlier read drew is still there, still counted.
    expect(visible(m.q('open-session-sess_openable'))).toBe(true)
    expect(said(m.q('rail-count-brobot'))).toBe('1')

    // The next announcement is read: the line goes, and the list is the new list.
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve([OPENABLE, READABLE]),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    await refresh()
    await nextTick()
    expect(m.all('conversations-error')).toHaveLength(0)
    expect(drawnOrder(m)).toHaveLength(2)
    expect(visible(m.q('open-session-sess_child'))).toBe(true)
    // ⚑ The new row is the reviewer's, so it is counted in the other agents' section.
    expect(said(m.q('rail-count-brobot'))).toBe('1')
    expect(said(m.q('rail-count-agents'))).toBe('1')
  })
})

/* ------------------------------------------------------------------ 5 · the palette in the rail */

describe('the palette the rail hosts', () => {
  it('the palette in the rail is told whether the list has answered and what its failure said', async () => {
    const notAnswered = 'has not answered yet'
    const couldNotRead = 'could not be read'

    // (a) a read that never settles.
    stubbed().api = {
      runtime: {
        listResumable: () => new Promise<ResumableSessionInfo[]>(() => undefined),
        listUnresumable: () => new Promise<UnresumableSessionInfo[]>(() => undefined),
      },
    }
    const waiting = mount(SideRail, { open: [], activeId: null, place: null }, { width: 251.68 })
    await settle()
    await openPalette(waiting)
    const whileWaiting = palettesFoot()
    expect(whileWaiting).toContain('Searched 0 conversations and')
    expect(whileWaiting).toContain(notAnswered)
    expect(whileWaiting).not.toContain(couldNotRead)
    unmountAll()

    // (b) a read that fails.
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.reject(new Error('the database is locked')),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    const failing = mount(SideRail, { open: [], activeId: null, place: null }, { width: 251.68 })
    await settle()
    expect(said(failing.q('conversations-error'))).toContain('the database is locked')
    await openPalette(failing)
    const afterFailure = palettesFoot()
    expect(afterFailure).toContain(couldNotRead)
    expect(afterFailure).not.toContain(notAnswered)
    unmountAll()

    // (c) a read that answered: the control for both.
    const answered = await rail({ resumable: [OPENABLE] })
    await openPalette(answered)
    const whenAnswered = palettesFoot()
    expect(whenAnswered).toContain('Searched 1 conversation and')
    expect(whenAnswered).not.toContain(notAnswered)
    expect(whenAnswered).not.toContain(couldNotRead)
  })

  it('a conversation only the host lists is a row of the palette, and its press is the rail one select', async () => {
    const m = await rail({ resumable: [OPENABLE], unresumable: [USER_HOME] })
    await openPalette(m)

    const paletteRow = inPalette('palette-row-open-sess_openable')
    expect(paletteRow, 'the host-only row is not in the palette').not.toBeNull()
    expect(visible(paletteRow!)).toBe(true)
    expect(said(paletteRow!.querySelector('small')!)).toContain('claude · idle')
    // The row found in a person's own folder is on neither the rail nor the palette.
    expect(inPalette('palette-row-open-sess_userhome')).toBeNull()
    expect(m.all('open-session-sess_userhome')).toHaveLength(0)

    // Its press is the rail's own `select`, with the conversation's id.
    expect(m.selected).toEqual([])
    paletteRow!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(m.selected).toEqual(['sess_openable'])
  })
})

/* ------------------------------------------------------------------ 6 · what the rail exposes */

describe('what the rail exposes to the screen', () => {
  it('the rail names every conversation it lists and gives the host row for exactly those', async () => {
    const inAWindow = hostRow(
      'sess_in_window',
      { is: 'idle' },
      { running: 'in-a-window', updatedAt: NOW - 30_000 },
    )
    const m = await rail(
      { resumable: [OPENABLE, inAWindow], unresumable: [USER_HOME] },
      { open: [heldRecord('sess_held_unlisted', CWD)] },
    )
    const listedOf = m.vm.listedOf as (sessionId: string) => Record<string, unknown> | null

    // Every drawn row is named, in the order they are drawn, and the launch the host has not listed
    // is first.
    const order = drawnOrder(m)
    expect(order).toEqual(['sess_held_unlisted', 'sess_in_window', 'sess_openable'])
    expect(m.vm.listedIds).toEqual(order)
    expect(m.vm.listedIds).not.toContain('sess_userhome')

    // The host's row, for the ones the host lists.
    expect(listedOf('sess_openable')).toMatchObject({
      sessionId: 'sess_openable',
      state: { is: 'idle' },
      inAnotherWindow: false,
      updatedAt: OPENABLE.updatedAt,
    })
    expect(listedOf('sess_in_window')).toMatchObject({ inAnotherWindow: true })
    // …and none for one it does not: held but not listed, and dropped by the fold.
    expect(listedOf('sess_held_unlisted')).toBeNull()
    expect(listedOf('sess_userhome')).toBeNull()
  })
})

/* ------------------------------------------------------------------ 7 · the screen's two hops */

/**
 * ⚠️ **A source census, and it has to be one.** Nothing in either test tree mounts `RuntimeScreen`
 * (it is the whole window), so what it hands the rail and what it does when the list answers is
 * read off the source. Each test asserts its slice is the right one before it asserts what the
 * slice does not hold.
 */
const runtimeScreen = async (): Promise<string> =>
  (
    (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
      default: string
    }
  ).default

describe('the screen wires the list to the conversation it is drawing', () => {
  it('the screen looks again at a recorded conversation when its row moved or when the other-window fact changed', async () => {
    const screen = await runtimeScreen()
    const from = screen.indexOf('function lookAgainIfItMoved')
    const to = screen.indexOf('const listedStateOfActive')
    expect(from, 'RuntimeScreen no longer defines lookAgainIfItMoved').toBeGreaterThan(-1)
    expect(screen.indexOf('function lookAgainIfItMoved', from + 1)).toBe(-1)
    expect(to, 'RuntimeScreen no longer defines listedStateOfActive').toBeGreaterThan(from)
    const slice = screen.slice(from, to)

    // Both facts are in the one guard, so a difference in either looks again — and the look is the
    // one thing it does then.
    expect(slice).toMatch(
      /listed\.updatedAt === record\.meta\.liveness\.since &&\s+listed\.inAnotherWindow === toldItWasElsewhere\s*\) \{\s*return\s*\}\s*void store\.look\(sessionId, 'again'\)/,
    )
    // What the view was told is the held-elsewhere refusal it carries, and only a RECORDED
    // conversation is looked at.
    expect(slice).toMatch(
      /const toldItWasElsewhere = record\.meta\.cannotTakeAMessage === HELD_ELSEWHERE/,
    )
    expect(slice).toMatch(/record\?\.phase !== 'recorded'[^)]*\) return/)
    // It runs after the list answers.
    expect(screen).toContain('rail.value?.refreshResumable().then(lookAgainIfItMoved)')
    // …and a look takes nothing: no press of another kind hides in it.
    expect(slice).not.toMatch(/store\.(take|claim|resume|send|startAndSend)\b/)
  })

  it('the screen hands the rail the record it is drawing and reads its state back from the rail list', async () => {
    const screen = await runtimeScreen()
    const from = screen.indexOf('<SideRail')
    expect(from, 'RuntimeScreen no longer draws the SideRail').toBeGreaterThan(-1)
    expect(screen.indexOf('<SideRail', from + 1)).toBe(-1)
    const tag = screen.slice(from, screen.indexOf('/>', from))

    // The right tag: the live records and the rail's own handle are in it.
    expect(tag).toContain(':open="store.live.value"')
    expect(tag).toContain('ref="rail"')
    // The record on screen is handed over, so a recorded conversation keeps its opening line.
    expect(tag).toContain(':on-screen="active"')

    // The state the view's plate draws is the one the rail's list says of it.
    expect(screen).toContain(':listed-state="listedStateOfActive"')
    const start = screen.indexOf('const listedStateOfActive')
    expect(start).toBeGreaterThan(-1)
    const computed = screen.slice(start, screen.indexOf('\n)\n', start))
    expect(computed).toContain('rail.value?.listedOf(active.value.sessionId)?.state ?? null')
  })
})
