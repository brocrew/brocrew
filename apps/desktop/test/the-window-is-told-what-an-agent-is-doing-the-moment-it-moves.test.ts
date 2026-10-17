import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { FakeSessionHandle, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import { aWaitIsReadFrom } from '../src/shared/questions'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { AgentState } from '../src/shared/agent-state'
import type {
  AgentIdentity,
  ResumableSessionInfo,
  RuntimeEventMessage,
  RuntimeStatesMessage,
  TranscriptEvent,
  UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'
import { proseSpans } from './lib/prose-spans'

/**
 * # D-019 · the window is told what an agent is doing the moment it moves
 *
 * ## What this file pins, and why it is its own file
 *
 * D-019 gave main a push (`runtime:states`): the moment a conversation's one state moves, every
 * window is sent the state `get_agent_status` would say, and the rail draws it over its own list.
 * The census in `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved.test.ts` reads
 * the screen's WIRING; this file measures the two ends of the push itself, and the three copies of
 * one fact that the push depends on:
 *
 *  1. **the host** — a real `RuntimeHost` over a real SQLite ledger, with a provider double. A turn
 *     the provider ends is pushed as the word the list reads, for that conversation alone; a level
 *     is pushed and a stream that states none costs no flush; a mark that changes nothing says
 *     nothing, and a window that read the list is told again whatever the word; a running
 *     conversation is derived from the wait reads it was last derived from until a row they select
 *     is written; one conversation the flush cannot read costs its own word and no other's;
 *  2. **the rail's fold** — `conversationList` draws a pushed state over the row's own, for a listed
 *     row and no other;
 *  3. **the race guard** — a list read numbers itself before it is asked, and only a push heard
 *     after that number outlives its answer. This is a SOURCE pin: the behaviour needs a deferred
 *     read in a real engine and belongs in a `.dom.test.ts` (the landing's census gap);
 *  4. **the channel** — `runtime:states` leaves main on a channel of its own and reaches the bridge
 *     on the same one. Electron cannot be started here, so it is read from source;
 *  5. **the three lists of row types a wait read selects** — two SQL statements and one set say the
 *     same words, and a type added to one and not the others goes stale silently.
 *
 * ## ⚠️ How the host half counts, rather than compares
 *
 * Several of the guarantees are about what was NOT done: a flush that ran and pushed nothing, a
 * ledger that was not read again. The state comes out RIGHT with or without them, so a comparison of
 * words cannot see them. Two counters can. `instructionAsksWaiting` is asked once per flush and once
 * per list read (`cardReads`), and this file reads no list where it counts flushes; `routedRequestsOf`
 * and `questionsRaisedIn` pass their SECOND argument only from the flush, listings and cards (the
 * pump's own routing reads pass one). Every negative below is paired with a positive on the same
 * conversation from the same counter, so a counter that cannot move is not what passed.
 *
 * ## ⚠️ What a source census here reads
 *
 * Every source read goes through {@link code}, which blanks each comment with `prose-spans.ts`'
 * parser, so a docblock that quotes the code cannot satisfy or defeat a census. Every predicate is
 * run on the real source and on planted copies (standing rule 12), so it can fail.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * A stretch of the event loop long enough for everything a provider row starts to have run: five
 * turns of `setImmediate` (each pump, and the flush a mark arms, run there) and a short timer.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/**
 * Every comment blanked, newlines kept, so a docblock quoting the code cannot stand in for it.
 *
 * ⚠️ Blanked line by line, where each span says it starts: a run of `//` lines is one span joined
 * WITHOUT the indentation between them, so an indented run is not in the source as one string and
 * replacing the span whole would leave it standing.
 */
function code(file: string, source: string): string {
  const lines = source.split('\n')
  for (const span of proseSpans(file, source)) {
    span.text.split('\n').forEach((said, offset) => {
      const at = span.line - 1 + offset
      const from = lines[at]?.indexOf(said) ?? -1
      if (from < 0) throw new Error(`${file}:${at + 1} does not hold the comment ${said}`)
      const line = lines[at] ?? ''
      lines[at] = line.slice(0, from) + ' '.repeat(said.length) + line.slice(from + said.length)
    })
  }
  return lines.join('\n')
}

/** The index of a marker that is in the source exactly once. */
function once(marker: string, file: string, source: string): number {
  const at = source.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in ${file}`).toBeGreaterThan(-1)
  expect(
    source.indexOf(marker, at + 1),
    `${JSON.stringify(marker)} is in ${file} more than once`,
  ).toBe(-1)
  return at
}

/** A top-level function, from its signature to (not including) the `}` that closes it. */
function functionOf(signature: string, file: string, source: string): string {
  const at = once(signature, file, source)
  const end = source.indexOf('\n}', at)
  expect(end, `${signature} has no closing brace at column zero`).toBeGreaterThan(at)
  return source.slice(at, end)
}

/** From a marker that is in the source once, to (not including) the first `closing` after it. */
function sliceOf(marker: string, closing: string, file: string, source: string): string {
  const at = once(marker, file, source)
  const end = source.indexOf(closing, at)
  expect(end, `${marker} is never closed by ${JSON.stringify(closing)} in ${file}`).toBeGreaterThan(
    at,
  )
  return source.slice(at, end)
}

// ─── The host half ─────────────────────────────────────────────────────────────────────────────

describe('D-019 · main tells the window the moment an agent’s state moves', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  /** How many times the host called each store member, and `<name>/unread` for the counted form. */
  let calls: Map<string, number>
  /** A fault the counting store raises on a call, when a test arms one. */
  let fault: ((name: string, args: readonly unknown[]) => void) | null
  const tick = (): number => clock++

  /**
   * The store the host is handed: the real one, every member counted by name. ⚑ `<name>/unread` is
   * counted apart, because only the flush, the listings and the cards pass a second argument to the
   * two wait reads — the pump's own routing reads pass one.
   */
  const countingStore = (real: SessionStore): SessionStore => {
    const wrapped: Record<string, unknown> = {}
    for (const [name, member] of Object.entries(real)) {
      if (typeof member !== 'function') {
        wrapped[name] = member
        continue
      }
      wrapped[name] = (...args: unknown[]): unknown => {
        const key = args[1] !== undefined ? `${name}/unread` : name
        calls.set(key, (calls.get(key) ?? 0) + 1)
        fault?.(name, args)
        return Reflect.apply(member as (...given: unknown[]) => unknown, real, args)
      }
    }
    return wrapped as unknown as SessionStore
  }

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store: countingStore(store),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **The dep under test** — what main hands every window on `runtime:states`.
      statesMoved: (message) => {
        pushed.push(message)
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-states-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-states-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    pushed = []
    calls = new Map()
    fault = null
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** One conversation, in ask mode, opened as a person would in this window. */
  const opens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const handleOf = (nth: number): FakeSessionHandle => {
    const handle = handles[nth]
    if (handle === undefined) throw new Error(`no provider handle ${String(nth)} has been issued`)
    return handle
  }

  /** Every entry pushed for one conversation, in order. */
  const saidOf = (id: string): { conversation: string; state: AgentState }[] =>
    pushed.flatMap((message) => message.moved).filter((one) => one.conversation === id)
  const lastSaid = (id: string): AgentState | undefined => saidOf(id).at(-1)?.state

  /**
   * ⚑ **A list read, as the window makes it** — and it resets what was last said of every row it
   * names, so a test reads the list only AFTER everything it counts has been collected.
   */
  const listed = (id: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find((row) => row.sessionId === id)

  /** How many flushes have run: `cardReads` asks `instructionAsksWaiting` once per flush and per list read. */
  const flushes = (): number => calls.get('instructionAsksWaiting') ?? 0
  /** How many ledger reads the flush and the listings made: a defined second argument. */
  const ledgerReads = (): number =>
    (calls.get('routedRequestsOf/unread') ?? 0) + (calls.get('questionsRaisedIn/unread') ?? 0)

  it('a turn the provider ends is pushed as the word the list reads, for that conversation alone', async () => {
    const a = await opens('agent-a')
    const b = await opens('agent-b')
    await settle()
    pushed.length = 0

    // The arrival: a turn parks on its permission card in ask mode, and the conversation is pushed
    // as needing a person. This is the paired positive — the host is seen to push, and to push a
    // conversation both ways, before anything is said about a sibling that stays silent.
    await host.send(a, 'go', window)
    await waitFor(
      () => lastSaid(a)?.is === 'needs-you',
      'the parked turn to be pushed as needing you',
    )
    expect(saidOf(a).map((one) => one.state.is)).toContain('needs-you')
    // …and the arrival's chain has drained before the second half is measured.
    await settle()
    pushed.length = 0

    const card = window.messages.find(
      (message) => message.sessionId === a && message.event.type === 'permission_request',
    )?.event
    if (card?.type !== 'permission_request') throw new Error('the turn raised no permission card')

    // ⚑ **Answered from the PROVIDER's side, not through the host**, so the only rows that reach the
    // host from here are the provider's own: working, the tool's result, the turn's end, idle.
    await handleOf(0).respondPermission(card.id, { outcome: 'allow' })
    await waitFor(() => handleOf(0).status() === 'idle', 'the provider to end its turn')
    await waitFor(() => lastSaid(a)?.is === 'idle', 'the ended turn to be pushed as idle')
    await settle()

    // What was pushed is what the list says — read only now, because a list read resets the dedupe.
    const pushedWord = lastSaid(a)
    expect(pushedWord).toEqual({ is: 'idle' })
    const row = listed(a)
    expect(row, 'A is not on the host’s list').toBeDefined()
    expect(row?.state).toEqual(pushedWord)

    // A sibling that did not move is never named, and its own row says what it always said.
    expect(saidOf(b)).toEqual([])
    expect(listed(b)?.state).toEqual({ is: 'idle' })
  })

  it('a level the provider states is pushed, and a stream that states none costs no flush', async () => {
    const a = await opens('agent-a')
    const b = await opens('agent-b')
    const c = await opens('agent-c')
    await settle()

    // ⚠️ **What "the provider's own rows" means for a conversation that is idle.** The first row of
    // provider work with no turn behind it (a thinking delta) makes the session machine say
    // `status: working` — a status IS a live fact, so that first row costs one flush and is pushed
    // as *active*. That is the PAIRED POSITIVE of the negative below, on the same conversation and
    // the same counter: the counter can move for a row that came from a thinking delta.
    const beforeFirst = flushes()
    handleOf(1).simulateThinking()
    await waitFor(
      () => lastSaid(b)?.is === 'active',
      'the first provider work to be pushed as active',
    )
    await settle()
    expect(flushes()).toBeGreaterThan(beforeFirst)

    // NEGATIVE: from here B is already working, so more provider content states no status and no
    // level and no wait row — nothing is derived, nothing is said. Neither do the frames a
    // conversation streams that are not provider work (an activity phase, a checklist), on A, which
    // is idle.
    const f0 = flushes()
    const p0 = saidOf(a).length
    const b0 = saidOf(b).length
    handleOf(1).simulateThinking()
    handleOf(1).simulateThinking()
    handleOf(0).simulateActivity('thinking')
    handleOf(0).simulatePlanUpdate([{ text: 'look', status: 'pending' }])
    await settle()
    expect(flushes()).toBe(f0)
    expect(saidOf(b)).toHaveLength(b0)
    expect(saidOf(a)).toHaveLength(p0)

    // POSITIVE, on A: a level marks, exactly one flush runs, and the word is pushed. The counter
    // that stayed flat above is the one that moves here.
    handleOf(0).simulateBackgroundWork()
    await waitFor(() => lastSaid(a)?.is === 'in-the-background', 'the level to be pushed')
    await settle()
    expect(flushes()).toBe(f0 + 1)

    // The schedule is a level too, and it is pushed for the conversation whose frame it was — `.is`
    // only, because the time it names follows the harness's clock.
    const aSaid = saidOf(a).length
    handleOf(2).simulateScheduledWork()
    await waitFor(() => lastSaid(c)?.is === 'scheduled', 'the schedule to be pushed')
    // …and neither A nor B was named by C's frame.
    expect(saidOf(a)).toHaveLength(aSaid)
    expect(saidOf(b)).toHaveLength(b0)
  })

  it('a mark that changes nothing says nothing', async () => {
    const a = await opens('agent-a')
    await settle()
    pushed.length = 0

    handleOf(0).simulateBackgroundWork()
    await waitFor(() => saidOf(a).length === 1, 'the level to be pushed once')
    const f1 = flushes()

    // The IDENTICAL frame: a flush runs (proved by the counter, so the silence is not a flush that
    // never came), derives an equal word, and pushes nothing.
    handleOf(0).simulateBackgroundWork()
    await waitFor(() => flushes() === f1 + 1, 'a flush to run for the second frame')
    await settle()
    expect(saidOf(a)).toHaveLength(1)
    expect(saidOf(a)[0]?.state).toMatchObject({ is: 'in-the-background' })

    // The same path pushes when the word does change: the level empties.
    handleOf(0).simulateBackgroundWork({ running: [] })
    await waitFor(() => lastSaid(a)?.is === 'idle', 'the emptied level to be pushed')
    expect(saidOf(a)).toHaveLength(2)
  })

  it('a window that read the list holds that word, so the next word derived is pushed whatever it is', async () => {
    const a = await opens('agent-a')
    await settle()
    pushed.length = 0

    handleOf(0).simulateBackgroundWork()
    await waitFor(() => saidOf(a).length === 1, 'the level to be pushed once')
    const first = lastSaid(a)

    // The control, on the same conversation: with NO list read in between, the identical frame runs
    // a flush (the counter proves it came) and is not pushed again.
    const f1 = flushes()
    handleOf(0).simulateBackgroundWork()
    await waitFor(() => flushes() === f1 + 1, 'a flush to run for the identical frame')
    await settle()
    expect(saidOf(a)).toHaveLength(1)

    // The window reads the list: it holds THIS word now, and the list agrees with the push.
    const row = listed(a)
    expect(row, 'A is not on the host’s list').toBeDefined()
    expect(row?.state).toEqual(first)

    // The identical frame once more: the word is equal, and it is pushed anyway, because the list
    // read reset what was last said.
    handleOf(0).simulateBackgroundWork()
    await waitFor(() => saidOf(a).length === 2, 'the word to be pushed again after a list read')
    expect(saidOf(a)[1]?.state).toEqual(first)
  })

  it('a running conversation is derived from the wait reads it was last derived from, until a row they select is written', async () => {
    const a = await opens('agent-a')
    await settle()
    pushed.length = 0

    // PHASE 1 — a level of a running conversation reads no ledger: the kept read is reused.
    handleOf(0).simulateBackgroundWork()
    await waitFor(() => lastSaid(a)?.is === 'in-the-background', 'the level to be pushed')
    const n1 = ledgerReads()
    handleOf(0).simulateBackgroundWork({ running: [] })
    await waitFor(() => lastSaid(a)?.is === 'idle', 'the emptied level to be pushed')
    await settle()
    expect(ledgerReads()).toBe(n1)

    // PHASE 2 — the same counter moves when a row the wait reads select is written: it drops the
    // kept read, and the next flush reads afresh.
    const said = saidOf(a).length
    handleOf(0).simulateUserInput('which one?')
    await waitFor(() => ledgerReads() > n1, 'the flush to read the ledger afresh')
    await settle()
    // A provider's open question is not owed while its status is idle: the word is unchanged.
    expect(saidOf(a)).toHaveLength(said)
  })

  it('a conversation that cannot be read costs its own word and no other’s', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const x = await opens('agent-x')
      const y = await opens('agent-y')
      await settle()
      pushed.length = 0
      warn.mockClear()

      // Arm the store: the ledger reads the flush makes for X (a defined second argument) throw.
      fault = (name, args) => {
        const reading = name === 'routedRequestsOf' || name === 'questionsRaisedIn'
        if (reading && args[0] === x && args[1] !== undefined) throw new Error('planted')
      }
      const f0 = flushes()

      // One synchronous stretch, X first: X's wait row drops its kept read, so the flush reads its
      // ledger afresh — where the armed read throws — and Y's level is marked beside it.
      handleOf(0).simulateUserInput('which?')
      handleOf(1).simulateBackgroundWork()
      await waitFor(() => lastSaid(y)?.is === 'in-the-background', 'Y’s word to be pushed')
      await settle()

      // Y was said although X could not be read, and the failure names X.
      expect(flushes()).toBeGreaterThan(f0)
      expect(saidOf(x)).toEqual([])
      expect(
        warn.mock.calls.some(([line]) => String(line).includes(`could not say what ${x} is doing`)),
      ).toBe(true)

      // The paired positive: disarmed, the same conversation and the same kind of frame arrive, so
      // the read that threw was the only reason X went unsaid — and nothing was left stuck.
      fault = null
      handleOf(0).simulateBackgroundWork()
      await waitFor(() => lastSaid(x)?.is === 'in-the-background', 'X’s word to be pushed')
    } finally {
      warn.mockRestore()
    }
  })
})

// ─── The rail's fold ───────────────────────────────────────────────────────────────────────────

const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: 0,
  createdBy: null,
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {} as AgentIdentity['chosen'],
  provider: null,
  externalMcpServerIds: [],
})

const ROSTER = [
  identity(DEFAULT_PROFILE_ID, null),
  identity('project-manager', 'Project manager'),
  identity('worker', null),
]

const base: ResumableSessionInfo = {
  sessionId: 'sess_1',
  provider: 'claude',
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/w/one', rotation: 0 },
  cwd: '/w/one',
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  approvalMode: 'ask',
  profileId: 'project-manager',
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  lastEnding: 'completed',
  child: null,
  updatedAt: 0,
  resumeRefusal: null,
} as ResumableSessionInfo

const unresumableBase: UnresumableSessionInfo = {
  sessionId: 'sess_3',
  provider: 'codex',
  cwd: '/w/three',
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  named: null,
  profileId: 'worker',
  adoptedAt: null,
  updatedAt: 0,
  hasTranscript: true,
  lastEnding: 'completed',
  foundInUserHome: false,
  restoredFromBundle: false,
  reason: 'we can no longer read where this conversation lives, so it cannot be reopened',
} as UnresumableSessionInfo

describe('D-019 · the rail draws what main pushed over the row’s own state', () => {
  const rows = {
    resumable: [
      { ...base, sessionId: 'sess_1', updatedAt: 10 },
      { ...base, sessionId: 'sess_2', updatedAt: 20 },
    ] as ResumableSessionInfo[],
    unresumable: [
      { ...unresumableBase, sessionId: 'sess_3', updatedAt: 30, foundInUserHome: false },
      { ...unresumableBase, sessionId: 'sess_4', updatedAt: 40, foundInUserHome: true },
    ] as UnresumableSessionInfo[],
  }

  const stateOfRow = (list: ReturnType<typeof conversationList>, id: string): unknown =>
    list.find((row) => row.sessionId === id)?.state

  it('the rail draws a pushed state over the row’s own, for a listed row and no other', () => {
    const said = new Map<string, AgentState>([
      ['sess_1', { is: 'needs-you' }],
      ['sess_3', { is: 'active' }],
      ['sess_4', { is: 'active' }],
      ['sess_ghost', { is: 'active' }],
    ])
    const before = [...said]

    // The control first: with nothing pushed, every row draws its own state — so the override below
    // is what moved sess_1 and sess_3, and not a fold that ignores the rows.
    for (const none of [undefined, new Map<string, AgentState>()]) {
      const plain = conversationList({
        ...rows,
        identities: ROSTER,
        ...(none === undefined ? {} : { said: none }),
      })
      expect(plain.map((row) => row.sessionId)).toEqual(['sess_3', 'sess_2', 'sess_1'])
      for (const id of ['sess_1', 'sess_2', 'sess_3']) {
        expect(stateOfRow(plain, id)).toEqual({ is: 'idle' })
      }
    }

    const drawn = conversationList({ ...rows, identities: ROSTER, said })
    // A listed row, and a listed row of the other half, draw the pushed state.
    expect(stateOfRow(drawn, 'sess_1')).toEqual({ is: 'needs-you' })
    expect(stateOfRow(drawn, 'sess_3')).toEqual({ is: 'active' })
    // A row the push does not name keeps its own.
    expect(stateOfRow(drawn, 'sess_2')).toEqual({ is: 'idle' })
    // A row that stays off the list stays off it, though the push names it; a name the list does not
    // hold adds no row.
    expect(drawn.map((row) => row.sessionId)).toEqual(['sess_3', 'sess_2', 'sess_1'])
    expect(drawn).toHaveLength(3)
    // Nothing is reordered by what was said, and the input is not mutated.
    expect([...said]).toEqual(before)
  })
})

// ─── The race guard ────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ **The rail's list read, and the one guard that lets a push outlive it.** A push is stamped
 * `after: readsAsked`, a read numbers itself `asked = readsAsked` before either half is asked, and
 * when it lands it keeps every push with `after >= asked`: a push heard while THIS read was in
 * flight has `after === asked` and is newer than half of its answer.
 *
 * Returns what is wrong with `fn` (the body of `refreshListed`) and `whole` (the rail's whole code),
 * so a broken guard is a list, not a boolean, and a plant says which clause it broke.
 */
function raceGuardBroken(fn: string, whole: string): string[] {
  const broken: string[] = []
  const numbers = fn.indexOf('readsAsked += 1')
  const asked = fn.indexOf('const asked = readsAsked')
  const listsResumable = fn.indexOf('window.api.runtime.listResumable()')
  if (numbers < 0) broken.push('the read never numbers itself')
  if (asked < 0) broken.push('the read never takes its own number')
  if (listsResumable < 0) broken.push('the read never asks the host')
  if (numbers >= 0 && asked >= 0 && numbers > asked)
    broken.push('it takes its number before it counts')
  if (asked >= 0 && listsResumable >= 0 && asked > listsResumable)
    broken.push('it asks the host before it takes its number')

  const filter =
    /said\.value = new Map\(\[\.\.\.said\.value\]\.filter\(\(\[, (\w+)\]\) => \1\.after >= asked\)\)/g
  const statements = fn.match(filter) ?? []
  if (statements.length !== 1) {
    broken.push(`the filter with the comparison \`>=\` is here ${String(statements.length)} times`)
  }
  const at = fn.search(filter)
  const tryAt = fn.indexOf('try {')
  const catchAt = fn.indexOf('catch (cause)')
  const unresumableAt = fn.indexOf('hostUnresumable.value = unresumable')
  const lookedAt = fn.indexOf('looked.value = true')
  if (tryAt < 0 || catchAt < 0) broken.push('the read has no try/catch to be inside of')
  if (at >= 0) {
    if (!(tryAt >= 0 && tryAt < at && (catchAt < 0 || at < catchAt)))
      broken.push('the filter is not inside the try')
    if (!(unresumableAt >= 0 && unresumableAt < at))
      broken.push('the filter does not follow the list it answers')
    if (!(lookedAt > at)) broken.push('the filter does not precede `looked`')
  }
  // A failed read gives no answer for a push to yield to.
  if (catchAt >= 0 && /\bsaid\b/.test(fn.slice(catchAt)))
    broken.push('the catch arm touches what was said')

  const writes =
    whole.match(/\breadsAsked\s*(?:\+\+|--|[-+*/]?=(?!=))|(?:\+\+|--)\s*readsAsked\b/g) ?? []
  if (writes.length !== 2) broken.push(`readsAsked is written ${String(writes.length)} times`)
  if (!/let readsAsked = 0/.test(whole)) broken.push('readsAsked is not declared at 0')
  return broken
}

