import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, SessionMachine } from '@brobot2/runtime'
import type { FakeSessionHandle, RuntimeEvent, StartOptions } from '@brobot2/runtime'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 D-033 · a Claude turn's words compare what its conversation holds again (`05eb3115`)
 *
 * ⚑ **On Claude a turn's `status: working` lands before its `user_turn`, at every turn** (`099`),
 * and for as long as the turn applies a model, effort or mode change. The read at that `working`
 * finds a drive that names no piece yet, so `derivePieces` draws every open piece driven. ⛔ Before
 * `05eb3115` D-033 announced that read once and never compared again, and a conversation's OTHER
 * open pieces read *working* in every window until the turn ended.
 *
 * ⚑ **The repair**: a `working` that reaches `deliver` while no turn of ours is open sets
 * `HostedSession.itsWorkWasReadBeforeItsWords`; the turn's own `user_turn` (`publishOurs`) clears it
 * and compares once (`sayWhenItsWorkMoved`), announcing `work` only when a piece moved; a turn's
 * ending clears it too, so a wake (no words of ours) leaves nothing behind.
 *
 * ⚠️ **Why D-033's own suite could not see it**: it runs on `FakeRuntime`, whose words land first
 * (`work-moved-and-nothing-announced-it.test.ts`). `lib/provider-double.ts`' {@link claudeOnAResume}
 * has Claude's order, but only on a RESUME (`ResumeGate.silentUntilItsFirstTurn`), and this case is
 * a running conversation. ⚑ So the handle below takes its `send` from that double: in Claude's order
 * a `send` resolves only once the pump has TAKEN the turn's `working` — no clock, no wait.
 *
 *  - **§1** — a worker holds two stalled pieces and a follow-up names one: in Claude's order the
 *    words announce `work` again, and the other piece is drawn stalled; in the words-first order
 *    nothing extra is said at the words, and the other piece never read working.
 *  - **§2** — a turn that names no piece: the words compare, nothing moved, nothing is said.
 *  - **§3** — a wake ends with the flag cleared: a words-first turn after it says nothing at its
 *    words; a Claude-order turn after it compares once.
 *  - **§4** — `publishOurs` announces only through `sayWhenItsWorkMoved`, behind the flag, after its
 *    append (finding 4 of the change's review: §5 of `work-moved-and-nothing-announced-it` forbids
 *    announcing in the plumbing, and this is the one compare it now holds).
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/** ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. */
const codeOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

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

/** ⚑ `ProviderDouble`, with one start's handle decorated — the worker's (`729`'s double). */
class DecoratingDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly takeDecoration: () =>
      ((handle: FakeSessionHandle) => FakeSessionHandle) | null,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    const decorate = this.takeDecoration()
    return decorate === null ? handle : decorate(handle)
  }
}

/** ⚑ A worker's turns, held by the test: it ends them, starts a wake, and picks the order. */
interface ATurnWeHold {
  readonly handle: FakeSessionHandle
  readonly machine: SessionMachine
  /**
   * ⚑ **Which lands first, a turn's `working` or its words.** `claude: false` is the Fake's order
   * (and Codex's): `send` resolves at once, and the host's `user_turn` beats the pump to the
   * `working`. `claude: true` is Claude's (`claudeOnAResume`'s `send`): `send` resolves only once
   * the pump has taken this turn's `working`, so the words land after it.
   */
  readonly order: { claude: boolean }
}

/**
 * ⚑ **A turn that stays `working` until the test ends it** — `state-a-supervisor-can-trust`'s
 * instrument (the lifecycle is the production {@link SessionMachine}'s), with the one change this
 * suite is about: the order of a turn's `working` and its words ({@link ATurnWeHold.order}).
 */
