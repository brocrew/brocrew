import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { WebContents } from 'electron'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { executeRuntimeCommand, webContentsSink } from '../src/main/runtime/ipc'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { SessionStore as RendererStore } from '../src/renderer/src/lib/session-store'
import {
  RUNTIME_EVENT_CHANNEL,
  RUNTIME_LIVENESS_CHANNEL,
  type ResumableSessionInfo,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type SessionLivenessMessage,
  type UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'
import { asTheWireWouldCarry } from './lib/the-wire'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **418 · two sessions of one agent — what a person actually experiences.**
 *
 * ## Two sessions using one agent
 *
 * > *"I just had an agent create an agent and it works. However, when I asked to create another
 * > agent and then it closed the first one, which I reopened, then tried to open the second agent
 * > and it failed."*
 *
 * Two strings were measured live in his running app by the PM, read-only:
 *
 * ```
 * refused: spawn_agent · profile-already-live · while this holds · retrying may work
 * codex · This conversation is already open in another window. Switch to that window to carry on with it.
 * ```
 *
 * ⛔ **They are two different mechanisms** — one refuses a CREATE, one refuses an OPEN — and this
 * file reproduces both, in one run, through the same chain a person's window goes through.
 * ⚑ **D-016 · the CREATE has no refusal left**: `spawn_agent` and its `profile-already-live` are
 * gone, and a giver's second `give_work` to one agent REACHES the conversation it already has with
 * it (§3, §4) — so the first string is history, and what is measured is that no second one opens.
 *
 * ## ⛔ Why it is a demo test and not a host test
 *
 * ⚠️ **Every rail below already has a host test and every one of them passes.** `the-five-tools.test.ts`
 * proved `profile-already-live` fired (until D-016);
 * `the-conversation-nobody-asked-for.demo.test.ts` proves a `claim` works and that a second window
 * is refused. ⚑ What neither can see is the thing this
 * dispatch is about: **what the LEFT RAIL says about a conversation an agent started, and what the
 * one gesture that rail offers does to it.** That is six links further on, and `172` is what
 * happens when nobody walks them — *"the host held two live conversations, the rail listed one, and
 * every layer in between was behaving exactly as its own tests said it should."*
 *
 * ⛔ **So nothing is stubbed between the provider and the fold.** The chain walked here is:
 *
 * ```
 *   FakeRuntime → RuntimeHost → SQLite ledger → the real `give_work` tool (was `spawn_agent`)
 *     → executeRuntimeCommand (the real IPC boundary, real zod parse) → webContentsSink (production)
 *     → createSessionStore (the committed renderer store) → conversationList (the rail's own fold)
 * ```
 *
 * ⚑ **The provider is the only double**, and the provider is not what is under test: `320`'s split
 * between recording and delivery is, and `336`'s ownership field is, and both are ours.
 *
 * ## 🔴 421 · what these tests say now
 *
 * ⛔ **Eighteen of them were written as characterisation — sentences about what the product does
 * WRONG — and HO-023 §2.3 ruled on four of them.** They were not deleted and they were not
 * weakened: each one is the same chain, driven the same way, asserting that the product now does
 * the right thing. ⚑ **And every one of them is paired with a conversation that genuinely ended**,
 * which still reads `ended` and is still offered Reopen: *"a fix that made every row claimable
 * would pass a careless version of this."*
 *
 * ⚠️ **The `railSections` helper below is where that showed.** The rail drew two lists, from one
 * fold, and a row being in one of them rather than the other was most of the fix.
 *
 * ## ⚑ D-017b · one list, and no word about the process
 *
 * ⛔ **The rail has ONE list now** (`conversation-list.ts`): every conversation, whatever it is
 * doing, says the one state the host derives and — where it is true — that another window has it
 * open. Nothing says whether it runs (`05` rule 5), so *"it closed the first one"* has nothing left
 * to be read off: a live child and a conversation that ended are one kind of row, and one press —
 * *Open the conversation*, `store.look` — opens either (a live one with no window is taken for this
 * window). ⚑ So `421`'s pairs are re-aimed at what the list still says, and the pair that measured
 * the two SECTIONS apart went with them.
 */

/** A `FakeRuntime` per launch over one shared session ledger — the shape a resume needs. */
function sharedRuntime(provider: Provider, sessions: FakeProviderSessions): FakeRuntime {
  return new FakeRuntime(provider, { sessions })
}

/** A promise somebody else resolves — `reopen-while-closing.test.ts`'s helper, same shape. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

/**
 * 🔴 **A handle that announces its ending and then keeps tearing down** — the real order, where the
 * provider says the thread is over well before this app has finished putting it away.
 *
 * ⚠️ **A `Proxy`, for `process-ownership.test.ts`'s reason**: the Fake's state lives in own fields
 * its own methods mutate, so anything that re-homes `this` quietly stops being the session under
 * test. ⛔ It exists here for one assertion — that a CLOSING slot still holds its identity against
 * the give's lookup — and every other test in this file runs without it.
 */
function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

/**
 * One window, as far as the main process can tell — `the-conversation-nobody-asked-for.demo.test.ts`'s
 * double, reused verbatim because the production sink is what must be under test rather than a
 * test's idea of one.
 */
class FakeWindow {
  private destroyed = false
  readonly received: RuntimeEventMessage[] = []
  private onEvent: ((message: RuntimeEventMessage) => void)[] = []
  private onLiveness: ((message: SessionLivenessMessage) => void)[] = []

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, message: unknown): void {
    if (channel === RUNTIME_EVENT_CHANNEL) {
      const event = message as RuntimeEventMessage
      this.received.push(event)
      for (const listener of this.onEvent) listener(event)
    }
    if (channel === RUNTIME_LIVENESS_CHANNEL) {
      for (const listener of this.onLiveness) listener(message as SessionLivenessMessage)
    }
  }

  destroy(): void {
    this.destroyed = true
  }

  bridge(host: RuntimeHost): RuntimeBridge {
    const sink = webContentsSink(this as unknown as WebContents)
    const subscriptions = {
      onEvent: (fn: (message: RuntimeEventMessage) => void) => {
        this.onEvent.push(fn)
        return () => {
          this.onEvent = this.onEvent.filter((listener) => listener !== fn)
        }
      },
      onLiveness: (fn: (message: SessionLivenessMessage) => void) => {
        this.onLiveness.push(fn)
        return () => {
          this.onLiveness = this.onLiveness.filter((listener) => listener !== fn)
        }
      },
    }
    return new Proxy(subscriptions, {
      get: (base, name: string) =>
        name in base
          ? base[name as keyof typeof base]
          : (input?: Record<string, unknown>) => {
              let carried: unknown
              try {
                carried = asTheWireWouldCarry(name, { kind: name, ...(input ?? {}) })
              } catch (refusal) {
                return Promise.reject(refusal as Error)
              }
              return executeRuntimeCommand(
                host,
                sink,
                carried as Parameters<typeof executeRuntimeCommand>[2],
              )
            },
    }) as unknown as RuntimeBridge
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('418 · two sessions of one agent', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  /** ⚠️ `null` unless a test asks for one — a gate installed for the suite would park every close. */
  let closeGate: { promise: Promise<void>; release: () => void } | null
  let windowA: FakeWindow
  let storeA: RendererStore
  let bridgeA: RuntimeBridge
  let sinkA: RuntimeEventSink

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-418-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-418-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 2_000_000
    ledger = createSessionStore(db, tick)
    sessions = new FakeProviderSessions()
    counter = 0
    closeGate = null
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      // Use the provider requested by the reproduction, allowing `codex` rather than
      // substituting the harness’s preference.
      createRuntime: (provider: Provider) => {
        const runtime = sharedRuntime(provider, sessions)
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          const handle = await start(opts)
          const gate = closeGate
          return (gate === null ? handle : holdingItsClose(handle, gate.promise)) as never
        }
        return runtime
      },
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      // ⚠️ **A bound on the MACHINE, not on the rule.** One test parks a teardown on purpose, and
      // the default 5 s drain would be charged to this suite twice for it. Nothing here asserts a
      // timing; the parked teardown is released by the test that installed it.
      closeDrainTimeoutMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    windowA = new FakeWindow(1)
    bridgeA = windowA.bridge(host)
    storeA = createRendererStore(bridgeA)
    // ⚠️ **ONE sink for the window, not one per call.** `sinkOwnerId` is derived from the
    // `webContents`, so two sinks over one window share an owner id — but `closeSessionsForOwner`
    // is asked about that id, and a test that minted a fresh object per gesture would be asserting
    // about an owner it had never really been.
    sinkA = webContentsSink(windowA as unknown as WebContents)
  })

  afterEach(async () => {
    // ⛔ **Released first, or `closeAll` waits on a gate nobody is going to open.**
    closeGate?.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  /**
   * A conversation a PERSON opened in this window, which is what a parent agent is.
   *
   * ⚑ **D-016 · the mode is the giver's AND its child's** — a give starts the child in its giver's
   * mode, and its brief is the child's first turn. ⚠️ In `auto` that turn ends at once and the
   * child is idle, as a spawned child was; in `ask` it parks on the Fake's card, so its piece is
   * still being worked on — which is what a SECOND give to it needs (§3, §4), since a child whose
   * turn ended with the piece open refuses one (`its-work-has-stalled`).
   */
  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'codex', profileId, cwd: work, approvalMode },
      sinkA,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, sinkA)
  }

  /** The toolset one session is offered, called the way a provider would call it. */
  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown>) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return answered.structured as Record<string, unknown>
    }
  }

  /**
   * ⚑ **D-016 · a give from `parent` to `worker`**, through the real tool — the answer, whole.
   */
  const gives = async (parent: string, title = 'x'): Promise<Record<string, unknown>> => {
    const given = await toolsOf(parent)('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title,
      brief: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return given
  }

  /**
   * ⚑ **D-016 · the child a give started, once its brief's turn is over** — in its giver's `auto`,
   * so it is idle, as a spawned child was, and nothing more is being written to its ledger.
   */
  const anIdleChildOf = async (parent: string, title = 'x'): Promise<string> => {
    const child = (await gives(parent, title)).agent as string
    await waitFor(
      () =>
        ledger.events(child).some((one) => one.event.type === 'turn') &&
        host.unclaimedSessions().some((one) => one.sessionId === child) &&
        ledger.find(child)?.status === 'idle',
      'the brief’s turn to end',
    )
    return child
  }

  /** ⚑ **D-016 · the child a give started, parked on its brief's card** — its giver is in `ask`. */
  const aParkedChildOf = async (parent: string, title = 'one'): Promise<string> => {
    const child = (await gives(parent, title)).agent as string
    await waitFor(
      () => ledger.events(child).some((one) => one.event.type === 'permission_request'),
      'the brief’s turn to park on its card',
    )
    return child
  }

  /**
   * 🔴 **The rail's own two lists, through the real IPC boundary** — not `host.resumableSessions()`
   * read directly. `SideRail.refreshClosed` calls exactly these two and nothing else.
   */
  const railLists = async (): Promise<{
    resumable: ResumableSessionInfo[]
    unresumable: UnresumableSessionInfo[]
  }> => {
    const [resumable, unresumable] = await Promise.all([
      bridgeA.listResumable(),
      bridgeA.listUnresumable(),
    ])
    return { resumable, unresumable }
  }

  /**
   * ⚑ **D-017b · the rail's ONE list, as the rail draws it from the host** — `conversationList` over
   * exactly the two lists `SideRail.refreshListed` reads, minus the conversations THIS WINDOW is fed
   * (`store.live`), which the rail draws from their own records instead. ⛔ No sections, and no
   * refusal on a row: a press that fails says so in the window, not on the list.
   *
   * 🔴 **It was `closedThreads` split into two sections until D-017b** (421, HO-023 §2.3):
   * *"Not open in this window"* and *"Closed conversations"*.
   */
  const railList = async () => {
    const { resumable, unresumable } = await railLists()
    const fed = new Set(storeA.live.value.map((record) => record.sessionId))
    return conversationList({ resumable, unresumable }).filter((row) => !fed.has(row.sessionId))
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · an agent creates an agent, and the person's rail says what it is
  //
  // 🔴 **421 · this section asserted the opposite until HO-023 §2.3 ruled on it.** The titles below
  // carry the old sentence in the comments, because the point of a characterisation test surviving
  // its own fix is that the defect it named stays readable.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · what the rail says about a conversation an agent started', () => {
    it('🔴 a LIVE agent-started conversation is a row of the one list, and says nothing is over', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()

      const child = await anIdleChildOf(parent, 'do the thing')

      // ⛔ **It is running.** The host holds it, its provider is alive, and nothing has ended it.
      expect(host.sessionIds).toContain(child)
      expect(ledger.find(child)?.status).not.toBe('ended')

      // ⛔ **…and nobody owns it**, because a give's start passes no sink.
      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(child)
      expect(host.unclaimedSessions()).toMatchObject([{ sessionId: child, running: true }])

      // 🔴 **The rail.** The person's window does not own it, so the rail draws it from the host —
      // and until `421` the section it landed in was the one headed *"Closed conversations"*. ⚑
      // **D-017b · there are no sections**: it is a row of the one list, like every other.
      const rail = await railList()
      const row = rail.find((one) => one.sessionId === child)
      expect(row).toBeDefined()

      // ⚑ **And it does NOT say the conversation is over**, nor that it runs: the row carries the one
      // state the host says of it — nothing is happening in it — and no process fact at all.
      expect(row!.state).toEqual({ is: 'idle' })
      expect(row).not.toHaveProperty('running')
      // ⛔ **Nor another window**: no window holds it, and `418`'s false sentence named one.
      expect(row!.inAnotherWindow).toBe(false)

      // ⚠️ **The control, planted the other way round.** A conversation the person's own window is
      // fed is not drawn from the host at all — the rail draws it from its own record — although the
      // host, which cannot tell which window holds it, lists it as open in a window.
      expect(rail.map((one) => one.sessionId)).not.toContain(parent)
      const { resumable, unresumable } = await railLists()
      expect(
        conversationList({ resumable, unresumable }).find((one) => one.sessionId === parent)
          ?.inAnotherWindow,
      ).toBe(true)

      // ⚑ **…and the OTHER control**: a conversation that really did end is in the SAME list, as the
      // same kind of row — ⛔ never drawn as ended, since D-017b: a message continues it.
      const over = await personOpens('worker')
      await host.close(over, sinkA)
      const ended = (await railList()).find((one) => one.sessionId === over)
      expect(ended).toBeDefined()
      expect(ended!.state).toEqual({ is: 'idle' })
      expect(ended!.inAnotherWindow).toBe(false)
    })

    it('🔴 the wire carries what the app is DOING with the row, and the fold reads it', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()
      const child = await anIdleChildOf(parent)

      // 🔴 **`421` put the answer on the wire, and `418` was wrong about why it was not needed.**
      // This file said *"a fix needs no new field: `ResumableSessionInfo` already carries `status`
      // and `profileId`"*. ⛔ `status` is a COLUMN: `settleOrphanRuns` settles a crashed run to
      // `idle`, and a conversation that was open and idle when the app died keeps the `idle` it
      // had — so a rail keyed on it would call every row a power cut left behind *"running"*.
      const { resumable } = await railLists()
      const row = resumable.find((one) => one.sessionId === child)
      expect(row).toBeDefined()
      expect(row!.profileId).toBe('worker')
      expect(row!.running).toBe('unwatched')

      // ⛔ **The pair the column cannot tell apart, in one assertion.** This row and the one below
      // both read `idle`; the app is running one of them and has never run the other.
      const neverRan = 'sess_never_ran'
      ledger.create({
        id: neverRan,
        provider: 'codex',
        cwd: work,
        approvalMode: 'ask',
        profileId: 'worker',
      })
      const stale = (await railLists()).unresumable.find((one) => one.sessionId === neverRan)
      expect(stale).toBeDefined()
      expect(stale!.status).toBe(row!.status)
      expect(stale!.status).toBe('idle')
      expect(stale!.running).toBe('not-running')

      // 🔴 **And `conversationList` reads the ONE STATE, not the process** (D-017b): both rows are in
      // the one list, and neither carries the `running` the wire told apart — the list is the rail,
      // and the rail says nothing about whether a process runs (`05` rule 5).
      const rail = await railList()
      for (const id of [child, neverRan]) {
        const listed = rail.find((one) => one.sessionId === id)
        expect(listed, `${id} is not in the one list`).toBeDefined()
        expect(listed).not.toHaveProperty('running')
        expect(listed!.inAnotherWindow).toBe(false)
      }

      // ⚠️ **The other pair**: a conversation whose recorded status really IS terminal is in the
      // same list too — the ledger says it ended, and the row says the one state.
      const ended = await personOpens('other-one')
      await bridgeA.close({ sessionId: ended })
      const dead = (await railList()).find((one) => one.sessionId === ended)
      expect(dead).toBeDefined()
      expect(dead!.state).toEqual({ is: 'idle' })
      expect(ledger.find(ended)?.status).toBe('ended')
    })

    /**
     * The unified list gives stopped and ended rows the same full-view opening press, without
     * a separate plate, gesture, or note distinguishing them. There is no remaining field for
     * that old pair to compare.
     */
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · pressing the row — the second measured string, and the window it names
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what pressing that row does', () => {
    it('🔴 the reopen is no longer offered — and when it is asked for, the sentence is true', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()
      const child = await anIdleChildOf(parent)

      // ⛔ **The rail's press does not reach `store.resume` for this row any more** — ⚑ D-017b: it
      // is `store.look`, which takes a conversation running with no window for this one. The reopen
      // is still a door (`RuntimeBridge.resume`), so the sentence it refuses with still has to be
      // true.
      const opened = await storeA.resume(child)
      expect(opened).toBeNull()
      // ⚑ **D-017b** — it named *"open it here"*, false of a person already looking at it in a
      // window that does not hold it; the gesture it names now is the row's press.
      expect(storeA.resumeError.value).toBe(
        'No window holds this conversation, so nothing was done to it. Take it over by pressing its row, then send to it or answer it.',
      )

      // 🔴 **What `418` measured here, and why it was a lie.** The sentence was *"This conversation
      // is already open in another window. Switch to that window to carry on with it."* ⛔ The
      // slot's owner is `null` — the host's own diagnostic for it is literally *"nobody — it was
      // created without a surface"* — so it named a window to switch to that does not exist and
      // cannot be made to exist by switching.
      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(child)
      expect(storeA.resumeError.value).not.toContain('another window')

      // ⚑ **The control: a conversation another window really does hold still reads that
      // sentence.** Same window, same call, one fact different — which is what makes the assertion
      // above about the owner rather than about the words having been softened everywhere.
      const windowB = new FakeWindow(2)
      const sinkB = webContentsSink(windowB as unknown as WebContents)
      const theirs = await host.createSession(
        { provider: 'codex', profileId: 'other-one', cwd: work, approvalMode: 'ask' },
        sinkB,
      )
      await expect(host.resumeSession(theirs.sessionId, sinkA)).rejects.toThrow(
        /already open in another window/,
      )

      // 🔴 **And the row a person is looking at while that happens**: ⚑ D-017b — the one list says
      // another window has a conversation only where one does, so the child's row names no window
      // and window B's does.
      const rail = await railList()
      expect(rail.find((one) => one.sessionId === child)?.inAnotherWindow).toBe(false)
      expect(rail.find((one) => one.sessionId === theirs.sessionId)?.inAnotherWindow).toBe(true)
      // ⚠️ **A refusal no longer lands on the row** (`151`'s note order went with the closed list's
      // note): the window says it where the press was made (`RuntimeScreen.openConversation`).
    })

    it('🔴 a person’s Close on a conversation nobody holds names a remedy that WORKS', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()
      const child = await anIdleChildOf(parent)

      // ⛔ **421 §2.1's second question, answered and asserted.** The honest policy for a person's
      // Close on a conversation nobody holds is *claim it first* rather than *a person may always
      // close what nobody holds*: `mayControl` answers three questions at once (`340`) — who may
      // drive it, whose stream it is, and whose departure ends it — so admitting every window to an
      // unowned conversation would hand a stranger window the send and the approval on a
      // conversation an agent is commanding, and would make that window's reload end it.
      const refusal = await bridgeA
        .close({ sessionId: child })
        .then(() => 'it was allowed')
        .catch((error: Error) => error.message)
      // ⚑ **D-017b** — *"not open in any window"* became *"No window holds this conversation"*.
      expect(refusal).toContain('No window holds this conversation')
      expect(refusal).not.toContain('another window')
      expect(host.sessionIds).toContain(child)

      // 🔴 **And the remedy the sentence names is one call away and it works** — which is the whole
      // difference from `418`, where the named remedy was *"switch to that window"*. A refusal
      // whose way forward cannot be taken is a refusal that teaches a person to quit the app.
      expect(await storeA.claim(child)).toBe(true)
      await bridgeA.close({ sessionId: child })
      expect(host.sessionIds).not.toContain(child)
      // ⚑ …and the ledger says a PERSON did it, which is `418` §5's discriminator still standing.
      const kinds = ledger.events(child).map((one) => one.event.type)
      expect(kinds).toContain('user_command')
      expect(kinds).not.toContain('work_interrupted')
    })

    it('⚑ the door that DOES work is the take-over, and the rail’s one press is the one that makes it', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      await storeA.attachOpen()
      const child = await anIdleChildOf(parent)

      // ⛔ **The paired positive.** The same window, the same id, one method over — and the
      // conversation opens. So the refusal above is about which door was knocked on, not about
      // whether this person may have this conversation.
      //
      // 🔴 **And the rail knocks on this one** — ⚑ D-017b: the row's one press is `store.look`, a
      // PRESS (`claim: true`), which takes a conversation running with no window for this window
      // and opens it — the same take-over `goToQuestion` has made for the escalated queue since
      // `401`, reached from the row's one gesture.
      const before = (await railList()).find((one) => one.sessionId === child)
      expect(before?.inAnotherWindow).toBe(false)
      expect(await storeA.look(child)).toBe(child)
      expect(storeA.live.value.map((one) => one.sessionId)).toContain(child)
      expect(host.unclaimedSessions().map((one) => one.sessionId)).not.toContain(child)

      // ⚑ …and now that it is owned, the rail draws it from its own record, not from the host: it is
      // this window's conversation.
      const rail = await railList()
      expect(rail.map((one) => one.sessionId)).not.toContain(child)
      // ⛔ **Host-side too, and not only through `hideOpen`**: the list command itself now says a
      // window has it, so a second window's rail would read *"open in another window"* rather than
      // offering to take over a conversation that has just been taken.
      const seen = (await railLists()).resumable.find((one) => one.sessionId === child)
      expect(seen?.running).toBe('in-a-window')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the first measured string — the CREATE refusal, and what D-016 put in its place
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-016 · the second create is not refused any more — it REACHES.** `spawn_agent` and its
   * `profile-already-live` are gone: a giver's give to an agent goes to the one conversation it
   * already has with that agent (R2 step 5), so there is no second conversation to refuse and no
   * sentence left to measure. ⛔ What `418`'s first string was about — two conversations of one
   * agent under one parent — is measured below as the thing that no longer happens. ⚑ The case
   * about the sentence's advertised remedy (*"message the blocker"*) went with the sentence.
   */
  describe('§3 · the second give, and the conversation it reaches', () => {
    it('🔴 a PARENT’s second give to one agent goes to the SAME conversation, held behind its turn', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const first = await aParkedChildOf(parent, 'one')

      const second = await gives(parent, 'two')
      // ⛔ **No second conversation** — the same id, nothing started, and the brief waits for the
      // turn the first one is still in (its card).
      expect(second.agent).toBe(first)
      expect(second.started).toBe(false)
      expect(second.delivery).toBe('held')
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([first])
      // ⚑ **Two pieces, one holder**, in the order they were given.
      expect(ledger.piecesGivenBy(parent).map((one) => [one.owner, one.title])).toEqual([
        [first, 'one'],
        [first, 'two'],
      ])
    })

    it('⚑ 428 · a PERSON’s conversation of that agent is never the one a give reaches — and is still not this caller’s', async () => {
      await bringIdentityIntoBeing('worker')

      // ⛔ **A person is talking to `worker` by hand** — the shipped rail test's own scenario
      // (`the-rails-before-anything-can-reach-them.test.ts` §1), and the one the incident is most
      // likely to have been.
      const theirs = await personOpens('worker')

      const parent = await personOpens('pm')
      const call = toolsOf(parent)

      // 🔴 **The give starts the parent's OWN** (HO-023 §4's key, kept by D-016): the lookup is the
      // giver's children, so a conversation this caller did not start is never the one reached.
      const mine = await aParkedChildOf(parent, 'mine')
      expect(mine).not.toBe(theirs)
      expect(host.sessionIds).toContain(theirs)
      expect(host.sessionIds).toContain(mine)

      // ⚠️ **The entitlement fact itself is UNCHANGED, and that is the point.** This caller still
      // may not hand its work to a person's conversation: ⚑ **D-016** — a follow-up names the piece
      // it is about, and one given to another conversation is refused there.
      const [piece] = ledger.piecesGivenBy(parent)
      const said = await call('message_agent', {
        agent: theirs,
        text: 'carry on with mine',
        kind: 'follow-up',
        piece: piece!.label,
      })
      expect(said).toMatchObject({ outcome: 'refused', rail: 'not-a-piece-you-gave' })
      expect(host.sessionIds).toContain(theirs)

      // ⛔ **The control, or this test measures the lookup being deleted rather than keyed.** The
      // parent giving a SECOND time reaches the one it just opened — not either of the
      // conversations it cannot reach — and the follow-up goes there.
      expect((await gives(parent, 'a second')).agent).toBe(mine)
      expect(
        await call('message_agent', {
          agent: mine,
          text: 'carry on with mine',
          kind: 'follow-up',
          piece: piece!.label,
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('⛔ a STOP opens no second conversation either — the give goes to the one it stopped', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const first = await aParkedChildOf(parent, 'one')
      // ⚠️ **D-016c · the child answers its piece before it is stopped.** A stop moves no piece, so
      // a piece the Close's interrupted turn left open stalls, and a give to its holder is refused
      // `its-work-has-stalled` until it is answered, closed or taken back. ⚑ Answered here by the
      // holder, in the turn it is parked in, so nothing is held for its next start.
      const [one] = ledger.piecesGivenBy(parent)
      expect(
        await toolsOf(first)('reply_to_parent', {
          piece: one!.piece,
          outcome: 'done',
          summary: 'one is done',
        }),
      ).toMatchObject({ outcome: 'ok' })

      // 🔴 **Until D-017 the way past `profile-already-live` was to DESTROY the conversation holding
      // it** — `end_agent`. ⚑ **D-017 closed that door, and D-016 took the refusal**: a STOP — here
      // the app's own close, the stop no agent can ask for — leaves the conversation the one a give
      // to that agent finds (R2 step 5), so nothing opens a second one beside it.
      await host.close(first, THE_APP_ITSELF)
      expect(host.sessionIds).not.toContain(first)

      const retried = await toolsOf(parent)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'two',
        brief: 'two',
      })
      // ⚑ **The same conversation, started again for the brief** — no second one beside it.
      expect(retried).toMatchObject({ outcome: 'ok', agent: first, started: false })
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([first])
    })

    it('🔴 the arrow can run the OTHER way: a CLOSING conversation is still the one a give finds', async () => {
      closeGate = deferred()
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const call = toolsOf(parent)
      const first = await aParkedChildOf(parent, 'one')
      // ⚠️ **D-016c · the child answers its piece before it is stopped**, as in the case above: a
      // piece the stop's interrupted turn left open would refuse the give after the stop
      // `its-work-has-stalled`.
      const [one] = ledger.piecesGivenBy(parent)
      expect(
        await toolsOf(first)('reply_to_parent', {
          piece: one!.piece,
          outcome: 'done',
          summary: 'one is done',
        }),
      ).toMatchObject({ outcome: 'ok' })

      // ⚠️ **The PERSON still cannot close it, and the sentence no longer names a window that is
      // not there** (421). `assertMayControl` refused `not-yours` for a `null` owner — *"This
      // conversation belongs to another window… Switch to that window"* — so of the three things a
      // person could do to an agent-started conversation, two were refused by sentences naming a
      // window that does not exist and the third had no gesture. ⛔ **The refusal is kept and the
      // policy is stated: take it over, then close it.** Widening `mayControl` for a null owner
      // would have handed every window the send, the approval and the interrupt on a conversation
      // an agent is commanding, and would have made a reload end it. The remedy it names is
      // exercised in §2's own test, two blocks up. ⚑ **D-017b** — the sentence says *"No window
      // holds this conversation"* now.
      await expect(bridgeA.close({ sessionId: first })).rejects.toThrow(
        'No window holds this conversation, so nothing was done to it.',
      )

      // ⛔ **So it is stopped, and the teardown parks.** This is the ordinary shape rather than an
      // exotic one: the provider says the thread is over well before this app has finished putting
      // it away, and `close()` resolves only after the slot has left the map. ⚑ **D-017** — the
      // parent's `end_agent` stopped it here, and is gone; the app's own close is the same teardown.
      const ending = host.close(first, THE_APP_ITSELF)

      // 🔴 **Waited on the LEDGER, and that is what puts the hazard on the path.** The gated handle
      // emits its ending and THEN parks, so a ledger that holds the ending is a slot this host has
      // begun tearing down.
      await waitFor(
        () => ledger.events(first).some((one) => one.event.type === 'status'),
        'the provider to announce its ending while the teardown is parked',
      )
      expect(host.sessionIds).toContain(first)

      const during = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'two',
        brief: 'two',
      })
      // 🔴 **A give issued while the first one is going away is refused, and it names the
      // conversation that is ALREADY ENDING** — the lookup found it, and two runs of one
      // conversation must never overlap, so it is asked again once the teardown settles.
      expect(during).toMatchObject({
        outcome: 'refused',
        rail: 'that-conversation-is-still-stopping',
        retryable: true,
        detail: { agent: first },
      })

      closeGate.release()
      await ending
      const afterTheStop = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'three',
        brief: 'three',
      })
      // ⚑ **D-017 · R15 — and once it has stopped it is STILL the one a give finds**: the same call
      // now reaches it and starts it again, and nothing opens a second one.
      expect(afterTheStop).toMatchObject({ outcome: 'ok', agent: first, started: false })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · how narrow the lookup is — the parent it is keyed on, and the doors it does not stand in
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · one identity, many conversations, and the doors the lookup does not stand in', () => {
    it('⚑ 428 · two PARENTS each get their own conversation of one identity', async () => {
      await bringIdentityIntoBeing('worker')

      const here = await personOpens('pm')
      const mineHere = await aParkedChildOf(here, 'the work here')

      // 🔴 **A second PM conversation giving to the same identity** — and HO-023 §4 says this is
      // demand rather than forgetting: *"Two different parents, in the same project or different
      // ones."* ⚠️ **D-016 took the second project this pair used to stand in.**
      const overThere = await personOpens('pm')
      const mineThere = await aParkedChildOf(overThere, 'the work over there')

      // ⛔ **Two live conversations of one identity, one per parent, each commanded by the parent
      // that gave it work.**
      expect(mineThere).not.toBe(mineHere)
      expect(host.sessionIds).toContain(mineHere)
      expect(host.sessionIds).toContain(mineThere)

      // ⚑ **The control: the lookup is about the PARENT.** The same parent over there giving again
      // reaches the child it just opened.
      expect((await gives(overThere, 'a second over there')).agent).toBe(mineThere)
    })

    it('⚑ a PERSON may open a second conversation of one identity — the lookup is an agent’s only', async () => {
      await bringIdentityIntoBeing('worker')

      // ⛔ **No lookup stands here.** `createSession` is not a give: it is what a person's
      // New-conversation page calls.
      const first = await personOpens('worker')
      const second = await personOpens('worker')
      expect(second).not.toBe(first)

      // 🔴 **Two live sessions of one agent, which is this dispatch's title, reached by hand.**
      expect(host.sessionIds).toContain(first)
      expect(host.sessionIds).toContain(second)

      // ⚠️ **The paired case, one caller over.** The two the person opened are never the one a give
      // reaches (`428`, HO-023 §4), so the agent's first give starts a THIRD live conversation of
      // one identity, two by hand and one by an agent — and its second reaches that third one.
      const parent = await personOpens('pm')
      const mine = await aParkedChildOf(parent, 'a third')
      expect([first, second]).not.toContain(mine)
      const again = (await gives(parent, 'a fourth')).agent
      expect(again).toBe(mine)
      expect([first, second]).not.toContain(again)
    })

    it('🔴 …and REOPENING one is ungated too — which is the person’s step 4, exactly', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')

      // Stop the first child, then reopen it. The app’s own close supplies the stop formerly
      // performed through `end_agent`.
      const first = await aParkedChildOf(parent, 'one')
      await host.close(first, THE_APP_ITSELF)
      expect(host.sessionIds).not.toContain(first)

      // 🔴 **He reopens the first, and NOTHING refuses it.** The open path resolves `profileId`
      // three times and compares it to nothing: the give's lookup is asked by the give alone.
      expect(await storeA.resume(first)).toBe(first)

      // ⚑ **…and it is the ONE conversation of that identity this parent has**: a give now reaches
      // it — the state two conversations of one agent were is not reachable through the door that
      // does not stand in the lookup.
      expect(host.sessionIds).toContain(first)
      const second = await toolsOf(parent)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'two',
        brief: 'two',
      })
      // ⚑ **The give FINDS it** — the stall is named only for a conversation the lookup found — and
      // the piece the stop left open is named to it, so nothing opens beside it.
      expect(second).toMatchObject({
        outcome: 'ok',
        agent: first,
        stalled: [ledger.piecesGivenBy(parent)[0]?.label],
      })
      expect(host.sessionIds.filter((id) => id !== parent)).toEqual([first])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · 🔴 who closed it — the question this dispatch cares most about
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what ends a live conversation, and what the ledger says about who did', () => {
    /** The ledger's event kinds for one session, in order. */
    const kinds = (sessionId: string): string[] =>
      ledger.events(sessionId).map((one) => one.event.type)

    it('⛔ a second give to the same agent ends NOTHING — it is held for the one conversation', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const child = await aParkedChildOf(parent, 'one')
      const before = kinds(child)
      // ⚑ **Paired with a positive over the same list**, so “nothing was added” cannot pass
      // because the reader is broken — the way `the-five-tools.test.ts` records it passing once.
      expect(before.length).toBeGreaterThan(0)

      // ⚑ **D-016** — where `profile-already-live` refused, the give reaches this conversation.
      expect((await gives(parent, 'two')).agent).toBe(child)

      // 🔴 **The direct answer to *“did the app close it to make room?”* — no.** The conversation
      // the give reached is still held and still running, nothing before the give was rewritten,
      // and all it gained is the brief held for it and the piece written down beside it.
      expect(host.sessionIds).toContain(child)
      expect(ledger.find(child)?.status).not.toBe('ended')
      expect(kinds(child).slice(0, before.length)).toEqual(before)
      expect(kinds(child).slice(before.length).sort()).toEqual(['message_queued', 'work_given'])
      expect(kinds(child)).not.toContain('work_interrupted')
    })

    it('⛔ a REFUSED reopen of a live child ends nothing either', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      const child = await anIdleChildOf(parent)
      await waitFor(
        () =>
          ledger
            .reconciliationReceiptsForOwner(child)
            .some((row) => row.step === 'giver' && row.outcome === 'delivered'),
        'the existing holder ladder to finish its giver delivery',
      )
      const before = kinds(child)
      // ⚑ **Paired with a positive over the same list**, so “nothing was added” cannot pass
      // because the reader is broken — the way `the-five-tools.test.ts` records it passing once.
      expect(before.length).toBeGreaterThan(0)

      expect(await storeA.resume(child)).toBeNull()

      expect(host.sessionIds).toContain(child)
      expect(kinds(child)).toEqual(before)
    })

    it('🔴 when an AGENT ends a conversation the ledger names it, and a person’s close does not', async () => {
      await bringIdentityIntoBeing('other')
      // ⚑ **D-017 · commit 3 — the AGENT half went with `end_agent`**: nothing an agent calls stops
      // a conversation any more, so there is no agent-ended ledger to name one. ⚑ The person's
      // half stands, and it is still the discriminator it was: a PERSON's close carries no
      // `work_interrupted` at all — it carries the OTHER breadcrumb, `user_command`, written by
      // `ipc.ts`'s `close` arm and by nothing else.
      const byPerson = await personOpens('other')
      await bridgeA.close({ sessionId: byPerson })
      expect(kinds(byPerson)).toContain('user_command')
      expect(kinds(byPerson)).not.toContain('work_interrupted')
      expect(ledger.find(byPerson)?.status).toBe('ended')
    })

    it('🔴 the ONE ending nobody asked for: the window that STARTED a conversation going away', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm', 'auto')
      const child = await anIdleChildOf(parent)
      expect(await storeA.claim(child)).toBe(true)

      // ⚠️ **A renderer RELOAD is this call**, not only a window being closed — `index.ts:919`
      // wires it to `SESSION_RELEASE_EVENTS`, whose own comment says *"closed, crashed, or reloaded
      // into a renderer that has forgotten them"*. ⛔ So in a dev build every HMR reload of the
      // renderer ends every conversation that window STARTED, with nobody having asked.
      windowA.destroy()
      await host.closeSessionsForOwner('webContents:1')

      // 🔴 **The conversation the PERSON started is gone.**
      expect(host.sessionIds).not.toContain(parent)
      expect(ledger.find(parent)?.status).toBe('ended')
      // ⛔ **…and NEITHER breadcrumb is there**, which is the third reading of the discriminator and
      // the one that answers `418` §2 from a database alone: no `user_command` means no person
      // pressed Close, no `work_interrupted` means no agent asked — so what is left is the app.
      expect(kinds(parent)).not.toContain('work_interrupted')
      expect(kinds(parent)).not.toContain('user_command')

      // ⚑ **The paired positive, and it is 336's rule holding.** The conversation this window only
      // CLAIMED was born without a surface, so the departure takes back the claim and nothing else
      // — it is still running with nobody watching.
      expect(host.sessionIds).toContain(child)
      expect(host.unclaimedSessions().map((one) => one.sessionId)).toContain(child)
      expect(ledger.find(child)?.status).not.toBe('ended')
    })
  })
})