describe('D-019 · a list read numbers itself before it is asked', () => {
  const file = 'renderer/src/components/SideRail.vue'
  const whole = code(file, readFileSync(join(SRC, file), 'utf8'))
  const real = functionOf('async function refreshListed(): Promise<void> {', file, whole)

  it('a read numbers itself before it is asked, and only a push heard after that number outlives its answer', () => {
    // The control: the body was found, and it is the read that asks both halves of the host.
    expect(real).toContain('window.api.runtime.listResumable()')
    expect(real).toContain('window.api.runtime.listUnresumable()')
    expect(raceGuardBroken(real, whole)).toEqual([])

    // A read that landed LATER than the push keeps a push heard while it was in flight, so the
    // comparison is `>=` and not `>`.
    expect(real).toContain('.after >= asked')
    expect(real).not.toContain('.after > asked')

    // PLANTS (standing rule 12): each copy breaks one clause and the predicate reports it.
    const strictly = real.replace('.after >= asked', '.after > asked')
    expect(strictly).not.toBe(real)
    expect(raceGuardBroken(strictly, whole)).not.toEqual([])

    const late = real
      .replace('readsAsked += 1\n', '')
      .replace(
        'hostResumable.value = resumable',
        'readsAsked += 1\n    hostResumable.value = resumable',
      )
    expect(late).not.toBe(real)
    expect(raceGuardBroken(late, whole)).not.toEqual([])

    const inTheCatch = real.replace(
      'listError.value = readableError(cause)',
      'listError.value = readableError(cause)\n    said.value = new Map()',
    )
    expect(inTheCatch).not.toBe(real)
    expect(raceGuardBroken(inTheCatch, whole)).not.toEqual([])

    const aThirdWrite = `${whole}\nreadsAsked = 0\n`
    expect(raceGuardBroken(real, aThirdWrite)).not.toEqual([])
  })
})

