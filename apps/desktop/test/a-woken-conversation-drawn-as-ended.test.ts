import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionHandle, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { SessionStore as RendererStore } from '../src/renderer/src/lib/session-store'
import { refold, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { isAwaitingAnswer, type TranscriptState } from '../src/renderer/src/lib/transcript'
import type {
  ResumedSession,
  RuntimeBridge,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
// ⚑ **673 · Claude's resume shape lives in the shared double now** — moved from here, with the two
// changes named in its header (`send` passes every argument; a question's ids are renamed too).
import { claudeOnAResume, type ResumeControl } from './lib/provider-double'

/**
 * 🔴 **653 · a woken conversation drawn as ended.**
 *
 * ⛔ **`652` F1, and it was wider than `652` said.** A hand-over marked `attached` means *"nothing
 * was resumed here"*, and the renderer took that as *"there is no previous life on this page"* — so
 * it applied no reopen correction. But the RUNNING life of an attached conversation can itself have
 * been a reopen, and then the page holds both lives:
 *
 *  The cases include a conversation woken without a window and then claimed by a person
 *  (§1.1), and one reopened in a window whose store is rebuilt by Vite HMR without navigation
 *  (§1.3). A real ⌘R takes a different path: `did-navigate` closes what the window started
 *  (`window-navigation.ts`, `SESSION_RELEASE_EVENTS`).
 *
 * ⚑ **On Claude the new life says nothing until its first turn's `system/init`**, so between the wake
 * and that turn the page ENDED with the previous life's `session: ended` — and a person was drawn a
 * conversation that had ended. ⚠️ Since `673` the host's `reopened` is the page's last row there; it
 * draws nothing, so the drawing is the same. The fix is a field on the hand-over, `liveFrom`, saying where the
 * running life began, and the renderer crossing the epoch there instead of nowhere.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real rails, the REAL renderer store**, over a
 * window whose bridge structured-clones every ANSWER as `ipcRenderer.invoke` does — `the-wire.ts`
 * clones only arguments, so a field that did not survive the trip back would pass there and fail
 * here. The provider is the only double: `FakeRuntime`, made to behave like Claude on a resume
 * (silent until the first turn), and able to CRASH (its stream goes quiet, so the ledger keeps no
 * ending — the only way a previous life's card is still open on the page).
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/** ⚠️ **A process that dies**: once `crashed`, the stream carries nothing, so no ending is recorded. */
interface CrashSwitch {
  crashed: boolean
}
function canCrash(handle: SessionHandle, crash: CrashSwitch): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return () => ({
          async *[Symbol.asyncIterator]() {
            for await (const event of target.events()) if (!crash.crashed) yield event
          },
        })
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

class ClaudeLikeRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly toolsets: AgentToolset[],
    sessions: FakeProviderSessions,
    private readonly crash: CrashSwitch,
    private readonly control: ResumeControl,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.toolsets.push(options.agentTools)
    return canCrash(handle, this.crash) as Awaited<ReturnType<FakeRuntime['start']>>
  }
  override async resume(
    ref: Parameters<FakeRuntime['resume']>[0],
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.toolsets.push(options.agentTools)
    return claudeOnAResume(handle, this.control) as Awaited<ReturnType<FakeRuntime['resume']>>
  }
}

/**
 * How the wire this window stands at carries a hand-over back.
 *
 * - `as-shipped` — what this dispatch ships.
 * - `without-the-seam` — the hand-over with `liveFrom` taken off: **the incumbent's wire**, which is
 *   the planted control for every "no longer drawn ended" assertion below.
 * - `as-resumed` — the hand-over re-labelled `resumed`: **the repair the brief ruled out** (the
 *   correction at the END of the page), the control for "a card this life raised survives".
 */
type Wire = 'as-shipped' | 'without-the-seam' | 'as-resumed'

/** ⛔ One window's two ends, the way the preload builds them — `what-approving…`'s `Window`. */
class Window {
  readonly sink: RuntimeEventSink
  /** Every hand-over this window was answered with, AFTER the clone. */
  readonly handed: ResumedSession[] = []
  /**
   * ⚑ **Something that happens after the host has answered a claim and before the renderer reads
   * the answer** — the round trip's own gap, made deterministic. The host has already swapped the
   * sink, so the conversation's next events reach this window inside it.
   */
  inTheGap: (() => Promise<void>) | null = null
  /** Every event this window was sent, in order. */
  readonly received: RuntimeEventMessage[] = []
  private listeners: ((message: RuntimeEventMessage) => void)[] = []

