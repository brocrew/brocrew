import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import {
  useWhoCalledWhom,
  type RailSays,
} from '../../src/renderer/src/composables/useWhoCalledWhom'
import { facetsOfState } from '../../src/renderer/src/lib/agent-state'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { agentStateWords, type AgentState } from '../../src/shared/agent-state'
import { clockTime } from '../../src/shared/clock'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type {
  ResumableSessionInfo,
  TranscriptEvent,
  UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { META, drawerProps, mount, permission, unmountAll, type Mounted } from './harness'

/**
 * # 🔴 UI-001 · the rail row is what EVERY plate under the strip draws
 *
 * ⚑ **The seat's test** (`the-card-says-what-the-rail-says.dom.test.ts`) reads the chip's plate and
 * the kid's WORD with the rail set by hand. What it does not read, and what this file does:
 *
 *  The cases cover every chip’s plate, faceless when the rail has no row; removal of the open
 *  agent’s nested sub-agent card; `SideRail`’s real `says` keys, plates, and words rather
 *  than hand-set `cast.railSays`; and the screen mirroring that channel and returning it on
 *  unmount. Because no test tree mounts `RuntimeScreen`, check those two screen hops with a
 *  source census that asserts the slice before its text.
 *
 * ⚠️ Every negative has a positive from the same reader beside it: each drawer test has a control
 * mount that differs in the rail only, the rail test compares each key with the row it names, and
 * each source slice is asserted present (and proven to hold its neighbour) before its order or its
 * absences are read.
 */

afterEach(() => {
  unmountAll()
  // ⛔ **The channel is a window-level singleton**, so a row left behind would be the next test's
  // premise.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
  cast.forest.value = null
  cast.railSays.value = null
  delete stubbed().api
})

const NOW = Date.now()
/** ⚑ Ana's job, three minutes out — the 21:07 / 21:10 of the finding. */
const DUE = NOW + 3 * 60_000

/* ------------------------------------------------------------------ the drawer's fixtures */

const spawn = (conversation: string, over: Partial<SpawnEdge> = {}): SpawnEdge => ({
  conversation,
  identity: 'worker',
  provider: 'claude',
  running: 'unwatched',
  ...over,
})

const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
  rows,
  walk: kind,
  ledgers: rows.length,
  rowsUnread: 0,
})

/** ⚑ BroBot spawned both. Ana's process is not running; Ayo's is, parked on its question. */
const READ: WhoCalledWhom = {
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>(
    [spawn('sess_ana', { running: 'not-running' }), spawn('sess_ayo')],
    'every-conversation-this-one-spawned',
  ),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
}

/** ⚑ What the band's own reading holds of Ayo: a running process mid-turn. */
const AYO_AT_WORK: WhatIsBeingDone['conversations'][number] = {
  conversation: 'sess_ayo',
  identity: 'worker',
  told: { said: 'an-activity', phase: 'tool', detail: null },
  status: 'working',
  streaming: false,
  since: NOW - 60_000,
  context: null,
}

const AT_WORK: WhatIsBeingDone = { readAt: NOW, conversations: [AYO_AT_WORK] }

/** ⚑ A rail row as the rail draws a conversation it is not fed: the host's one state. */
const railRow = (state: AgentState): RailSays => ({
  facets: facetsOfState(state),
  word: agentStateWords(state),
})

const RAIL = new Map<string, RailSays>([
  ['sess_ana', railRow({ is: 'scheduled', dueAt: DUE })],
  ['sess_ayo', railRow({ is: 'waiting-on-an-answer', from: 'BroBot' })],
])

/** ⚑ The right panel, over the band's one channel — the strip's chips are the agents under it. */
function show(rail: ReadonlyMap<string, RailSays> | null, atWork: WhatIsBeingDone = AT_WORK) {
  const cast = useWhoCalledWhom()
  cast.reading.value = { conversation: META.sessionId, read: READ, answered: true, atWork }
  cast.railSays.value = rail
  return mount(SessionDrawer as never, drawerProps({ identities: null }), {
    width: DRAWER_W_MIN,
    height: 900,
  })
}

/** ⚑ One agent's chip on the strip. */
const kidOf = (drawer: Mounted, conversation: string): HTMLElement => {
  const chip = drawer.host.querySelector<HTMLElement>(
    `[data-cy="cast-children-strip"] .agent-chip[data-conversation="${conversation}"]`,
  )
  expect(chip, `no chip for ${conversation}`).not.toBeNull()
  return chip!
}