function aTurnWeHold(handle: FakeSessionHandle): ATurnWeHold {
  const queue = new AsyncQueue<RuntimeEvent>()
  let status = handle.status()
  const machine = new SessionMachine((event) => {
    if (event.type === 'status') status = event.state
    queue.push(event)
  })
  machine.markStarting()
  machine.sessionStarted(handle.ref, 'started')
  const order = { claude: false }
  /** Resolves once the pump has taken the `working` a `send` opened — see `send` below. */
  let workingTaken: (() => void) | null = null
  let closing: Promise<void> | null = null
  const proxy = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return (): AsyncIterable<RuntimeEvent> => ({
          async *[Symbol.asyncIterator]() {
            for await (const event of queue) {
              yield event
              // ⚑ Past the `yield`: the pump has delivered it and asked for the next one.
              if (event.type === 'status' && event.state === 'working' && workingTaken !== null) {
                const taken = workingTaken
                workingTaken = null
                taken()
              }
            }
          },
        })
      }
      if (property === 'status') return () => status
      if (property === 'waitForAPerson') {
        return (): (() => void) => {
          machine.beginWait()
          let held = true
          return () => {
            if (!held) return
            held = false
            machine.endWait()
          }
        }
      }
      if (property === 'send') {
        return async (): Promise<void> => {
          const taken = order.claude
            ? new Promise<void>((resolve) => {
                workingTaken = resolve
              })
            : null
          if (machine.beginTurn() === null) {
            workingTaken = null
            throw new Error('cannot send: session is not active or a turn is in progress')
          }
          // ⚠️ **Claude's order, as `claudeOnAResume` spells it**: the host writes `user_turn` after
          // `await handle.send(…)`, so this resolves only once the pump has taken the `working`.
          if (taken !== null) await taken
        }
      }
      if (property === 'interrupt') {
        return async (): Promise<void> => {
          machine.requestInterrupt()
          machine.completeTurn('interrupted')
        }
      }
      if (property === 'close') {
        return (): Promise<void> =>
          (closing ??= (async () => {
            if (machine.beginClose()) {
              if (machine.hasProviderWork) machine.forceEnd(false)
              machine.closeSession(handle.ref)
              queue.close()
            }
            await target.close()
          })())
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return { handle: proxy, machine, order }
}

/** ⚑ A ledger row by its type, and a `status` by its state too — `status:working`, `user_turn`. */
const rowName = (event: TranscriptEvent): string =>
  event.type === 'status' ? `status:${event.state}` : event.type