  constructor(
    private readonly host: RuntimeHost,
    readonly ownerId = 'webContents:1',
    private readonly wire: Wire = 'as-shipped',
  ) {
    const listeners = (): ((message: RuntimeEventMessage) => void)[] => this.listeners
    this.sink = {
      ownerId,
      aPersonIsBehindIt: true,
      get alive() {
        return true
      },
      send: (message) => {
        this.received.push(message)
        listeners().forEach((listener) => listener(message))
      },
      sendLiveness: () => {},
    }
  }

  private carry(handed: ResumedSession): ResumedSession {
    if (this.wire === 'as-shipped') return handed
    const without: ResumedSession = { ...handed }
    delete (without as { liveFrom?: number }).liveFrom
    return this.wire === 'as-resumed' ? { ...without, handover: 'resumed' } : without
  }

  bridge(): RuntimeBridge {
    const run = async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> => {
      const answered = await executeRuntimeCommand(this.host, this.sink, {
        kind,
        ...input,
      } as Parameters<typeof executeRuntimeCommand>[2])
      // 🔴 **The ANSWER crosses too** — `ipcRenderer.invoke` clones what comes back, and a field
      // that did not survive would be read here as absent, exactly as the shipped renderer would.
      return structuredClone(answered) as T
    }
    const kept = (handed: ResumedSession): ResumedSession => {
      const carried = this.carry(handed)
      this.handed.push(carried)
      return carried
    }
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run('createSession', { ...input }),
      resume: async (input) => kept(await run<ResumedSession>('resume', { ...input })),
      // ⚑ **D-017b** — a record whose fold ends is looked at again, through this door. ⚠️ Not
      // `kept`: {@link handed} is the claims' and the reopens' record, and a look is neither.
      look: (input) => run('look', { ...input }),
      claim: async (input) => {
        const answered = await run<ResumedSession>('claim', { ...input })
        if (this.inTheGap !== null) await this.inTheGap()
        return kept(answered)
      },
      attachOpen: async () => (await run<ResumedSession[]>('attachOpen')).map(kept),
      onEvent: (fn) => {
        this.listeners.push(fn)
        return () => {
          this.listeners = this.listeners.filter((one) => one !== fn)
        }
      },
      onLiveness: () => () => {},
    }
    return everythingOverTheWire(bridge) as RuntimeBridge
  }
}