// ─── The channel ───────────────────────────────────────────────────────────────────────────────

/** What is wrong with the two slices that carry `runtime:states` from main to the bridge. */
function channelBroken(mainSlice: string, preloadSlice: string, broadcastSlice: string): string[] {
  const broken: string[] = []

  if (mainSlice.match(/broadcastRuntime\(/g)?.length !== 1)
    broken.push('main does not broadcast exactly once')
  if (
    !/broadcastRuntime\(\s*\(\) => BrowserWindow\.getAllWindows\(\),\s*RUNTIME_STATES_CHANNEL,\s*message,/.test(
      mainSlice,
    ) ||
    !/for \(const (\w+) of windows\(\)\)/.test(broadcastSlice)
  )
    broken.push('main does not loop every window')
  const sends = broadcastSlice.match(/\.send\(/g) ?? []
  if (sends.length !== 1) broken.push(`main sends ${String(sends.length)} times`)
  if (!broadcastSlice.includes('window.webContents.send(channel, message)'))
    broken.push('main does not send on the states channel')
  if (mainSlice.includes('RUNTIME_CHANGED_CHANNEL'))
    broken.push('main names the invalidation channel')
  const guard = broadcastSlice.indexOf('!window.isDestroyed() && !window.webContents.isDestroyed()')
  const send = broadcastSlice.indexOf('.send(')
  const tryAt = broadcastSlice.indexOf('try {')
  const catchAt = broadcastSlice.indexOf('catch (error) {')
  const logAt = broadcastSlice.indexOf('failed(error)')
  if (guard < 0 || send < 0 || guard > send) broken.push('the guard does not come before the send')
  if (
    !(tryAt >= 0 && tryAt < send && send < catchAt && catchAt < logAt) ||
    !/message,\s*\(error\) => console\.error\('[^']+', error\),\s*mainThreadWork,\s*'window state broadcast',\s*\)/.test(
      mainSlice,
    )
  )
    broken.push('the send is not in its own try/catch that logs')

  if (preloadSlice.match(/ipcRenderer\.on\(RUNTIME_STATES_CHANNEL, forward\)/g)?.length !== 1)
    broken.push('the bridge does not register on the states channel once')
  const off = preloadSlice.match(/ipcRenderer\.off\(RUNTIME_STATES_CHANNEL, forward\)/g) ?? []
  if (off.length !== 1) broken.push('the bridge does not let go of the same forwarder once')
  if (preloadSlice.includes('RUNTIME_CHANGED_CHANNEL'))
    broken.push('the bridge names the invalidation channel')
  const on = preloadSlice.indexOf('ipcRenderer.on(')
  const returned = preloadSlice.indexOf('return () => {')
  const offAt = preloadSlice.indexOf('ipcRenderer.off(')
  if (!(on >= 0 && on < returned && returned < offAt))
    broken.push('the bridge does not return what lets go, after registering')
  // The forwarder's first parameter is the event and only the message goes on: the privileged
  // `sender` is never handed to the renderer.
  if (
    !/const forward = \((\w+): IpcRendererEvent, (\w+): RuntimeStatesMessage\): void =>\s*listener\(\2\)/.test(
      preloadSlice,
    )
  )
    broken.push('the forwarder does not drop the event and pass only the message')
  if (preloadSlice.match(/listener\(/g)?.length !== 1)
    broken.push('the listener is called elsewhere')
  return broken
}

/** Every `.ts` file under a directory, as paths relative to `SRC`. */
function tsFilesUnder(directory: string): string[] {
  return (readdirSync(join(SRC, directory), { recursive: true }) as string[])
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(directory, entry))
}

describe('D-019 · runtime:states leaves main on a channel of its own', () => {
  const read = (file: string): string => readFileSync(join(SRC, file), 'utf8')
  const ipc = code('shared/runtime-ipc.ts', read('shared/runtime-ipc.ts'))
  const mainIndex = code('main/index.ts', read('main/index.ts'))
  const preload = code('preload/index.ts', read('preload/index.ts'))
  const mainSlice = sliceOf(
    'statesMoved: (message) =>',
    '\n    readProcessMemory:',
    'main/index.ts',
    mainIndex,
  )
  const broadcastSlice = code(
    'main/runtime/window-broadcast.ts',
    read('main/runtime/window-broadcast.ts'),
  )
  const preloadSlice = sliceOf('onStates: (listener', '\n  },', 'preload/index.ts', preload)

  it('runtime:states leaves main on its own channel to every live window and reaches the bridge on the same one', () => {
    // The channel is declared once, with its own name, and is not the invalidation channel's.
    const states = ipc.match(/export const RUNTIME_STATES_CHANNEL = '([^']+)'/g) ?? []
    expect(states).toEqual(["export const RUNTIME_STATES_CHANNEL = 'runtime:states'"])
    const changed = ipc.match(/export const RUNTIME_CHANGED_CHANNEL = '([^']+)'/) ?? []
    expect(changed[1]).toBe('runtime:changed')
    expect(changed[1]).not.toBe('runtime:states')

    // Exactly one file under `src/main` names it in code, and it is the one that owns the windows.
    const naming = tsFilesUnder('main').filter(
      (file) =>
        read(file).includes('RUNTIME_STATES_CHANNEL') &&
        code(file, read(file)).includes('RUNTIME_STATES_CHANNEL'),
    )
    expect(naming).toEqual([join('main', 'index.ts')])

    // The host announces around no marker: it reads its dep in six places and no more (D-026:
    // `filesWereKept`, the fifth; D-029: `armItsWakeUp`, the sixth — a wake-up is D-018's rule one
    // act over, so a host nobody listens to starts nothing on its own; the launch's arm rides the
    // constructor's existing read and adds none).
    const hostCode = code('main/runtime/runtime-host.ts', read('main/runtime/runtime-host.ts'))
    expect(hostCode.match(/this\.deps\.statesMoved/g)).toHaveLength(6)

    // The slices exist and the real ones are whole.
    expect(mainSlice).toContain('BrowserWindow.getAllWindows()')
    expect(preloadSlice).toContain('ipcRenderer.on(')
    expect(channelBroken(mainSlice, preloadSlice, broadcastSlice)).toEqual([])

    // PLANTS (standing rule 12): the same slices, each sending or letting go on the other channel.
    const sendsOnChanged = mainSlice.replace('RUNTIME_STATES_CHANNEL', 'RUNTIME_CHANGED_CHANNEL')
    expect(sendsOnChanged).not.toBe(mainSlice)
    expect(channelBroken(sendsOnChanged, preloadSlice, broadcastSlice)).not.toEqual([])

    const letsGoOnChanged = preloadSlice.replace(
      'ipcRenderer.off(RUNTIME_STATES_CHANNEL',
      'ipcRenderer.off(RUNTIME_CHANGED_CHANNEL',
    )
    expect(letsGoOnChanged).not.toBe(preloadSlice)
    expect(channelBroken(mainSlice, letsGoOnChanged, broadcastSlice)).not.toEqual([])

    const sendsBeforeTheGuard = broadcastSlice.replace(
      '!window.isDestroyed() && !window.webContents.isDestroyed()',
      'true',
    )
    expect(sendsBeforeTheGuard).not.toBe(broadcastSlice)
    expect(channelBroken(mainSlice, preloadSlice, sendsBeforeTheGuard)).not.toEqual([])
    for (const wrong of [
      mainSlice + mainSlice,
      mainSlice.replace('BrowserWindow.getAllWindows()', '[]'),
      mainSlice.replace(/(RUNTIME_STATES_CHANNEL,\s*)message,/, '$1null,'),
      mainSlice.replace('console.error(', 'discard('),
    ]) {
      expect(wrong).not.toBe(mainSlice)
      expect(channelBroken(wrong, preloadSlice, broadcastSlice)).not.toEqual([])
    }
    for (const wrong of [
      broadcastSlice.replace('send(channel, message)', "send('runtime:changed', message)"),
      broadcastSlice.replace('failed(error)', 'discard(error)'),
      broadcastSlice.replace(
        'window.webContents.send(channel, message)',
        'window.webContents.send(channel, message); window.webContents.send(channel, message)',
      ),
    ]) {
      expect(wrong).not.toBe(broadcastSlice)
      expect(channelBroken(mainSlice, preloadSlice, wrong)).not.toEqual([])
    }
  })
})