describe('D-033 · a Claude turn’s words compare what its conversation holds again', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  let decorateNext: ((handle: FakeSessionHandle) => FakeSessionHandle) | null
  /** Every worker turn this suite holds, newest last. */
  let held: ATurnWeHold[]
  /** ⚑ The worker and its two pieces, by label, that each announcement is measured against. */
  let watched: { readonly worker: string; readonly a: string; readonly b: string } | null
  /**
   * ⚑ **Each announcement, with what a window would read the instant it was told** — the worker's
   * newest row, and its two pieces' states (`work-moved-and-nothing-announced-it` §3's measurement,
   * taken INSIDE the announcement).
   */
  let said: { what: string; at: string; a: string | undefined; b: string | undefined }[]
  const tick = (): number => clock++

  const rows = (sessionId: string): string[] =>
    store.events(sessionId).map((entry) => rowName(entry.event))
  const stateOf = (worker: string, label: string): string | undefined =>
    store.piecesOwnedBy(worker).find((one) => one.label === label)?.state

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d033-words-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d033-words-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_033_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    decorateNext = null
    held = []
    watched = null
    said = []
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new DecoratingDouble(provider, handles, issued, gate, () => {
          const decorate = decorateNext
          decorateNext = null
          return decorate
        }),
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
      announce: (message) => {
        if (watched === null) return
        said.push({
          what: message.what,
          at: rows(watched.worker).at(-1) ?? '-',
          a: stateOf(watched.worker, watched.a),
          b: stateOf(watched.worker, watched.b),
        })
      },
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    // ⛔ A send at teardown must not wait on a pump that is going away.
    for (const one of held) one.order.claude = false
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * ⚑ **A pm, and a worker holding two pieces it gave, both stalled** — the first given idle (its
   * brief is the worker's first turn), the second while that turn runs (held, and sent as it
   * ends); then the second's turn ends too. ⚑ Every turn here goes words-first.
   */
  const aWorkerHoldingTwoStalledPieces = async (): Promise<{
    pm: string
    worker: string
    a: string
    b: string
    turn: ATurnWeHold
  }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    decorateNext = (handle) => {
      const it = aTurnWeHold(handle)
      held.push(it)
      return it.handle
    }
    const first = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The first',
      brief: 'do the first',
    })
    decorateNext = null
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const worker = first.agent as string
    const a = first.label as string
    const turn = held.at(-1)
    if (turn === undefined) throw new Error('the give started no conversation this suite holds')
    await waitFor(
      () => turn.handle.status() === 'working' && stateOf(worker, a) === 'working',
      'the worker on the first piece',
    )
    const second = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The second',
      brief: 'do the second',
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    const b = second.label as string
    turn.machine.completeTurn('completed')
    await waitFor(
      () => turn.handle.status() === 'working' && stateOf(worker, b) === 'working',
      'the second brief, sent as the first turn ended',
    )
    turn.machine.completeTurn('completed')
    await waitFor(
      () =>
        turn.handle.status() === 'idle' &&
        stateOf(worker, a) === 'stalled' &&
        stateOf(worker, b) === 'stalled',
      'both pieces stalled',
    )
    await letItSettle()
    return { pm, worker, a, b, turn }
  }

  /** ⚑ **A wake** — a turn the provider starts by itself (F080's burst), with no words of ours. */
  const aWake = async (worker: string, a: string, b: string, turn: ATurnWeHold): Promise<void> => {
    const before = rows(worker).length
    turn.machine.noteProviderWork()
    await waitFor(() => rows(worker).slice(before).includes('status:working'), 'the wake to run')
    turn.machine.completeTurn('completed')
    await waitFor(() => {
      const since = rows(worker).slice(before)
      return (
        since.includes('turn') &&
        since.at(-1) === 'status:idle' &&
        stateOf(worker, a) === 'stalled' &&
        stateOf(worker, b) === 'stalled'
      )
    }, 'the wake to end, both pieces stalled again')
    await letItSettle()
  }

  /** ⚑ The pm's words to the worker, landed: the `user_turn` carrying them, and a `working`. */
  const theWordsLand = async (worker: string, before: number, words: string): Promise<void> => {
    const carriesThem = (event: TranscriptEvent): boolean =>
      event.type === 'user_turn' && event.text.includes(words)
    await waitFor(() => {
      const since = store.events(worker).slice(before)
      return (
        since.some((entry) => carriesThem(entry.event)) &&
        since.some((entry) => rowName(entry.event) === 'status:working')
      )
    }, 'the words and their turn’s working')
    await letItSettle()
  }

  const work = () => said.filter((one) => one.what === 'work')
  const atTheWords = () => work().filter((one) => one.at === 'user_turn')

  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a follow-up on one of two stalled pieces', () => {
    it('🔴 in Claude’s order, its words announce `work` again — and the other piece is drawn stalled', async () => {
      const w = await aWorkerHoldingTwoStalledPieces()
      watched = { worker: w.worker, a: w.a, b: w.b }
      said = []
      const before = rows(w.worker).length
      w.turn.order.claude = true

      const words = 'go on with the first'
      const followed = await callOn(w.pm, 'message_agent', {
        agent: w.worker,
        text: words,
        kind: 'follow-up',
        piece: w.a,
      })
      expect(followed.outcome, JSON.stringify(followed)).toBe('ok')
      await theWordsLand(w.worker, before, words)

      // ⛔ **The premise: Claude's order, reproduced** — the `working` before the words, and the read
      // there drew the OTHER piece working (every open piece is driven until the words name one).
      const since = rows(w.worker).slice(before)
      expect(since.indexOf('status:working'), since.join(' ')).toBeLessThan(
        since.indexOf('user_turn'),
      )
      const atItsWorking = work().find((one) => one.at === 'status:working')
      expect(atItsWorking, JSON.stringify(said)).toMatchObject({ a: 'working', b: 'working' })
      // 🔴 **THE MEASUREMENT** — the words compared again, once, and said what moved back.
      expect(atTheWords(), JSON.stringify(said)).toHaveLength(1)
      expect(atTheWords()[0]).toMatchObject({ a: 'working', b: 'stalled' })
      // ⚑ **And what every window draws now, mid-turn**: the last thing it was told to read.
      expect(w.turn.handle.status()).toBe('working')
      expect(work().at(-1), JSON.stringify(said)).toMatchObject({ a: 'working', b: 'stalled' })
    })

    it('⚑ …and words-first (the Fake’s and Codex’s order), nothing extra at the words, and the other piece never read working', async () => {
      const w = await aWorkerHoldingTwoStalledPieces()
      watched = { worker: w.worker, a: w.a, b: w.b }
      said = []
      const before = rows(w.worker).length
      // ⚑ `order.claude` stays false: the words land first.

      const words = 'go on with the first'
      const followed = await callOn(w.pm, 'message_agent', {
        agent: w.worker,
        text: words,
        kind: 'follow-up',
        piece: w.a,
      })
      expect(followed.outcome, JSON.stringify(followed)).toBe('ok')
      await theWordsLand(w.worker, before, words)

      // ⛔ The premise: the words before the `working`.
      const since = rows(w.worker).slice(before)
      expect(since.indexOf('user_turn'), since.join(' ')).toBeGreaterThanOrEqual(0)
      expect(since.indexOf('user_turn'), since.join(' ')).toBeLessThan(
        since.indexOf('status:working'),
      )
      // ⚑ **The positive control**: the channel is live — the `working` said the first piece moved.
      expect(work().some((one) => one.at === 'status:working' && one.a === 'working')).toBe(true)
      // ⛔ **THE NEGATIVE**: no `working` came before the words, so they compare nothing…
      expect(atTheWords(), JSON.stringify(said)).toEqual([])
      // ⚑ …and no window was ever told to read the other piece working.
      for (const one of work()) expect(one.b, JSON.stringify(said)).toBe('stalled')
    })
  })

  describe('§2 · a turn that names no piece', () => {
    it('⛔ its words compare, nothing moved, and nothing is announced at them', async () => {
      const w = await aWorkerHoldingTwoStalledPieces()
      watched = { worker: w.worker, a: w.a, b: w.b }
      said = []
      const before = rows(w.worker).length
      w.turn.order.claude = true

      // ⚑ A note names no piece, so its turn drives every open piece (`theDriveOf`).
      const words = 'a note for you'
      const noted = await callOn(w.pm, 'message_agent', {
        agent: w.worker,
        text: words,
        kind: 'note',
      })
      expect(noted.outcome, JSON.stringify(noted)).toBe('ok')
      await theWordsLand(w.worker, before, words)

      // ⛔ The premise: Claude's order, and the `working` before the words said both moved.
      const since = rows(w.worker).slice(before)
      expect(since.indexOf('status:working'), since.join(' ')).toBeLessThan(
        since.indexOf('user_turn'),
      )
      expect(
        work().some((one) => one.at === 'status:working'),
        JSON.stringify(said),
      ).toBe(true)
      // 🔴 **THE NEGATIVE**: the words drive both, as the read before them drew — nothing moved.
      expect(stateOf(w.worker, w.a)).toBe('working')
      expect(stateOf(w.worker, w.b)).toBe('working')
      expect(atTheWords(), JSON.stringify(said)).toEqual([])
    })
  })

  describe('§3 · a wake, and the turn of ours after it', () => {
    it('⛔ a wake ends with the flag cleared — a words-first turn after it announces nothing at its words', async () => {
      const w = await aWorkerHoldingTwoStalledPieces()
      // ⚑ The wake's `working` comes with no turn of ours open — exactly what sets the flag.
      await aWake(w.worker, w.a, w.b, w.turn)
      watched = { worker: w.worker, a: w.a, b: w.b }
      said = []
      const before = rows(w.worker).length

      const words = 'go on with the first, after the wake'
      const followed = await callOn(w.pm, 'message_agent', {
        agent: w.worker,
        text: words,
        kind: 'follow-up',
        piece: w.a,
      })
      expect(followed.outcome, JSON.stringify(followed)).toBe('ok')
      await theWordsLand(w.worker, before, words)

      const since = rows(w.worker).slice(before)
      expect(since.indexOf('user_turn'), since.join(' ')).toBeLessThan(
        since.indexOf('status:working'),
      )
      // ⚑ The positive control: the turn's `working` said the first piece moved.
      expect(work().some((one) => one.at === 'status:working' && one.a === 'working')).toBe(true)
      // 🔴 **THE MEASUREMENT** — the wake's ending cleared what its `working` set, so these words,
      // which came first, compare nothing.
      expect(atTheWords(), JSON.stringify(said)).toEqual([])
    })

    it('⚑ …and a turn after a wake in Claude’s order compares once, and draws the other piece stalled', async () => {
      const w = await aWorkerHoldingTwoStalledPieces()
      await aWake(w.worker, w.a, w.b, w.turn)
      watched = { worker: w.worker, a: w.a, b: w.b }
      said = []
      const before = rows(w.worker).length
      w.turn.order.claude = true

      const words = 'go on with the first, after the wake'
      const followed = await callOn(w.pm, 'message_agent', {
        agent: w.worker,
        text: words,
        kind: 'follow-up',
        piece: w.a,
      })
      expect(followed.outcome, JSON.stringify(followed)).toBe('ok')
      await theWordsLand(w.worker, before, words)

      const since = rows(w.worker).slice(before)
      expect(since.indexOf('status:working'), since.join(' ')).toBeLessThan(
        since.indexOf('user_turn'),
      )
      expect(atTheWords(), JSON.stringify(said)).toHaveLength(1)
      expect(atTheWords()[0]).toMatchObject({ a: 'working', b: 'stalled' })
      expect(work().at(-1), JSON.stringify(said)).toMatchObject({ a: 'working', b: 'stalled' })
    })
  })

  describe('§4 · `publishOurs` announces through the compare alone', () => {
    const host_ = codeOf('main/runtime/runtime-host.ts')
    const at = host_.indexOf('private publishOurs(')
    // ⚑ The method's own closing brace — the first line at its indent that is only `}`.
    const body = host_.slice(at, host_.indexOf('\n  }\n', at))

    it('⛔ nothing in it announces directly — no `theWorldMoved`, no other announcing read', () => {
      expect(at, 'publishOurs not found').toBeGreaterThan(0)
      // ⚑ **THE POSITIVE CONTROL for the negatives below**: the slice is the method, whole —
      // its append and the compare after it.
      expect(body).toContain('const written = this.recordOurs(session, event, at)')
      expect(body).toContain('this.emitOurs(session, written)')
      expect(body.indexOf('this.emitOurs(session, written)')).toBeGreaterThan(
        body.indexOf('const written = this.recordOurs(session, event, at)'),
      )
      expect(body).toContain('this.sayWhenItsWorkMoved(')
      // ⛔ Every ledger append passes here (`work-moved-and-nothing-announced-it` §5): an
      // announcement of its own would make each one announce.
      for (const announcer of [
        'theWorldMoved(',
        'deps.announce',
        'announceTheWorkItHolds(',
        'tellWhoeverGaveTheWork(',
        'sayWhetherALevelMovedItsWork(',
      ]) {
        expect(body, `publishOurs calls ${announcer}`).not.toContain(announcer)
      }
    })

    it('🔴 its one compare is behind the flag, after the append, once — and the compare has three callers', () => {
      const guard = "if (event.type === 'user_turn' && session.itsWorkWasReadBeforeItsWords) {"
      const append = body.indexOf('this.emitOurs(session, written)')
      const flag = body.indexOf(guard)
      const compare = body.indexOf(
        'this.sayWhenItsWorkMoved(session.id, this.whatItHolds(session.id))',
      )
      expect(flag, 'the compare lost its guard').toBeGreaterThan(append)
      expect(compare, 'the compare is not behind its guard').toBeGreaterThan(flag)
      expect(body.split('this.sayWhenItsWorkMoved(').length - 1).toBe(1)
      // ⚑ And cleared as it is read, so one turn compares once.
      expect(body.slice(flag, compare)).toContain('session.itsWorkWasReadBeforeItsWords = false')
      // ⚑ **The callers, pinned**: `tellWhoeverGaveTheWork` (after a `turn` or `status` row),
      // `sayWhetherALevelMovedItsWork` (a background level), and this one.
      expect(host_.split('this.sayWhenItsWorkMoved(').length - 1).toBe(3)
    })
  })
})