/** ⚑ **The chip's OWN plate**. Asserted present before it is read. */
const cardPlateOf = (chip: HTMLElement): HTMLElement => {
  const plate = chip.querySelector<HTMLElement>('[data-cy="agent-state"]')
  expect(plate, 'the chip draws no plate').not.toBeNull()
  return plate!
}

const doingOfPlate = (plate: HTMLElement): string | null => plate.getAttribute('data-doing')

const markOf = (plate: HTMLElement): string | null =>
  plate.querySelector('.work-mark')?.getAttribute('data-mark') ?? null

/* ------------------------------------------------------------------ 1 · the chip's plate */

describe('every chip draws the plate its rail row draws', () => {
  it("🔴 a chip's plate is the rail row's · Ayo's is idle, Ana's carries the scheduled clock", () => {
    const graph = show(RAIL)

    const ayo = cardPlateOf(kidOf(graph, 'sess_ayo'))
    // ⛔ **Not the running process's face** — the band's reading says Ayo is using a tool.
    expect(doingOfPlate(ayo)).toBe('idle')
    // ⚑ The rail says he waits on BroBot's answer, so his plate wears the hourglass of a wait on
    // another agent.
    expect(markOf(ayo)).toBe('waiting')

    const ana = cardPlateOf(kidOf(graph, 'sess_ana'))
    expect(markOf(ana)).toBe('scheduled')
    expect(doingOfPlate(ana)).toBe('idle')
  })

  it("⛔ THE CONTROL — with no rail, a chip's plate is the band's own reading", () => {
    const graph = show(null)

    // The two mounts differ in the rail only, which is what makes the first one a reading of it.
    const ayo = cardPlateOf(kidOf(graph, 'sess_ayo'))
    expect(doingOfPlate(ayo)).toBe('tool')

    const ana = cardPlateOf(kidOf(graph, 'sess_ana'))
    expect(markOf(ana)).toBeNull()
  })

  it('⚑ a conversation the rail does not name yet draws a faceless chip, never the band’s working', () => {
    const graph = show(new Map([['sess_ana', RAIL.get('sess_ana')!]]))

    const card = kidOf(graph, 'sess_ayo')
    expect(doingOfPlate(cardPlateOf(card))).toBe('unknown')

    // ⚑ The named one still draws her row: the rail's answer is per conversation, so the faceless
    // card is not a blanket.
    expect(markOf(cardPlateOf(kidOf(graph, 'sess_ana')))).toBe('scheduled')
  })
})

/* ------------------------------------------------------------------ 2 · its own sub-agents */

/*
 * The right panel has only the current agent’s card. The graph draws immediate children from
 * the rail rows; further descendants appear on their parent’s graph.
 */

/* ------------------------------------------------------------------ 3 · what the rail says */

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

/** A host row in a given state, with its own `updatedAt`, so no two rows tie. */
const hostRow = (
  sessionId: string,
  state: AgentState,
  updatedAt: number,
): ResumableSessionInfo => ({
  ...resumableBase,
  running: 'not-running',
  sessionId,
  ref: { provider: 'claude', sessionId: `thread-${sessionId}`, cwd: CWD, rotation: 0 },
  resumeRefusal: null,
  state,
  updatedAt,
})

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