describe('653 · a woken conversation drawn as ended', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let toolsets: AgentToolset[]
  let issued: FakeProviderSessions
  let crash: CrashSwitch
  let control: ResumeControl
  /** Lets a paused woken turn go on — kept so the teardown can always release it. */
  let releaseTheTurn: () => void
  let counter: number
  let clock: number
  const tick = (): number => clock++

  const buildHost = (over: SessionStore): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ClaudeLikeRuntime(provider, toolsets, issued, crash, control),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-653-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-653-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    ledger = createSessionStore(db, tick)
    counter = 0
    hosts = []
    toolsets = []
    issued = new FakeProviderSessions()
    crash = { crashed: false }
    control = { pause: null, renameIds: true }
    releaseTheTurn = () => {}
    host = buildHost(ledger)
  })

  afterEach(async () => {
    crash.crashed = false
    releaseTheTurn()
    for (const built of hosts) await built.closeAll()
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

  /** ⚑ Hold the next woken turn right after its first `working` — see {@link ResumeControl}. */
  const holdTheWokenTurn = (): void => {
    let release!: () => void
    control.pause = new Promise<void>((resolve) => {
      release = resolve
    })
    releaseTheTurn = () => {
      control.pause = null
      release()
    }
  }

  /** ⛔ The app quits and launches again — the next process opens its own store over the file. */
  const relaunch = async (): Promise<void> => {
    await host.closeAll()
    host = buildHost(createSessionStore(db, tick))
  }

  /** A window on the running host, and the renderer store the app builds in it. */
  const aWindow = (
    wire: Wire = 'as-shipped',
    ownerId = 'webContents:1',
  ): { window: Window; store: RendererStore } => {
    const window = new Window(host, ownerId, wire)
    return { window, store: createRendererStore(window.bridge()) }
  }

  const events = (sessionId: string): TranscriptEvent[] =>
    ledger.events(sessionId).map((entry) => entry.event)
  const cardsOn = (sessionId: string): string[] =>
    events(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * ⛔ A PM a person opened, and a worker its give started — both in `mode` (D-016: a conversation a
   * give starts runs in its giver's mode). ⚑ The brief is the worker's FIRST TURN, so in 'ask' mode
   * that turn parks on a card at once.
   */
  const aPmAndItsWorker = async (
    mode: 'ask' | 'auto',
    brief = 'do it',
  ): Promise<{ pm: string; worker: string; pmTools: AgentToolset; piece: string }> => {
    const opener = new Window(host)
    const first = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: mode, cwd: root },
      opener.sink,
    )
    await host.close(first.sessionId, opener.sink)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: mode, cwd: root },
      opener.sink,
    )
    const pmTools = toolsets.at(-1)
    if (pmTools === undefined) throw new Error('no toolset')
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work this dispatch is about',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string, pmTools, piece: given.label as string }
  }

  /** What a person is shown about one conversation — the fields the pane and the rail read. */
  const drawn = (
    store: RendererStore,
    sessionId: string,
  ): { ended: boolean; phase: string; live: boolean } => {
    const record = store.get(sessionId)
    if (record === null) throw new Error(`no record for ${sessionId}`)
    return {
      ended: record.control.ended,
      phase: record.phase,
      // ⚑ **D-017b · `live`** — the records this window is fed (it was `open`).
      live: store.live.value.some((one) => one.sessionId === sessionId),
    }
  }
  const card = (state: TranscriptState, requestId: string) => {
    const item = state.items.find(
      (one) => one.kind === 'permission' && one.request.id === requestId,
    )
    if (item === undefined || item.kind !== 'permission') throw new Error(`no card ${requestId}`)
    return { awaiting: isAwaitingAnswer(item), note: item.note }
  }

  /**
   * ⛔ A worker that took a turn and finished it, then the app quit — a CLEAN previous life.
   * ⚑ **D-016** — the turn is the give's brief.
   */
  const aWorkerWhoseLastLifeEndedCleanly = async (): Promise<{
    pm: string
    worker: string
    piece: string
  }> => {
    const { pm, worker, piece } = await aPmAndItsWorker('auto')
    await waitFor(
      () => events(worker).some((event) => event.type === 'turn'),
      'the worker to finish its turn',
    )
    await relaunch()
    // ⚑ The premise, asserted: the page will END with the previous life's ending.
    expect(events(worker).at(-1)).toMatchObject({ type: 'status', state: 'ended' })
    return { pm, worker, piece }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · drawn as ended
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a person takes over a conversation whose running life was a reopen', () => {
    it('🔴 §1.1 woken with no window, claimed before its first turn — NOT drawn ended', async () => {
      const { worker } = await aWorkerWhoseLastLifeEndedCleanly()
      const lifeBegins = ledger.nextOrdinal(worker)
      await host.resumeSession(worker, null)
      const { window, store } = aWindow()

      expect(await store.claim(worker)).toBe(true)

      // ⚑ **The seam travelled, through a real structured clone** — this is the cloned object.
      expect(window.handed.at(-1)).toMatchObject({ handover: 'attached', liveFrom: lifeBegins })
      expect(drawn(store, worker)).toEqual({ ended: false, phase: 'open', live: true })
      // ⚑ …and it is the RECORD's epoch now, so every later re-fold crosses it too, and the pane's
      // *"This conversation has been opened before"* — drawn from `liveFrom !== null` — is drawn.
      const record = store.get(worker) as SessionRecord
      expect(record.liveFrom).toBe(lifeBegins)
      expect(refold(record, record.window.entries).ended).toBe(false)
    })

    /**
     * 🔴 **663 · the same, started by its PARENT** — the door `652` built the no-surface arm for,
     * with a caller. ⚑ `663` §8 item 4: *"Take over draws it LIVE, not ended — measured on the
     * Claude shape"*, which is this file's double. ⚑ **D-017 · R1**: `resume_agent` is gone, and the
     * parent's message is what starts a stopped conversation now, through the same door with no
     * window; its first turn is held right after its `working`, so the claim lands before anything
     * of this life has ended.
     */
    it('🔴 §1.1b 663 · started by its parent’s message (D-017 R1), claimed in its first turn — NOT drawn ended', async () => {
      const { pm, worker, piece } = await aWorkerWhoseLastLifeEndedCleanly()
      await host.resumeSession(pm, new Window(host, 'webContents:9').sink)
      const lifeBegins = ledger.nextOrdinal(worker)
      holdTheWokenTurn()

      const sent = await callOn(agentToolsFor(host, pm), 'message_agent', {
        agent: worker,
        text: 'go on',
        kind: 'follow-up',
        piece,
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      await waitFor(
        () =>
          ledger
            .events(worker)
            .some(
              (entry) =>
                entry.ordinal >= lifeBegins &&
                entry.event.type === 'status' &&
                entry.event.state === 'working',
            ),
        'the started turn to begin',
      )

      const { window, store } = aWindow()
      expect(await store.claim(worker)).toBe(true)
      expect(window.handed.at(-1)).toMatchObject({ handover: 'attached', liveFrom: lifeBegins })
      expect(drawn(store, worker)).toMatchObject({ ended: false, live: true })
    })

    it('⛔ §1.2 THE CONTROL — the same hand-over WITHOUT the seam is drawn ended, which is `652` F1', async () => {
      // 🔴 **The incumbent's wire, planted.** Same host, same ledger, same claim; only the field is
      // taken off the answer. Without this, §1.1 would pass over a host that simply never put the
      // previous life on the page.
      const { worker } = await aWorkerWhoseLastLifeEndedCleanly()
      await host.resumeSession(worker, null)
      const { store } = aWindow('without-the-seam')

      expect(await store.claim(worker)).toBe(true)

      expect(drawn(store, worker).ended).toBe(true)
      expect((store.get(worker) as SessionRecord).liveFrom).toBeNull()
    })

    it('🔴 §1.3 a window reopens a conversation and its store is rebuilt (HMR) — NOT drawn ended, and no `652` needed to get here', async () => {
      const opener = new Window(host)
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'alpha', approvalMode: 'auto', cwd: root },
        opener.sink,
      )
      await host.send(sessionId, 'hello', opener.sink)
      await waitFor(() => events(sessionId).some((event) => event.type === 'turn'), 'a turn')
      await relaunch()
      const lifeBegins = ledger.nextOrdinal(sessionId)

      // A person presses Reopen in their window…
      const first = aWindow()
      expect(await first.store.resume(sessionId)).toBe(sessionId)
      expect(drawn(first.store, sessionId).ended).toBe(false) // the `resumed` path, unchanged
      // …and the window's store is rebuilt without a navigation — the same `webContents`, a new
      // store, the one-time `attachOpen` every store build makes.
      const rebuilt = aWindow('as-shipped', first.window.ownerId)
      expect(await rebuilt.store.attachOpen()).toEqual([sessionId])

      expect(rebuilt.window.handed.at(-1)).toMatchObject({
        handover: 'attached',
        liveFrom: lifeBegins,
      })
      expect(drawn(rebuilt.store, sessionId)).toEqual({ ended: false, phase: 'open', live: true })
    })

    it("⛔ §1.4 THE CONTROL — the same rebuild over the incumbent's wire is drawn ended", async () => {
      const opener = new Window(host)
      const { sessionId } = await host.createSession(
        { provider: 'claude', profileId: 'alpha', approvalMode: 'auto', cwd: root },
        opener.sink,
      )
      await host.send(sessionId, 'hello', opener.sink)
      await waitFor(() => events(sessionId).some((event) => event.type === 'turn'), 'a turn')
      await relaunch()
      const first = aWindow()
      await first.store.resume(sessionId)
      const rebuilt = aWindow('without-the-seam', first.window.ownerId)
      await rebuilt.store.attachOpen()

      expect(drawn(rebuilt.store, sessionId).ended).toBe(true)
    })

    it('⚑ §1.5 a conversation in its FIRST life hands over exactly what it did — no key, no epoch', async () => {
      // ⚠️ **The brief's byte-identity rule, pinned as the ABSENCE of the key**: a `null` would have
      // changed the bytes of every spawned and every created hand-over. Two first lives, both doors.
      const { worker } = await aPmAndItsWorker('auto')
      const claimer = aWindow('as-shipped', 'webContents:2')
      await claimer.store.claim(worker)
      const opener = aWindow('as-shipped', 'webContents:3')
      const { sessionId: made } = await host.createSession(
        { provider: 'claude', profileId: 'alpha', approvalMode: 'auto', cwd: root },
        opener.window.sink,
      )
      const rebuilt = aWindow('as-shipped', 'webContents:3')
      await rebuilt.store.attachOpen()

      for (const [handed, store, id] of [
        [claimer.window.handed.at(-1), claimer.store, worker],
        [rebuilt.window.handed.at(-1), rebuilt.store, made],
      ] as const) {
        expect(handed?.handover).toBe('attached')
        expect(handed !== undefined && 'liveFrom' in handed).toBe(false)
        expect((store.get(id) as SessionRecord).liveFrom).toBeNull()
      }
    })

    it("⚑ §1.6 a RESUME needs no seam — the renderer's own epoch is the host's, measured", async () => {
      // ⛔ **"Every producer must set the field or be proven not to need it."** The resume's page is
      // read before the provider is asked, so it ends exactly where the new life begins; this is the
      // proof that the renderer's `nextOrdinal` after the replay IS the host's start.
      const { worker } = await aWorkerWhoseLastLifeEndedCleanly()
      const lifeBegins = ledger.nextOrdinal(worker)
      const { window, store } = aWindow()

      expect(await store.resume(worker)).toBe(worker)

      expect(window.handed.at(-1)?.handover).toBe('resumed')
      expect('liveFrom' in (window.handed.at(-1) as ResumedSession)).toBe(false)
      const theRenderersEpoch = (store.get(worker) as SessionRecord).liveFrom
      expect(theRenderersEpoch).toBe(lifeBegins)
      // ⚑ **And the HOST's own answer, for the same life, is the same number** — read off an
      // attached hand-over of it (a store rebuilt on that window), which is the only place the host
      // says it. Found by this dispatch's review: comparing both sides with one pre-resume count
      // could not see the two disagree.
      const rebuilt = aWindow('as-shipped', window.ownerId)
      await rebuilt.store.attachOpen()
      expect(rebuilt.window.handed.at(-1)?.liveFrom).toBe(theRenderersEpoch)
    })

    it("🔴 §1.7 taken over MID-TURN — the woken life's first turn is drawn WORKING, not idle", async () => {
      // ⛔ **The woken life's first PROVIDER row is `status: working`** (Claude's `beginTurn` publishes it
      // before the handshake), so the correction has to land BEFORE it: one row late and
      // `markReopened` resets the status to `idle`, and nothing says `working` again until the turn
      // raises a card or ends. Found by this dispatch's review; the first version of the double put
      // `session` first and could not see it. ⚠️ **Green on the pre-653 code as well**, which applies
      // no correction at all — so this guards WHERE the correction lands, and `653 M9` (`>=` to `>`)
      // is the regression it exists to catch. ⚠️ **Since `673` that flip ALONE is invisible**: the
      // row at the seam is the host's `reopened`, which draws nothing, so crossing one row late
      // still lands before `working`. ⚑ `M9` therefore flips it with the replay's epoch taken past
      // that row, in the renderer — see its table.
      const { pm, worker, piece } = await aWorkerWhoseLastLifeEndedCleanly()
      const lifeBegins = ledger.nextOrdinal(worker)
      await host.resumeSession(worker, null)
      await host.resumeSession(pm, new Window(host, 'webContents:9').sink)
      const woken = toolsets.at(-1)
      if (woken === undefined) throw new Error('no toolset')
      holdTheWokenTurn()
      expect(
        (
          await callOn(woken, 'message_agent', {
            agent: worker,
            text: 'go on',
            kind: 'follow-up',
            piece,
          })
        ).outcome,
      ).toBe('ok')
      await waitFor(
        () => events(worker).some((event) => event.type === 'status' && event.state === 'working'),
        'the woken turn to start',
      )
      // ⚑ The premise: this life's first PROVIDER row is `working`, immediately past the seam.
      // 🔴 **673 · the host now writes a `reopened` row at the seam** — the first row of every life
      // this app reopens, so the task fold can unwind the ending on Claude too (`663` F1). ⛔ Asked
      // of the provider's rows only, not pinned at an index: the premise is Claude's order, and a
      // premise that pinned the host's row would be what went red on `M9` instead of the drawing.
      // ⚑ **D-017 · R4 — and its `launched` row beside it**, the per-launch marker written right
      // after `reopened`: a host row too, which draws nothing.
      const lifeRows = ledger
        .events(worker)
        .filter((entry) => entry.ordinal >= lifeBegins)
        .map((entry) => entry.event)
        .filter((event) => event.type !== 'reopened' && event.type !== 'launched')
      expect(lifeRows[0]).toMatchObject({ type: 'status', state: 'working' })
      const { store } = aWindow()

      expect(await store.claim(worker)).toBe(true)

      const record = store.get(worker) as SessionRecord
      expect(record.control.status).toBe('working')
      expect(record.control.ended).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what the previous life left open, and what this one has raised since
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the correction lands BETWEEN the two lives', () => {
    /**
     * ⛔ **A previous life that died with a card on screen, and a woken life that has raised one.**
     *
     * ⚠️ A CLEAN quit settles its own cards — the provider's close writes `turn: interrupted` and
     * `session: ended`, and the fold settles every open card on either — so the only previous-life
     * card still open on a page is one a CRASH left. ⚑ Then the worker is woken with no window, its
     * parent asks it something, and the turn that question opens parks on a second card.
     * ⚑ **D-016** — the first life's card is the give's brief's, and the parent's follow-up names
     * that piece.
     */
    const aCardFromEachLife = async (
      idsRepeat = false,
    ): Promise<{
      worker: string
      lifeBegins: number
      stale: string
      live: string
    }> => {
      control.renameIds = !idsRepeat
      const { pm, worker, piece } = await aPmAndItsWorker('ask')
      await waitFor(() => cardsOn(worker).length === 1, 'the first life to park on a card')
      const [stale] = cardsOn(worker) as [string]

      crash.crashed = true
      await relaunch()
      crash.crashed = false
      // ⚑ The premise: nothing on the ledger ends the first life or settles its card.
      expect(
        events(worker).some((event) => event.type === 'session' && event.state === 'ended'),
      ).toBe(false)
      expect(
        events(worker).some((event) => event.type === 'request_resolved' && event.id === stale),
      ).toBe(false)

      const lifeBegins = ledger.nextOrdinal(worker)
      await host.resumeSession(worker, null)
      await host.resumeSession(pm, new Window(host, 'webContents:9').sink)
      const woken = toolsets.at(-1)
      if (woken === undefined) throw new Error('no toolset')
      expect(
        (
          await callOn(woken, 'message_agent', {
            agent: worker,
            text: 'still there?',
            kind: 'follow-up',
            piece,
          })
        ).outcome,
      ).toBe('ok')
      await waitFor(() => cardsOn(worker).length === 2, 'the woken life to park on a card')
      const live = cardsOn(worker)[1] as string
      return { worker, lifeBegins, stale, live }
    }

    it("🔴 §2.1 the previous life's card is SETTLED and this life's card is still ANSWERABLE", async () => {
      const { worker, lifeBegins, stale, live } = await aCardFromEachLife()
      const { store } = aWindow()

      expect(await store.claim(worker)).toBe(true)

      const record = store.get(worker) as SessionRecord
      expect(record.liveFrom).toBe(lifeBegins)
      expect(card(record.control, stale)).toEqual({
        awaiting: false,
        note: 'settled when this conversation was last open',
      })
      expect(card(record.control, live)).toEqual({ awaiting: true, note: null })
      // ⚑ And a later re-fold draws the same two cards the same way.
      const again = refold(record, record.window.entries)
      expect(card(again, stale).awaiting).toBe(false)
      expect(card(again, live).awaiting).toBe(true)
    })

    it('⛔ §2.2 THE CONTROL — without the seam the dead card is still offered to the person', async () => {
      // 🔴 Pressing it reaches an adapter that has never heard of the id and refuses — `markReopened`'s
      // own docblock names that as the reason it settles them.
      const { worker, stale } = await aCardFromEachLife()
      const { store } = aWindow('without-the-seam')
      await store.claim(worker)

      expect(card((store.get(worker) as SessionRecord).control, stale).awaiting).toBe(true)
    })

    it('⛔ §2.3 THE CONTROL — `resumed` instead of the seam settles the card THIS life is waiting on', async () => {
      // 🔴 **The repair the brief ruled out, planted**: the correction at the END of the page takes
      // the live card with the dead one, and the agent parked on it waits for an answer the person
      // is no longer offered.
      const { worker, live } = await aCardFromEachLife()
      const { store } = aWindow('as-resumed')
      await store.claim(worker)

      expect(card((store.get(worker) as SessionRecord).control, live)).toEqual({
        awaiting: false,
        note: 'settled when this conversation was last open',
      })
    })
    it("⚑ §2.4 the same split when card ids REPEAT across lives — Codex's shape, told apart by order", async () => {
      // ⚠️ Codex's card id is `requestKey(jsonRpcId)` over a connection that starts again with each
      // life, so both cards here are `turn_1_perm`. ⚑ The epoch does not care: the first card on the
      // page is settled at the seam and the second is folded after it.
      const { worker } = await aCardFromEachLife(true)
      expect(new Set(cardsOn(worker)).size).toBe(1) // the premise: one id, two cards
      const { store } = aWindow()
      await store.claim(worker)

      const cards = (store.get(worker) as SessionRecord).control.items.flatMap((item) =>
        item.kind === 'permission' ? [item] : [],
      )
      expect(cards.map((one) => isAwaitingAnswer(one))).toEqual([false, true])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the claim's own round trip
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · what the woken life says while the claim is in the air', () => {
    it('🔴 §3.1 a window that watched it END takes it over again — the card raised in the gap is drawn', async () => {
      // ⛔ **`claim` never had `resume`'s hold on early events (242 §3).** A record this window
      // already holds from an earlier life has `meta` set, so without the count the listener folds
      // the woken life's first events into the ENDED record — and `adoptHandover` then clears it,
      // with a page read before those events existed. ⚑ The gap is made deterministic: the host has
      // answered, and before the renderer reads the answer the woken turn raises its card.
      const { pm, worker, pmTools, piece } = await aPmAndItsWorker('ask')
      const { window, store } = aWindow()
      expect(await store.claim(worker)).toBe(true)
      await host.close(worker, window.sink)
      // the premise: a record from an ended life — ⚑ D-017b: `recorded`, drawn from its ledger
      expect(drawn(store, worker).phase).toBe('recorded')

      await host.resumeSession(worker, null)
      holdTheWokenTurn()
      expect(
        (
          await callOn(pmTools, 'message_agent', {
            agent: worker,
            text: 'again?',
            kind: 'follow-up',
            piece,
          })
        ).outcome,
      ).toBe('ok')
      await waitFor(
        () => events(worker).some((event) => event.type === 'status' && event.state === 'working'),
        'the woken turn to start',
      )
      // ⚑ **D-016 · the first life raised a card of its own** — the give's brief parked on one — so
      // the gap waits for a card this window had not been sent before it.
      const cardsSent = (): number =>
        window.received.filter(
          (message) => message.sessionId === worker && message.event.type === 'permission_request',
        ).length
      const sentBefore = cardsSent()
      window.inTheGap = async () => {
        releaseTheTurn()
        await waitFor(
          () => cardsSent() > sentBefore,
          'the woken life to raise its card while the claim is in the air',
        )
      }

      expect(await store.claim(worker)).toBe(true)

      const raised = cardsOn(worker).at(-1) as string
      expect(card((store.get(worker) as SessionRecord).control, raised)).toEqual({
        awaiting: true,
        note: null,
      })
      expect(pm).toBeTruthy()
    })
  })
})
