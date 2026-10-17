import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { AgentState } from '../../src/shared/agent-state'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * **D-019 · the rail draws what main pushed over the list it read** — the rail as a person reads
 * it, when main says an agent's state moved and no list is asked.
 *
 * Main now tells the window the moment a conversation's state changes (`runtime:states`, a delta of
 * the conversations that moved), and `RuntimeScreen` hands each message to the rail's `hearStates`.
 * The rail folds what it heard over its one list, so a row, the waiting badge and every surface that
 * draws the rail's list change at once. The census beside it
 * (`the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts`) reads the SOURCE of
 * that fold and of the screen's hops; nothing in either tree MOUNTED the rail and pushed a state
 * into it until this file. What a person sees, and what this pins:
 *
 *  1. **a push changes the row it names** — its word, the waiting badge, `listedOf` and
 *     `theOneList` — with no list read in between, and no other row and no order moves;
 *  2. **pushes pile up** — a later message does not forget an earlier one, and a later push for the
 *     same conversation replaces its own word;
 *  3. **a list read asked after a push gives way to its answer**, and the answer is drawn;
 *  4. **a push that arrives while a read is in flight stands over the answer it raced** — main
 *     answers `listResumable` and `listUnresumable` separately, so the push may be newer than the
 *     half it raced — until a later read is asked;
 *  5. **a read that fails** keeps what was pushed, says why, and the next read that succeeds takes
 *     both away;
 *  6. **a push for a conversation the list does not name** draws no row and no count, and one that
 *     arrives while a read is in flight is drawn the moment that read names it.
 *
 * A real engine, because the words, the badge and the order are what the DOM draws. Every negative
 * below has a positive from the same reader beside it: the shared `rail()` helper counts the rows
 * it drew, so a fetch that never landed is loud, and every "still says" is read beside a
 * "now says" from the same `standingOf`.
 */

/* ------------------------------------------------------------------ fixtures */

const NOW = Date.now()

const CWD = '/Users/alex/dev/brobot-2'