/** A conversation this window holds — its row is drawn from its record, and what it has heard. */
const heldRecord = (sessionId: string, cwd: string, events: TranscriptEvent[] = []): unknown => {
  const record = createSessionRecord(sessionId)
  for (const event of events) applyEvent(record.transcript, event, NOW)
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

/** The rail over a stubbed pair of host lists; the row count makes a fetch that never landed loud. */
async function rail(rows: {
  resumable: ResumableSessionInfo[]
  unresumable?: UnresumableSessionInfo[]
  open: unknown[]
}): Promise<Mounted> {
  stubbed().api = {
    runtime: {
      listResumable: () => Promise.resolve(rows.resumable),
      listUnresumable: () => Promise.resolve(rows.unresumable ?? []),
    },
  }
  const m = mount(
    SideRail,
    { open: rows.open, activeId: null, place: null },
    { width: 251.68, height: 900 },
  )
  await settle()
  expect(
    m.host.querySelectorAll('[data-cy^="open-session-"]'),
    'the stubbed fetch never reached the rail',
  ).toHaveLength(rows.open.length + rows.resumable.length)
  return m
}

/** The session ids of the drawn rows, top to bottom. */
const drawnOrder = (m: Mounted): string[] =>
  [...m.host.querySelectorAll<HTMLElement>('[data-cy^="open-session-"]')].map(
    (row) => row.getAttribute('data-session-id') ?? '',
  )

/** One row's status line — the `<small>` that carries the standing. */
const standingOf = (m: Mounted, sessionId: string): HTMLElement => {
  const line = m.q(`open-session-${sessionId}`).querySelector<HTMLElement>('small[data-standing]')
  expect(line, `open-session-${sessionId} has no status line`).not.toBeNull()
  return line!
}

/** A text with its runs of whitespace folded, so a template's line breaks do not decide an answer. */
const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const saysOf = (m: Mounted): ReadonlyMap<string, RailSays> =>
  m.vm.says as ReadonlyMap<string, RailSays>

describe('the rail names each conversation it draws, with what the row itself draws', () => {
  const SCHEDULED: AgentState = { is: 'scheduled', dueAt: DUE }
  const WAITING: AgentState = { is: 'waiting-on-an-answer', from: 'BroBot' }
  const ACTIVE: AgentState = { is: 'active' }

  const rows = (scheduled: AgentState = SCHEDULED): ResumableSessionInfo[] => [
    hostRow('sess_sched', scheduled, NOW - 60_000),
    hostRow('sess_wait', WAITING, NOW - 120_000),
    hostRow('sess_active', ACTIVE, NOW - 180_000),
  ]

  it('⚑ the rail names each conversation it draws, with the plate and the word the row itself draws', async () => {
    const m = await rail({
      resumable: rows(),
      unresumable: [USER_HOME],
      open: [heldRecord('sess_held', CWD)],
    })
    const says = saysOf(m)
    const drawn = drawnOrder(m)

    // The key set is the drawn rows, one per conversation — and never the one the fold dropped.
    expect([...drawn].sort()).toEqual(['sess_active', 'sess_held', 'sess_sched', 'sess_wait'])
    expect([...says.keys()].sort()).toEqual([...drawn].sort())
    expect(says.has('sess_userhome')).toBe(false)

    // A host row says the host's one state in the host's own words — with the clock, and whose
    // answer it waits on — and not the coarse standing word.
    const byState: [string, AgentState][] = [
      ['sess_sched', SCHEDULED],
      ['sess_wait', WAITING],
      ['sess_active', ACTIVE],
    ]
    for (const [id, state] of byState) {
      expect(says.get(id), `${id}: what the rail says`).toEqual({
        facets: facetsOfState(state),
        word: agentStateWords(state),
      })
    }
    expect(says.get('sess_sched')?.word).toBe(`scheduled · ${clockTime(DUE)}`)
    // ⚑ **D-016 · commit 7 · R3** — whose answer, in the words *waiting on an answer from <name>*.
    expect(says.get('sess_wait')?.word).toBe('waiting on an answer from BroBot')
    expect(says.get('sess_active')?.word).toBe('active')

    // The card and its row cannot say two things: for EVERY drawn row, the held one included, what
    // the rail says is what the row's small line and its plate draw.
    for (const id of drawn) {
      const one = says.get(id)
      expect(one, `${id}: the rail says nothing of a row it draws`).toBeDefined()
      expect(said(standingOf(m, id)), `${id}: the row's words`).toContain(`· ${one!.word}`)
      const plate = m.q(`open-session-${id}`).querySelector('[data-cy="agent-state"]')
      expect(plate, `${id}: the row draws no plate`).not.toBeNull()
      expect(plate!.getAttribute('data-doing'), `${id}: the row's plate`).toBe(
        one!.facets.doing ?? 'unknown',
      )
    }
  })

  it('🔴 UI-004 · a running turn says the one state’s *active*, held here or pushed by the host — an idle one still *idle*, a permission still what it waits on', async () => {
    const m = await rail({
      resumable: [hostRow('sess_pushed', ACTIVE, NOW - 60_000)],
      open: [
        heldRecord('sess_running', CWD, [
          { type: 'status', state: 'working' } as unknown as TranscriptEvent,
        ]),
        heldRecord('sess_resting', CWD),
        heldRecord('sess_asking', CWD, [permission('p1')]),
      ],
    })
    const says = saysOf(m)
    // ⚑ The premise: the held one really is mid-turn, and drawn from its record.
    expect(says.get('sess_running')?.facets.doing).toBe('working')
    // 🔴 One word for one fact, whichever side of the window the state came from.
    expect(says.get('sess_running')?.word).toBe(agentStateWords({ is: 'active' }))
    expect(says.get('sess_pushed')?.word).toBe(agentStateWords({ is: 'active' }))
    expect(said(standingOf(m, 'sess_running'))).toContain('· active')
    // ⛔ The pairs on the same mount: a resting turn and an open permission keep their own words —
    // the permission's the one state's *needs you* since UI-008 (F051).
    expect(says.get('sess_resting')?.word).toBe('idle')
    expect(says.get('sess_asking')?.word).toBe('needs you: permission')
  })

  it('⚑ the exposed says follows the list when it is re-read', async () => {
    const m = await rail({ resumable: rows(), open: [] })
    expect(saysOf(m).get('sess_sched')?.facets.doing).toBe('idle')
    expect(saysOf(m).get('sess_sched')?.word).toBe(`scheduled · ${clockTime(DUE)}`)

    // The job has run: the host's next answer is `active`.
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve(rows(ACTIVE)),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    await (m.vm.refreshResumable as () => Promise<void>)()
    await nextTick()
    expect(saysOf(m).get('sess_sched')?.facets.doing).toBe('working')
    expect(saysOf(m).get('sess_sched')?.word).toBe('active')
    // ⚑ The other rows did not move.
    expect(saysOf(m).get('sess_wait')?.word).toBe('waiting on an answer from BroBot')
  })
})

/* ------------------------------------------------------------------ 4 · the screen's two hops */

/**
 * ⚠️ **A source census, and it has to be one** — nothing in either test tree mounts `RuntimeScreen`
 * (it is the whole window). Each test asserts its slice is the right one before it asserts what
 * the slice does, holds or does not hold.
 */
const runtimeScreen = async (): Promise<string> =>
  (
    (await import('../../src/renderer/src/components/RuntimeScreen.vue?raw')) as {
      default: string
    }
  ).default

/** How many times `needle` occurs in `text`. */
const countOf = (text: string, needle: string): number => text.split(needle).length - 1

/**
 * The `watchEffect(() => { … })` that holds `expression`: from the nearest opening before it to the
 * first close after it. The expression must be present, and once.
 */
function watchEffectHolding(screen: string, expression: string): string {
  const at = screen.indexOf(expression)
  expect(at, `RuntimeScreen no longer holds ${expression}`).toBeGreaterThan(-1)
  expect(countOf(screen, expression), `${expression} is written more than once`).toBe(1)
  const from = screen.lastIndexOf('watchEffect(() => {', at)
  expect(from, `${expression} is not inside a watchEffect`).toBeGreaterThan(-1)
  const close = screen.indexOf('})', at)
  expect(close, `${expression}'s watchEffect never closes`).toBeGreaterThan(at)
  return screen.slice(from, close + 2).trim()
}

describe('the screen wires the rail’s rows to the band’s channel', () => {
  it('🔴 the screen mirrors the rail’s says into the band’s channel, once, in a watchEffect', async () => {
    const screen = await runtimeScreen()

    const says = watchEffectHolding(screen, 'cast.railSays.value = rail.value?.says ?? null')
    expect(says).toMatch(
      /^watchEffect\(\(\) => \{\s*cast\.railSays\.value = rail\.value\?\.says \?\? null\s*\}\)$/,
    )
    // Two writers, and no third one that re-derives it: this one and the reset on unmount.
    expect(countOf(screen, 'cast.railSays.value =')).toBe(2)
  })

  it('⛔ the screen hands the rail’s rows back on unmount, beside the press it also hands back', async () => {
    const screen = await runtimeScreen()

    const goTo = screen.indexOf('cast.goTo.value = null')
    expect(goTo, 'RuntimeScreen no longer hands the press back').toBeGreaterThan(-1)
    expect(countOf(screen, 'cast.goTo.value = null')).toBe(1)
    const from = screen.lastIndexOf('onUnmounted(', goTo)
    expect(from, 'the press is not handed back in an onUnmounted').toBeGreaterThan(-1)
    const to = screen.indexOf('persons.forget()', goTo)
    expect(to, 'the unmount no longer ends in persons.forget()').toBeGreaterThan(goTo)
    const slice = screen.slice(from, to)

    // The right handler: the one that also stops the glance (the band's own interval went with
    // W4.74 — D-033 pushes every move of its work) and hands back the press.
    expect(slice).toContain('clearInterval(glancing)')
    expect(slice).toContain('cast.goTo.value = null')

    // …and it hands the rows back, after the press, as a plain null.
    const reset = slice.indexOf('cast.railSays.value = null')
    expect(reset, 'the unmount does not hand the rail’s rows back').toBeGreaterThan(-1)
    expect(reset).toBeGreaterThan(slice.indexOf('cast.goTo.value = null'))
    // ⛔ Not a re-read of the dead ref.
    expect(slice).not.toContain('rail.value')
  })
})
