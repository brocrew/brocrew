import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { ApprovalMode } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallNotices, RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type {
  PersistedEventInfo,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import {
  A_WAIT_ON_PURPOSE_OUTLASTS,
  TASK_IS_OPEN,
  TASK_STALL_CAUSES,
  TASK_STATES,
  derivePieces,
  theStateAsRead,
  type PieceRow,
  type TaskStallCause,
} from '../src/shared/tasks'

/**
 * # A conversation holding a stalled or parked piece still takes more work
 *
 * ⚑ **A stalled piece used to refuse every new give** to the conversation holding it
 * (`its-work-has-stalled`), and a piece parked on purpose read "stalled" after every turn, so it
 * refused too. ⚑ **Now a give goes through**: its answer names a stalled piece with the two acts a
 * stall asks for, and a piece whose status line marks it as waiting on purpose reads so, through
 * finished turns, until a new brief, a follow-up naming it, or a line without the mark.
 *
 * ⚠️ **The file keeps its name**, which is what every anchor into it points at; the describe below
 * says what it holds now.
 *
 * ## Shape of every case
 *
 * A real `RuntimeHost` over a real SQLite ledger, real tool calls, and the answer read off each
 * call. The helper runs in its giver's approval mode: in `auto` each turn ends at once with its
 * piece open — the stall — and in `ask` it parks on the card that turn raises — busy.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('F146 · a conversation holding a stalled or parked piece still takes more work', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: Window
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d016-one-open-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-d016-one-open-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_800_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId = 'default',
    approvalMode: ApprovalMode = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode },
      window,
    )
    return sessionId
  }

  const toolCall = async (
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const set = agentToolsFor(host, sessionId)
    const tool = set.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  interface AHelperHoldingAPiece {
    readonly parent: string
    readonly child: string
    /** The parent's own root — every piece it gives hangs under it. */
    readonly root: { readonly piece: string; readonly label: string }
    /** The piece the child holds, as the give answered it. */
    readonly held: { readonly piece: string; readonly label: string }
  }

  /**
   * ⛔ **The fixture every case shares.** A person opens a parent in `approvalMode`; the parent gives
   * `worker` a piece through `give_work`, which STARTS the child on the brief; and the brief's turn
   * is waited out to where that mode leaves it — ended (`auto`), or parked on its card (`ask`).
   * ⚠️ The premise is asserted before it is used: exactly one piece, open, the parent's.
   */
  const aHelperHoldingAPiece = async (
    approvalMode: ApprovalMode,
  ): Promise<AHelperHoldingAPiece> => {
    await host.close(await personOpens('worker'), window)
    const parent = await personOpens('default', approvalMode)
    const root = store.rootOf(parent)
    if (root === null) throw new Error('the parent owns no root')
    const given = await toolCall(parent, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Build the world clock page',
      brief: 'build the world clock page',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.started).toBe(true)
    const child = given.agent as string
    const held = { piece: given.piece as string, label: given.label as string }
    await waitFor(
      () =>
        store
          .events(child)
          .some((entry) =>
            approvalMode === 'auto'
              ? entry.event.type === 'turn'
              : entry.event.type === 'permission_request',
          ),
      approvalMode === 'auto' ? 'the brief’s turn to end' : 'the card the brief’s turn raised',
    )

    const pieces = store.openPiecesOf(child)
    expect(pieces, JSON.stringify(pieces)).toHaveLength(1)
    const [only] = pieces
    if (only === undefined) throw new Error('the give left no piece in its owner’s ledger')
    expect(only.piece).toBe(held.piece)
    expect(only.label).toBe(`${root.label}.1`)
    expect(only.giver).toBe(parent)
    expect(TASK_IS_OPEN[only.state], `the piece is ${only.state}`).toBe(true)
    expect(host.sessionIds).toContain(child)
    return { parent, child, root: { piece: root.piece, label: root.label }, held }
  }

  const giveMore = (fixture: AHelperHoldingAPiece): Promise<Record<string, unknown>> =>
    toolCall(fixture.parent, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'A piece of my own',
      brief: 'a piece of my own',
    })

  const followUpFrom = (
    fixture: AHelperHoldingAPiece,
    text: string,
  ): Promise<Record<string, unknown>> =>
    toolCall(fixture.parent, 'message_agent', {
      agent: fixture.child,
      kind: 'follow-up',
      piece: fixture.held.label,
      text,
    })

  /** The give's whole answer: what it says, and its facts. */
  const giveMoreSaid = async (
    fixture: AHelperHoldingAPiece,
  ): Promise<{ readonly text: string; readonly structured: Record<string, unknown> }> => {
    const tool = agentToolsFor(host, fixture.parent).tools.find((one) => one.name === 'give_work')
    if (tool === undefined) throw new Error('no such tool: give_work')
    const said = await tool.call({
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'A piece of my own',
      brief: 'a piece of my own',
    })
    return { text: said.text, structured: said.structured as Record<string, unknown> }
  }

  /** How many rows of one kind the helper's ledger holds. */
  const rowsIn = (child: string, type: string): number =>
    store.events(child).filter((entry) => entry.event.type === type).length

  /** A time an hour after this host's clock, as a wait on a time names it. */
  const anHourAhead = (): string => new Date(clock + 3_600_000).toISOString()

  /** The giver marks the piece it gave as waiting on purpose. */
  const parkIt = (fixture: AHelperHoldingAPiece): Promise<Record<string, unknown>> =>
    toolCall(fixture.parent, 'update_work', {
      piece: fixture.held.label,
      status: 'until the design review',
      on: { time: anHourAhead() },
    })

  it('🔴 a helper whose turn ended with its piece open still takes its giver’s next piece, and the answer names the stalled one', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const { child } = fixture
    // ⚠️ The premise: the piece stalled because the turn ended with it open.
    expect(store.openPiecesOf(child).map((one) => [one.state, one.stalledBecause])).toEqual([
      ['stalled', 'turn_ended'],
    ])
    const running = [...host.sessionIds]

    const given = await giveMoreSaid(fixture)

    expect(given.structured.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.structured.agent).toBe(child)
    expect(given.structured.started).toBe(false)
    expect(given.structured.stalled).toEqual([fixture.held.label])
    // ⛔ **The answer's facts are exactly these**: the stall rides beside them, nothing else grows.
    expect(Object.keys(given.structured).sort()).toEqual([
      'agent',
      'delivery',
      'label',
      'outcome',
      'piece',
      'profile',
      'runs_on',
      'stalled',
      'started',
    ])
    expect(given.text).toContain(
      `It still holds ${fixture.held.label} (its turn ended with this work still open) from you, not being worked on: follow it up with message_agent (kind follow-up), or take it back with withdraw_task.`,
    )
    // ⚑ Given into the one conversation it has, and the stalled piece is still stalled beside it.
    expect(store.childrenOf(fixture.root.piece).map((one) => one.label)).toEqual([
      fixture.held.label,
      `${fixture.root.label}.2`,
    ])
    await waitFor(() => rowsIn(child, 'turn') >= 2, 'the new piece’s turn to end')
    const stalled = store.openPiecesOf(child).find((one) => one.piece === fixture.held.piece)
    expect([stalled?.state, stalled?.stalledBecause]).toEqual(['stalled', 'turn_ended'])
    expect([...host.sessionIds].sort()).toEqual(running.sort())
  })

  it('🔴 a piece its giver parks reads waiting on purpose through a finished turn, and a give to its holder names no stall', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const { child } = fixture

    const parked = await parkIt(fixture)

    expect(parked.outcome, JSON.stringify(parked)).toBe('ok')
    const [piece] = store.openPiecesOf(child)
    expect([piece?.state, piece?.stalledBecause]).toEqual(['waiting-on-purpose', null])
    expect(piece?.statusLine?.text).toBe('until the design review')

    // ⚑ A turn that does not name it — a note — runs and ends, and the piece is still parked.
    const turns = rowsIn(child, 'turn')
    const noted = await toolCall(fixture.parent, 'message_agent', {
      agent: child,
      kind: 'note',
      text: 'for your information',
    })
    expect(noted.outcome, JSON.stringify(noted)).toBe('ok')
    await waitFor(() => rowsIn(child, 'turn') > turns, 'the note’s turn to end')
    expect(store.openPiecesOf(child).map((one) => one.state)).toEqual(['waiting-on-purpose'])

    const given = await giveMoreSaid(fixture)

    expect(given.structured.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.structured.stalled).toBeUndefined()
    expect(given.text).not.toContain('not being worked on')
  })

  it('🔴 a follow-up naming a parked piece ends its wait, and a turn that ends with it open stalls it again', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const { child } = fixture
    expect((await parkIt(fixture)).outcome).toBe('ok')
    expect(store.openPiecesOf(child).map((one) => one.state)).toEqual(['waiting-on-purpose'])

    const turns = rowsIn(child, 'turn')
    const followed = await followUpFrom(fixture, 'the review is done, carry on')
    expect(followed.outcome, JSON.stringify(followed)).toBe('ok')
    await waitFor(() => rowsIn(child, 'turn') > turns, 'the follow-up’s turn to end')

    const [piece] = store.openPiecesOf(child)
    expect([piece?.state, piece?.stalledBecause]).toEqual(['stalled', 'turn_ended'])
    expect(piece?.statusLine?.waiting).toBeUndefined()
    const given = await giveMoreSaid(fixture)
    expect(given.structured.stalled).toEqual([fixture.held.label])
  })

  /** The stall notices the giver was sent: messages whose first line says the work is not driven. */
  const stallNoticesTo = (giver: string): number => giverStallNotices(store, giver).length

  it('🔴 the holder parks its own piece; a note’s turn tells its giver of no stall, and a plain status line ends the wait', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const { child, parent } = fixture
    await waitFor(() => stallNoticesTo(parent) === 1, 'the giver to be told of the first stall')

    const parked = await toolCall(child, 'update_work', {
      piece: fixture.held.label,
      status: 'until the review lands',
      on: { time: anHourAhead() },
    })
    expect(parked.outcome, JSON.stringify(parked)).toBe('ok')
    expect(store.openPiecesOf(child).map((one) => one.state)).toEqual(['waiting-on-purpose'])

    const turns = rowsIn(child, 'turn')
    await toolCall(parent, 'message_agent', { agent: child, kind: 'note', text: 'for your info' })
    await waitFor(() => rowsIn(child, 'turn') > turns, 'the note’s turn to end')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(store.openPiecesOf(child).map((one) => one.state)).toEqual(['waiting-on-purpose'])
    expect(stallNoticesTo(parent)).toBe(1)

    // ⚑ A line without the mark ends the wait: the piece reads what the fold sees under it.
    const plain = await toolCall(parent, 'update_work', {
      piece: fixture.held.label,
      status: 'the review landed',
    })
    expect(plain.outcome, JSON.stringify(plain)).toBe('ok')
    const [piece] = store.openPiecesOf(child)
    expect([piece?.state, piece?.stalledBecause]).toEqual(['stalled', 'turn_ended'])
  })

  it('🔴 a person’s words leave a parked piece waiting on purpose, and it is not under Waiting on you', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const { child } = fixture
    expect((await parkIt(fixture)).outcome).toBe('ok')

    host.claimSession(child, window)
    const turns = rowsIn(child, 'turn')
    await host.send(child, 'is it done?', window)
    await waitFor(() => rowsIn(child, 'turn') > turns, 'the turn the person opened to end')

    expect(store.openPiecesOf(child).map((one) => one.state)).toEqual(['waiting-on-purpose'])
    expect(host.waitingOnWhoWroteForAPerson().rows).toEqual([])
  })

  it('⛔ a wait needs a status line, a new brief in the same call contradicts it, and waiting alone names nothing: nothing is written', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const { parent, child } = fixture
    const bare = await toolCall(parent, 'update_work', {
      piece: fixture.held.label,
      on: { time: anHourAhead() },
    })
    expect(bare.outcome, JSON.stringify(bare)).toBe('refused')
    expect(JSON.stringify(bare.detail)).toContain('on needs status')
    const both = await toolCall(parent, 'update_work', {
      piece: fixture.held.label,
      status: 'until the review lands',
      on: { time: anHourAhead() },
      brief: 'do it differently',
    })
    expect(both.outcome, JSON.stringify(both)).toBe('refused')
    expect(JSON.stringify(both.detail)).toContain('a new brief ends a wait on purpose')
    const waitingAlone = await toolCall(parent, 'update_work', {
      piece: fixture.held.label,
      status: 'until the review lands',
      waiting: true,
    })
    expect(waitingAlone.outcome, JSON.stringify(waitingAlone)).toBe('refused')
    expect(JSON.stringify(waitingAlone.detail)).toContain('waiting is replaced by on')
    const [piece] = store.openPiecesOf(child)
    expect([piece?.state, piece?.statusLine]).toEqual(['stalled', null])
  })

  it('🔴 a conversation’s own root may wait on purpose, and its status line keeps what it waits on', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const { parent, root } = fixture
    const parked = await toolCall(parent, 'update_work', {
      piece: root.label,
      status: 'until the review lands',
      on: { agent: fixture.held.label },
    })
    expect(parked.outcome, JSON.stringify(parked)).toBe('ok')
    const rootRow = store.rootOf(parent)
    if (rootRow === null) throw new Error('the parent owns no root')
    expect(store.rootLines(rootRow.piece).statusLine).toMatchObject({
      text: 'until the review lands',
      waiting: true,
      on: { kind: 'agent', label: fixture.held.label },
    })
    // ⚑ **The control, one fact over**: the same line without `on` is the root's own, unmarked.
    const plain = await toolCall(parent, 'update_work', {
      piece: root.label,
      status: 'the review landed',
    })
    expect(plain.outcome, JSON.stringify(plain)).toBe('ok')
    expect(store.rootLines(rootRow.piece).statusLine).not.toHaveProperty('waiting')
  })

  it('⛔ a conversation that neither holds nor gave a piece cannot mark it as waiting, and nothing is written', async () => {
    const fixture = await aHelperHoldingAPiece('auto')
    const stranger = await personOpens('stranger')
    const refused = await toolCall(stranger, 'update_work', {
      piece: fixture.held.label,
      status: 'until the review lands',
      on: { time: anHourAhead() },
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    const [piece] = store.openPiecesOf(fixture.child)
    expect([piece?.state, piece?.statusLine]).toEqual(['stalled', null])
    // ⚑ **The control**: its giver's same call marks it.
    expect((await parkIt(fixture)).outcome).toBe('ok')
    expect(store.openPiecesOf(fixture.child).map((one) => one.state)).toEqual([
      'waiting-on-purpose',
    ])
  })

  it('🔴 a helper still working on its piece takes the next one — the same give, its turn not yet ended', async () => {
    // ⚑ **One fact over from the case above**: the helper runs in `ask`, so the brief's turn is
    // parked on its card — busy, not stalled — when the same parent makes the same give.
    // ⛔ **The deliberate paired positive of the refusal above**: it is what tells the stall rule
    // from the one-open-task rail it replaced, which refused this very give because a piece was open.
    const fixture = await aHelperHoldingAPiece('ask')
    const { child } = fixture
    const [first] = store.openPiecesOf(child)
    expect(first?.state).not.toBe('stalled')
    expect(first?.stalledBecause).toBeNull()
    const running = [...host.sessionIds]

    const given = await giveMore(fixture)

    // ⚑ **Admitted, into the one conversation this parent has with that agent**, and held until it
    // is free — `give_work`'s own words for a busy helper.
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    expect(given.agent).toBe(child)
    expect(given.started).toBe(false)
    expect(given.delivery).toBe('held')
    // ⚑ **Busy is not a stall**: the answer names nothing the giver must act on.
    expect(given).not.toHaveProperty('stalled')
    expect(given.label).toBe(`${fixture.root.label}.2`)
    expect(store.openPiecesOf(child).map((one) => one.label)).toEqual([
      fixture.held.label,
      `${fixture.root.label}.2`,
    ])
    expect([...host.sessionIds].sort()).toEqual(running.sort())
  })
})