const resumableBase = {
  provider: 'claude' as const,
  cwd: CWD,
  status: 'idle' as const,
  state: { is: 'idle' as const },
  // It holds no piece, so a row is titled by its agent.
  named: null,
  approvalMode: 'ask' as const,
  // ⚑ Every row is BroBot's, so the badge and the count this file reads are BroBot's section's.
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

/** The three conversations every test starts from, newest first, each idle as the host lists it. */
const A = hostRow('sess_a', { is: 'idle' }, { updatedAt: NOW - 60_000 })
const B = hostRow('sess_b', { is: 'idle' }, { updatedAt: NOW - 120_000 })
const C = hostRow('sess_c', { is: 'idle' }, { updatedAt: NOW - 180_000 })

/** C as a later read lists it: running something in the background — a row that read really landed. */
const CBackground = hostRow(
  'sess_c',
  { is: 'in-the-background', what: 'npm run build' },
  { updatedAt: NOW - 180_000 },
)

/* ------------------------------------------------------------------ mounting */

type RailApi = {
  runtime: {
    listResumable: () => Promise<ResumableSessionInfo[]>
    listUnresumable: () => Promise<UnresumableSessionInfo[]>
  }
}

const stubbed = (): { api?: RailApi } => window as unknown as { api?: RailApi }

/** The host answers at once with these rows. */
const answering = (resumable: ResumableSessionInfo[]): RailApi => ({
  runtime: {
    listResumable: () => Promise.resolve(resumable),
    listUnresumable: () => Promise.resolve([]),
  },
})

/** A macrotask and a tick: the fetch is a `Promise.all` inside a `try`, whose hops are not this file's. */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

/**
 * The rail over a stubbed pair of host lists.
 *
 * The row-count assertion at the end is what makes a fetch that never landed loud: one row per
 * listed conversation, so a stub the rail never read fails here instead of passing every later
 * assertion vacuously.
 */
async function rail(resumable: ResumableSessionInfo[]): Promise<Mounted> {
  stubbed().api = answering(resumable)
  const m = mount(
    SideRail,
    { open: [], activeId: null, place: null, onSelect: () => undefined },
    { width: 251.68, height: 900 },
  )
  await settle()
  expect(
    m.host.querySelectorAll('[data-cy^="open-session-"]'),
    'the stubbed fetch never reached the rail',
  ).toHaveLength(resumable.length)
  return m
}

/** What main says on `runtime:states`: the conversations that moved, and only those. */
type StatesMessage = { moved: { conversation: string; state: AgentState }[] }

/** Hand the rail one `runtime:states` message, as the screen does, and let it redraw. */
const push = async (
  m: Mounted,
  ...moved: { conversation: string; state: AgentState }[]
): Promise<void> => {
  ;(m.vm.hearStates as (message: StatesMessage) => void)({ moved })
  await nextTick()
}

/** Ask the rail's list again, as the screen does, and let it redraw. */
const readAgain = async (m: Mounted): Promise<void> => {
  await (m.vm.refreshResumable as () => Promise<void>)()
  await nextTick()
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

/** One row's coarse word (`data-standing`). */
const standing = (m: Mounted, sessionId: string): string | null =>
  standingOf(m, sessionId).getAttribute('data-standing')

/** A text with its runs of whitespace folded, so a template's line breaks do not decide an answer. */
const said = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/** The state one row says through the door the screen's header and plate read it through. */
const listedState = (m: Mounted, sessionId: string): AgentState | undefined =>
  (m.vm.listedOf as (id: string) => { state: AgentState } | null)(sessionId)?.state

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

/* ------------------------------------------------------------------ 1 · a push changes its row */

describe('the rail draws what main pushed over the list it read', () => {
  it('a pushed state changes the row it names, the badge and the count-free rest of the list at once, and no other row', async () => {
    const m = await rail([A, B, C])

    // The positive from the same reader: before the push all three say idle, nothing is owed, and
    // the list is in the order the times give.
    for (const id of ['sess_a', 'sess_b', 'sess_c']) {
      expect(standing(m, id), `${id}: before the push`).toBe('idle')
    }
    expect(m.all('rail-needs-you-brobot')).toHaveLength(0)
    expect(said(m.q('rail-count-brobot'))).toBe('3')
    expect(drawnOrder(m)).toEqual(['sess_a', 'sess_b', 'sess_c'])
    expect(listedState(m, 'sess_a')).toEqual({ is: 'idle' })

    // Main says A needs a person. No list is read in between.
    await push(m, { conversation: 'sess_a', state: { is: 'needs-you' } })

    // The row it names says so, in its words.
    expect(standing(m, 'sess_a')).toBe('waiting')
    expect(said(standingOf(m, 'sess_a'))).toContain('claude · needs you')
    // No other row moved.
    expect(standing(m, 'sess_b')).toBe('idle')
    expect(said(standingOf(m, 'sess_b'))).toContain('claude · idle')
    expect(standing(m, 'sess_c')).toBe('idle')
    expect(said(standingOf(m, 'sess_c'))).toContain('claude · idle')
    // The badge counts the one row that is waiting on a person, and the count of rows does not move.
    const badge = m.q('rail-needs-you-brobot')
    expect(visible(badge)).toBe(true)
    expect(said(badge)).toBe('1')
    expect(badge.getAttribute('title')).toBe('needs you: 1')
    expect(said(m.q('rail-count-brobot'))).toBe('3')
    // A push moves a word, never an order.
    expect(drawnOrder(m)).toEqual(['sess_a', 'sess_b', 'sess_c'])

    // The door the screen's header and plate read the state through says the same word…
    expect(listedState(m, 'sess_a')).toEqual({ is: 'needs-you' })
    expect(listedState(m, 'sess_b')).toEqual({ is: 'idle' })
    // …and so does the list the Team page draws its shelf from.
    const theOneList = m.vm.theOneList as { sessionId: string; state: AgentState }[] | null
    expect(theOneList, 'the list has not answered').not.toBeNull()
    expect(theOneList!.map((row) => [row.sessionId, row.state.is])).toEqual([
      ['sess_a', 'needs-you'],
      ['sess_b', 'idle'],
      ['sess_c', 'idle'],
    ])
  })

  /* ---------------------------------------------------------------- 2 · pushes pile up */

  it('pushes from later messages pile up on one another, and a later push for the same conversation replaces its own word', async () => {
    const m = await rail([A, B, C])

    // Message 1 · A needs a person.
    await push(m, { conversation: 'sess_a', state: { is: 'needs-you' } })
    expect(standing(m, 'sess_a')).toBe('waiting')
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')

    // Message 2, a separate one · B is active. A's word is not forgotten.
    await push(m, { conversation: 'sess_b', state: { is: 'active' } })
    expect(standing(m, 'sess_b')).toBe('working')
    expect(said(standingOf(m, 'sess_b'))).toContain('claude · active')
    expect(standing(m, 'sess_a'), 'A after the second message').toBe('waiting')
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(standing(m, 'sess_c')).toBe('idle')

    // Message 3 · one message with two moves: A is active again (its own earlier word replaced), and
    // C needs a person.
    await push(
      m,
      { conversation: 'sess_a', state: { is: 'active' } },
      { conversation: 'sess_c', state: { is: 'needs-you' } },
    )
    expect(standing(m, 'sess_a'), 'A replaced by its own later push').toBe('working')
    expect(standing(m, 'sess_b'), 'B after the third message').toBe('working')
    expect(standing(m, 'sess_c')).toBe('waiting')
    // The badge went from A's one to C's one: a replacement, not a first push that stuck.
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(said(m.q('rail-count-brobot'))).toBe('3')
  })

  /* ---------------------------------------------------------------- 3 · a later read wins */

  it('a list read asked after a push gives way to its answer, and shows that it landed', async () => {
    const m = await rail([A, B, C])

    await push(
      m,
      { conversation: 'sess_a', state: { is: 'needs-you' } },
      { conversation: 'sess_b', state: { is: 'active' } },
    )
    // The positive: the pushes stood before the read was asked.
    expect(standing(m, 'sess_a')).toBe('waiting')
    expect(standing(m, 'sess_b')).toBe('working')
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(standing(m, 'sess_c')).toBe('idle')

    // A read asked afterwards: the host now says A and B idle, and C running in the background.
    stubbed().api = answering([A, B, CBackground])
    await readAgain(m)

    // The read's answer is drawn — C is the control that it really landed…
    expect(standing(m, 'sess_c')).toBe('background')
    expect(said(standingOf(m, 'sess_c'))).toContain('running in the background · npm run build')
    // …so A and B going idle is the list winning, not the list being ignored.
    expect(standing(m, 'sess_a')).toBe('idle')
    expect(said(standingOf(m, 'sess_a'))).toContain('claude · idle')
    expect(standing(m, 'sess_b')).toBe('idle')
    expect(m.all('rail-needs-you-brobot')).toHaveLength(0)
  })

  /* ---------------------------------------------------------------- 4 · a push in flight stands */

  it('a push that arrives while a list read is in flight stands over the answer it raced, until a later read is asked', async () => {
    const m = await rail([A, B, C])

    // A read whose answer is parked in the test's hand.
    let release!: (rows: ResumableSessionInfo[]) => void
    const answer = new Promise<ResumableSessionInfo[]>((resolve) => {
      release = resolve
    })
    stubbed().api = {
      runtime: { listResumable: () => answer, listUnresumable: () => Promise.resolve([]) },
    }
    const inFlight = readAgain(m)

    // While it is parked, main says A needs a person: heard during a read.
    await push(m, { conversation: 'sess_a', state: { is: 'needs-you' } })
    expect(standing(m, 'sess_a')).toBe('waiting')
    expect(standing(m, 'sess_c'), 'C while the read is parked').toBe('idle')

    // The read lands, and it says C is running in the background.
    release([A, B, CBackground])
    await inFlight

    // The racing read really landed…
    expect(standing(m, 'sess_c')).toBe('background')
    // …and the push that arrived after it was asked stands over the answer it raced.
    expect(standing(m, 'sess_a')).toBe('waiting')
    expect(said(standingOf(m, 'sess_a'))).toContain('claude · needs you')
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')

    // A read asked AFTER the push: the same push gives way, so "stands" is not a push that never
    // expires.
    stubbed().api = answering([A, B, CBackground])
    await readAgain(m)
    expect(standing(m, 'sess_a')).toBe('idle')
    expect(m.all('rail-needs-you-brobot')).toHaveLength(0)
    expect(standing(m, 'sess_c')).toBe('background')
  })

  /* ---------------------------------------------------------------- 5 · a failed read */

  it('a read that fails keeps what was pushed and says why, and the next read that succeeds takes the push and the line away', async () => {
    const m = await rail([A, B, C])

    await push(m, { conversation: 'sess_a', state: { is: 'needs-you' } })
    expect(standing(m, 'sess_a')).toBe('waiting')
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(m.all('conversations-error')).toHaveLength(0)

    // The database is locked for one read.
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.reject(new Error('the database is locked')),
        listUnresumable: () => Promise.resolve([]),
      },
    }
    await readAgain(m)
    const error = m.q('conversations-error')
    expect(visible(error)).toBe(true)
    expect(said(error)).toContain('the database is locked')
    // A failed read is no answer, so it prunes nothing: the push is still drawn.
    expect(standing(m, 'sess_a')).toBe('waiting')
    expect(said(m.q('rail-needs-you-brobot'))).toBe('1')
    expect(said(m.q('rail-count-brobot'))).toBe('3')

    // The next read that succeeds takes the line away — and the push with it.
    stubbed().api = answering([A, B, C])
    await readAgain(m)
    expect(m.all('conversations-error')).toHaveLength(0)
    expect(standing(m, 'sess_a')).toBe('idle')
    expect(m.all('rail-needs-you-brobot')).toHaveLength(0)
  })

  /* ---------------------------------------------------------------- 6 · a conversation not listed */

  it('a push for a conversation the list does not name draws no row, and one that arrives while a read is in flight is drawn when that read names it', async () => {
    const m = await rail([A, B, C])

    // Part 1 · one message names a conversation the list does not, and one it does.
    await push(
      m,
      { conversation: 'sess_ghost', state: { is: 'needs-you' } },
      { conversation: 'sess_a', state: { is: 'active' } },
    )
    // The positive from the same message: A was heard.
    expect(standing(m, 'sess_a')).toBe('working')
    // The ghost draws no row, no count and no badge.
    expect(m.all('open-session-sess_ghost')).toHaveLength(0)
    expect((m.vm.listedOf as (id: string) => unknown)('sess_ghost')).toBeNull()
    expect(drawnOrder(m)).toEqual(['sess_a', 'sess_b', 'sess_c'])
    expect(said(m.q('rail-count-brobot'))).toBe('3')
    expect(m.all('rail-needs-you-brobot')).toHaveLength(0)

    // Part 2 · a read whose answer is parked, naming two conversations the list did not.
    let release!: (rows: ResumableSessionInfo[]) => void
    const answer = new Promise<ResumableSessionInfo[]>((resolve) => {
      release = resolve
    })
    stubbed().api = {
      runtime: { listResumable: () => answer, listUnresumable: () => Promise.resolve([]) },
    }
    const inFlight = readAgain(m)

    // While it is parked, main says one of them is active.
    await push(m, { conversation: 'sess_late', state: { is: 'active' } })
    expect(m.all('open-session-sess_late'), 'drawn before any read names it').toHaveLength(0)

    const late = hostRow('sess_late', { is: 'idle' }, { updatedAt: NOW - 240_000 })
    const quiet = hostRow('sess_quiet', { is: 'idle' }, { updatedAt: NOW - 300_000 })
    release([A, B, C, late, quiet])
    await inFlight

    // Both conversations are drawn now: the read named them.
    expect(said(m.q('rail-count-brobot'))).toBe('5')
    // The one main pushed says what main pushed; the one it did not says what the host listed — the
    // difference between them is the push.
    expect(standing(m, 'sess_late')).toBe('working')
    expect(standing(m, 'sess_quiet')).toBe('idle')
    // A's push arrived before this read was asked, so the read's answer took it away.
    expect(standing(m, 'sess_a')).toBe('idle')

    // A read asked after the push puts the conversation back to what the host says.
    stubbed().api = answering([A, B, C, late, quiet])
    await readAgain(m)
    expect(said(m.q('rail-count-brobot'))).toBe('5')
    expect(standing(m, 'sess_late')).toBe('idle')
    expect(standing(m, 'sess_quiet')).toBe('idle')
  })
})