// ─── The three copies of one list ──────────────────────────────────────────────────────────────

/** The names inside one `type IN (...)` list. */
const namesIn = (list: string): string[] => [...list.matchAll(/'([a-z_]+)'/g)].map((one) => one[1]!)

/** What the two statements select, less `status`, which counts only through its state. */
function selectedBy(store: string): string[] {
  const source = code('db/session-store.ts', store)
  const routed = sliceOf(
    'const selectRoutedRequestEvents = db.prepare(',
    'AND (ordinal',
    'db/session-store.ts',
    source,
  )
  const raised = sliceOf(
    'const selectQuestionsRaised = db.prepare(',
    'ORDER BY ordinal',
    'db/session-store.ts',
    source,
  )
  expect(routed).toContain(
    "AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})",
  )
  const shared = sliceOf(
    'export const ROUTED_REQUEST_EVENT_TYPES = [',
    '] as const',
    'db/session-store.ts',
    source,
  )
  const lists = (statement: string): string[] =>
    [...statement.matchAll(/type IN \(([^)]*)\)/g)].map((one) => one[1] ?? '')
  const last = lists(raised).at(-1) ?? ''
  return [...new Set([...namesIn(shared), ...namesIn(last)])].filter((name) => name !== 'status')
}

/** The literal the set is built from — the set itself is not exported. */
function theSetLiteral(questions: string): string[] {
  const at = questions.indexOf('const WHAT_THE_WAIT_READS_SELECT')
  expect(at, 'the set is no longer in questions.ts').toBeGreaterThan(-1)
  const open = questions.indexOf('([', at)
  const close = questions.indexOf('])', open)
  expect(open).toBeGreaterThan(at)
  expect(close).toBeGreaterThan(open)
  return namesIn(questions.slice(open, close))
}