/** A fictional piece row, as the fold could have read it. */
const aRow = (over: Partial<PieceRow>): PieceRow => ({
  piece: 'work_1',
  label: 'W1.1',
  parent: 'work_root',
  title: 'the work',
  brief: 'the work',
  giver: 'sess_pm',
  owner: 'sess_worker',
  givenAt: 0,
  messageId: null,
  state: 'working',
  endedAt: null,
  endedBy: null,
  outcome: null,
  stalledBecause: null,
  stalledAt: null,
  stalledBy: null,
  questionLostAtRestart: false,
  resources: [],
  summary: null,
  answerReachedNobody: false,
  needsUserAction: false,
  statusLine: null,
  ...over,
})
const MARKED = { text: 'until the review lands', by: 'sess_pm', at: 1, waiting: true as const }

describe('F146 · what a parked piece reads as', () => {
  it('🔴 every stall cause: marked, it reads waiting on purpose exactly when the wait outlasts the cause', () => {
    // The approved split, written out here rather than read from the production table: a stall a
    // wait on purpose outlasts, and one it never hides — a piece left with nobody, or a stall only a
    // person can clear.
    const outlasted: readonly TaskStallCause[] = [
      'turn_ended',
      'turn_interrupted',
      'app_restarted',
      'background_stopped',
    ]
    const neverHidden: readonly TaskStallCause[] = [
      'message_never_sent',
      'could_not_be_reopened',
      'provider_limited',
      'login_refused',
      'billing_refused',
    ]
    expect([...outlasted, ...neverHidden].sort()).toEqual([...TASK_STALL_CAUSES].sort())
    for (const cause of TASK_STALL_CAUSES) {
      const stalled = aRow({ state: 'stalled', stalledBecause: cause, stalledAt: 1 })
      expect(theStateAsRead(stalled), cause).toBe('stalled')
      expect(theStateAsRead({ ...stalled, statusLine: MARKED }), cause).toBe(
        outlasted.includes(cause) ? 'waiting-on-purpose' : 'stalled',
      )
    }
    for (const cause of neverHidden) {
      expect(A_WAIT_ON_PURPOSE_OUTLASTS[cause], cause).toBe(false)
    }
    for (const cause of outlasted) {
      expect(A_WAIT_ON_PURPOSE_OUTLASTS[cause], cause).toBe(true)
    }
  })

  it('⚑ every other state: working and the two waits on a person are covered; the rest read as they are', () => {
    const covered = new Set([
      'working',
      'waiting-on-the-person-who-asked',
      'waiting-on-the-person-who-wrote',
    ])
    for (const state of TASK_STATES) {
      if (state === 'stalled') continue
      const row = aRow({ state })
      expect(theStateAsRead(row), state).toBe(state)
      expect(theStateAsRead({ ...row, statusLine: MARKED }), state).toBe(
        covered.has(state) ? 'waiting-on-purpose' : state,
      )
    }
  })

  describe('over a ledger', () => {
    let ordinal = 0
    const row = (event: TranscriptEvent): PersistedEventInfo => ({
      ordinal: ordinal++,
      at: 1_700_000_000_000 + ordinal * 1_000,
      event,
    })
    const given = (messageId?: string): TranscriptEvent => ({
      type: 'work_given',
      piece: 'work_1',
      label: 'W1.1',
      parent: 'work_root',
      givenBy: 'sess_pm',
      title: 'the work',
      brief: 'the work',
      ...(messageId === undefined ? {} : { messageId }),
    })
    const line = (waiting: boolean): TranscriptEvent => ({
      type: 'work_status_set',
      piece: 'work_1',
      line: 'until the review lands',
      by: 'sess_pm',
      ...(waiting ? { waiting: true as const } : {}),
    })

    it('🔴 a drive-end stall under the mark reads waiting on purpose, with the stall kept under it', () => {
      ordinal = 0
      const [piece] = derivePieces('sess_worker', [
        row(given()),
        row({ type: 'turn', state: 'completed' }),
        row(line(true)),
      ])
      expect(piece).toMatchObject({
        state: 'waiting-on-purpose',
        parkedOver: 'stalled',
        stalledBecause: null,
      })
    })

    it('⛔ a brief that was never sent stays a stall under the mark, so its giver is told', () => {
      ordinal = 0
      const [piece] = derivePieces('sess_worker', [
        row(given('msg_1')),
        row({
          type: 'message_unqueued',
          messageId: 'msg_1',
          reason: 'abandoned',
          text: 'the work',
        }),
        row(line(true)),
      ])
      expect(piece).toMatchObject({ state: 'stalled', stalledBecause: 'message_never_sent' })
    })

    it('🔴 turns under the mark move nothing a reader sees: its change clock stays at the mark', () => {
      const ledger = (waiting: boolean): PersistedEventInfo[] => {
        ordinal = 0
        return [
          row(given()),
          row({ type: 'turn', state: 'completed' }),
          row(line(waiting)),
          row({ type: 'user_turn', text: 'carry on' }),
          row({ type: 'turn', state: 'completed' }),
        ]
      }
      const markedAt = ledger(true)[2]?.at
      const [parked] = derivePieces('sess_worker', ledger(true), { trackChanges: true })
      expect(parked?.state).toBe('waiting-on-purpose')
      expect(parked?.lastRecordedChangeAt).toBe(markedAt)
      // ⚑ **The control**: the same turns under an unmarked line move the clock past it.
      const [plain] = derivePieces('sess_worker', ledger(false), { trackChanges: true })
      expect(plain?.lastRecordedChangeAt).toBeGreaterThan(markedAt ?? 0)
    })
  })
})