/** The names in one list and not the other, either way. */
const differences = (one: readonly string[], other: readonly string[]): string[] => [
  ...one.filter((name) => !other.includes(name)),
  ...other.filter((name) => !one.includes(name)),
]

describe('D-019 · the three lists of row types a wait read selects say the same words', () => {
  const storeText = readFileSync(join(SRC, 'main/db/session-store.ts'), 'utf8')
  const questionsText = readFileSync(join(SRC, 'shared/questions.ts'), 'utf8')

  it('the three lists of row types a wait read selects say the same words', () => {
    const selected = selectedBy(storeText)
    const set = theSetLiteral(questionsText)
    // Both parses found their lists before anything is compared.
    expect(selected.length).toBeGreaterThanOrEqual(10)
    expect(set.length).toBeGreaterThanOrEqual(10)
    expect([...selected].sort()).toEqual([...set].sort())

    // The pure half: every member is a row `aWaitIsReadFrom` says a wait is read from…
    for (const type of set) {
      expect(aWaitIsReadFrom({ type } as TranscriptEvent), type).toBe(true)
    }
    // …a status counts only when it ends the provider…
    for (const state of ['ended', 'errored']) {
      expect(aWaitIsReadFrom({ type: 'status', state } as TranscriptEvent), state).toBe(true)
    }
    for (const state of ['working', 'idle', 'waiting_permission', 'closing']) {
      expect(aWaitIsReadFrom({ type: 'status', state } as TranscriptEvent), state).toBe(false)
    }
    // …and what the provider streams is not one.
    for (const type of [
      'assistant_message',
      'tool_call',
      'turn',
      'permission_request',
      'background_work',
      'scheduled_work',
      'thinking',
    ]) {
      expect(aWaitIsReadFrom({ type } as TranscriptEvent), type).toBe(false)
    }

    // PLANTS (standing rule 12): a name removed from the set, and one added to the statement, are
    // each a difference the comparison reports.
    const at = questionsText.indexOf('const WHAT_THE_WAIT_READS_SELECT')
    const oneShort =
      questionsText.slice(0, at) + questionsText.slice(at).replace("  'launched',\n", '')
    expect(oneShort).not.toBe(questionsText)
    expect(differences(selected, theSetLiteral(oneShort))).toEqual(['launched'])

    const oneMore = storeText.replace(
      'export const ROUTED_REQUEST_EVENT_TYPES = [',
      "export const ROUTED_REQUEST_EVENT_TYPES = [\n  'an_invented_row',",
    )
    expect(oneMore).not.toBe(storeText)
    expect(differences(selectedBy(oneMore), set)).toEqual(['an_invented_row'])

    const oneMoreRaised = storeText.replace(
      "AND type IN ('user_input_request', 'question_asked')",
      "AND type IN ('an_invented_row', 'user_input_request', 'question_asked')",
    )
    expect(oneMoreRaised).not.toBe(storeText)
    expect(differences(selectedBy(oneMoreRaised), set)).toEqual(['an_invented_row'])

    const noSharedSelection = storeText.replace(
      "AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})",
      "AND type IN ('request_routed')",
    )
    expect(noSharedSelection).not.toBe(storeText)
    expect(() => selectedBy(noSharedSelection)).toThrow()
  })
})