describe('F146 · a launch’s sweep judges a parked piece by what is under its mark', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let now: number
  const tick = (): number => now++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f146-sweep-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    now = 7_000_000
    store = createSessionStore(db, tick)
  })

  afterEach(() => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string, profileId: string, parentSessionId?: string): string => {
    store.create({
      id,
      provider: 'claude',
      cwd: userData,
      approvalMode: 'ask',
      profileId,
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
    })
    return id
  }
  // ⚑ From the store, which also writes into these ledgers: the sweep's own row takes an ordinal.
  const nextOrdinal = (id: string): number => store.nextOrdinal(id)
  const append = (id: string, event: TranscriptEvent): void => {
    store.append(id, nextOrdinal(id), event, tick())
  }
  /** A piece `pm` gives `worker`, written as the host writes one; nothing follows it. */
  const aPieceGiven = (pm: string, worker: string, piece: string): void => {
    const rootRow = store.rootOf(pm)
    if (rootRow === null) throw new Error(`${pm} owns no root`)
    const number = store.numberUnder(rootRow.piece)
    const label = `${rootRow.label}.${String(number)}`
    store.recordGive(
      {
        piece,
        parent: rootRow.piece,
        number,
        owner: worker,
        givenBy: pm,
        title: label,
        brief: label,
        folder: null,
        inputs: [],
      },
      nextOrdinal(worker),
      {
        type: 'work_given',
        piece,
        label,
        parent: rootRow.piece,
        givenBy: pm,
        title: label,
        brief: label,
      },
      tick(),
    )
  }
  const restartRows = (id: string): TranscriptEvent[] =>
    store
      .events(id)
      .map((entry) => entry.event)
      .filter((event) => event.type === 'work_restarted')
  const pieceOf = (owner: string): PieceRow | undefined => store.piecesOwnedBy(owner)[0]

  it('🔴 a piece parked mid-drive when the app went away is named once, and a second launch names nothing', () => {
    const pm = conversation('sess_pm', 'pm')
    const worker = conversation('sess_worker', 'worker', pm)
    aPieceGiven(pm, worker, 'work_1')
    append(worker, {
      type: 'work_status_set',
      piece: 'work_1',
      line: 'until the review lands',
      by: pm,
      waiting: true,
    })
    expect(pieceOf(worker)).toMatchObject({ state: 'waiting-on-purpose', parkedOver: 'working' })

    expect(store.settleRestartedWork(now, new Set())).toBe(1)
    expect(restartRows(worker)).toEqual([{ type: 'work_restarted', pieces: ['work_1'] }])
    expect(pieceOf(worker)).toMatchObject({ state: 'waiting-on-purpose', parkedOver: 'stalled' })
    expect(store.settleRestartedWork(now, new Set())).toBe(0)
    expect(restartRows(worker)).toHaveLength(1)

    // ⚑ Its mark ended, it reads the stall the launch found under it.
    append(worker, { type: 'work_status_set', piece: 'work_1', line: 'the review landed', by: pm })
    expect(pieceOf(worker)).toMatchObject({ state: 'stalled', stalledBecause: 'app_restarted' })
  })

  it('⚑ the control: an unmarked piece is named the same way, once', () => {
    const pm = conversation('sess_pm', 'pm')
    const worker = conversation('sess_worker', 'worker', pm)
    aPieceGiven(pm, worker, 'work_1')
    expect(pieceOf(worker)?.state).toBe('working')
    expect(store.settleRestartedWork(now, new Set())).toBe(1)
    expect(pieceOf(worker)).toMatchObject({ state: 'stalled', stalledBecause: 'app_restarted' })
    expect(store.settleRestartedWork(now, new Set())).toBe(0)
  })
})
