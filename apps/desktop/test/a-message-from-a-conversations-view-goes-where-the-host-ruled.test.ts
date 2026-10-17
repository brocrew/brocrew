import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
  ResumeError,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { createSessionStore, type FirstMessageCameTo } from '../src/renderer/src/lib/session-store'
import {
  HELD_ELSEWHERE,
  NOTHING_TO_SEND,
  type FirstMessageAnswer,
  type HandedPath,
  type RuntimeBridge,
  type RuntimeChangeMessage,
  type RuntimeCommand,
  type RuntimeEventMessage,
  type SessionLivenessMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * D-017b · a message sent from a conversation's view goes where the HOST ruled, and the window says
 * what the host said, in the one place a person reads it.
 *
 * `RuntimeHost.startAndSend` is the one door every message from a conversation's view goes through,
 * whatever its process is doing, and the renderer store's `startAndSend` adopts what it answers.
 * `a-first-message-starts-it-in-one-act` pins the host's order and `a-conversation-a-quit-left-open-
 * starts-on-its-first-message` pins the whole path for the common cases. This file pins six facts
 * neither of them reaches, each one a place where a plausible edit keeps every other test green:
 *
 *  - the undo of a start is only for a start THIS message made: a conversation the window already
 *    runs, attached and idle, is not stopped by a message that was refused (host);
 *  - the third ask inside the arrivals entry: another window that opened it while the message waited
 *    behind an earlier arrival is refused `held-elsewhere`, and not `the-start`, which is what the
 *    reopen would say with the same sentence (host);
 *  - a Cancel is not a refusal, so it writes nothing beside the box of a recorded view (store);
 *  - the last refusal beside the box is cleared by the next message, by the door's own entry (store);
 *  - a conversation that could never be reopened is continued in the one that took its place, and the
 *    store names it and adopts it under its own id (store);
 *  - a rejection is said beside the recorded conversation, where its composer draws it (store).
 *
 * Real host, real SQLite ledger and migrations, and (for the store) the real renderer session store
 * over the real dispatcher and the wire's structured clone. The only double is the provider, which
 * counts every launch the host asks for, so "nothing started" is a count.
 * A relaunch is a second host over the same database with its own ledger store object, and a fresh
 * window (`a-next-launch-test-needs-its-own-store-object`).
 *
 * Every negative assertion sits beside a positive one read off the same reader, and each design
 * arm has its control in the test that follows it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * One window: the sink the host writes to and, for the renderer store, the bridge over the real
 * dispatcher. The host is a getter because a relaunch builds a new one under the same window code.
 */
class AWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  private readonly events: ((message: RuntimeEventMessage) => void)[] = []
  private readonly liveness: ((message: SessionLivenessMessage) => void)[] = []
  private readonly changed: ((message: RuntimeChangeMessage) => void)[] = []

  constructor(
    readonly ownerId: string,
    private readonly host: () => RuntimeHost,
  ) {}

  send(message: RuntimeEventMessage): void {
    for (const listener of [...this.events]) listener(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    for (const listener of [...this.liveness]) listener(message)
  }

  announce(change: RuntimeChangeMessage): void {
    for (const listener of [...this.changed]) listener(change)
  }

  bridge(): RuntimeBridge {
    const run = async <T>(command: RuntimeCommand): Promise<T> =>
      (await executeRuntimeCommand(this.host(), this, command)) as T
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run({ kind: 'createSession', ...input }),
      resume: (input) => run({ kind: 'resume', ...input }),
      startAndSend: (input) => run({ kind: 'startAndSend', ...input }),
      cancelLaunch: (input) => run({ kind: 'cancelLaunch', ...input }),
      attachOpen: () => run({ kind: 'attachOpen' }),
      send: (input) => run({ kind: 'send', ...input }),
      sendInterrupting: (input) => run({ kind: 'sendInterrupting', ...input }),
      queueMessage: (input) => run({ kind: 'queueMessage', ...input }),
      close: (input) => run({ kind: 'close', ...input }),
      look: (input) => run({ kind: 'look', ...input }),
      listResumable: () => run({ kind: 'listResumable' }),
      listUnresumable: () => run({ kind: 'listUnresumable' }),
      onEvent: (fn) => {
        this.events.push(fn)
        return () => void this.events.splice(this.events.indexOf(fn), 1)
      },
      onLiveness: (fn) => {
        this.liveness.push(fn)
        return () => void this.liveness.splice(this.liveness.indexOf(fn), 1)
      },
      onChanged: (fn) => {
        this.changed.push(fn)
        return () => void this.changed.splice(this.changed.indexOf(fn), 1)
      },
    }
    return everythingOverTheWire(bridge) as RuntimeBridge
  }
}

interface Launch {
  readonly kind: 'start' | 'resume'
  readonly handle: FakeSessionHandle
}

/** A running handle's sign-in moves: asked, it latches and says so, as the adapters' do. */
const itsSignInMoves = (handle: FakeSessionHandle): void => {
  let latched = false
  Object.defineProperty(handle, 'signInSuperseded', { get: () => latched, configurable: true })
  Object.defineProperty(handle, 'checkSignIn', {
    value: async () => (latched = true),
    configurable: true,
  })
}

class LaunchCountingRuntime extends FakeRuntime {
  /** One shot: the error the next resume throws, as a real adapter's. */
  static nextResumeThrows: unknown = null
  /** Every launch from now on holds a sign-in that has moved, as one renewed again at once would. */
  static everySignInMoves = false

  constructor(
    provider: Provider,
    private readonly launches: Launch[],
    sessions: FakeProviderSessions,
    gate: FakeLaunchGate | undefined,
  ) {
    super(provider, { sessions, ...(gate === undefined ? {} : { gate }) })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (LaunchCountingRuntime.everySignInMoves) itsSignInMoves(handle)
    this.launches.push({ kind: 'start', handle })
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const thrown = LaunchCountingRuntime.nextResumeThrows
    if (thrown !== null) {
      LaunchCountingRuntime.nextResumeThrows = null
      throw thrown
    }
    const handle = await super.resume(ref, options)
    if (LaunchCountingRuntime.everySignInMoves) itsSignInMoves(handle)
    this.launches.push({ kind: 'resume', handle })
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('D-017b · a message from a conversation’s view goes where the host ruled', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let window: AWindow
  let windows: AWindow[]
  let launches: Launch[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let gate: FakeLaunchGate | undefined
  const stops: (() => void)[] = []
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new LaunchCountingRuntime(provider, launches, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      announce: (change) => {
        for (const one of windows) one.announce(change)
      },
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d017b-send-'))
    // A real path: a handed attachment is refused when the path it names and the path it resolves
    // to differ, and macOS hands out `/var/...` for `/private/var/...`.
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-d017b-send-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_500_000
    ledger = createLedger(db, tick)
    counter = 0
    hosts = []
    launches = []
    issued = new FakeProviderSessions()
    gate = undefined
    LaunchCountingRuntime.nextResumeThrows = null
    LaunchCountingRuntime.everySignInMoves = false
    host = buildHost()
    window = new AWindow('webContents:1', () => host)
    windows = [window]
  })

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop()
    // A test that failed while a launch was held would otherwise hang the close below.
    gate?.release()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    ledger.events(sessionId).map((entry) => entry.event)

  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

  /** What the host's list says about one conversation's process, the one fact the rail carries. */
  const listed = (sessionId: string): { running: string } => {
    const row = host.resumableSessions().find((one) => one.sessionId === sessionId)
    if (row === undefined) throw new Error(`${sessionId} is not listed`)
    return { running: row.running }
  }

  const NOTHING_RUNS_IT = { running: 'not-running' }
  const A_WINDOW_RUNS_IT = { running: 'in-a-window' }

  /** A person's conversation, idle when the person quit. At the next launch nothing runs it. */
  const aConversationTheQuitStopped = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    await host.closeAll()
    ledger = createLedger(db, tick)
    host = buildHost()
    window = new AWindow('webContents:2', () => host)
    windows = [window]
    expect(listed(sessionId), 'the premise: nothing runs it after the restart').toEqual(
      NOTHING_RUNS_IT,
    )
    return sessionId
  }

  /** A person's conversation, running and idle in this window: attached, no turn, nothing held. */
  const aConversationThisWindowRuns = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const answered = (sessionId: string, text: string): boolean =>
    events(sessionId).some(
      (event) =>
        event.type === 'assistant_message' &&
        event.text.startsWith('echo: ') &&
        event.text.includes(text),
    )

  const turnsOf = (sessionId: string): string[] =>
    events(sessionId).flatMap((event) => (event.type === 'user_turn' ? [event.text] : []))

  const notSentOf = (
    answer: FirstMessageAnswer,
  ): Extract<FirstMessageAnswer, { notSent: unknown }>['notSent'] => {
    if (!('notSent' in answer)) throw new Error(`it was sent: ${JSON.stringify(answer)}`)
    return answer.notSent
  }

  /**
   * The first message's send is `sendAs`, inside its one arrivals entry (never `send`, which would
   * join the chain behind that very entry), so a refusal only the started conversation could make
   * is planted there, once: every later send goes through the real door.
   */
  const theFirstMessagesSendRefuses = (refuse: (sessionId: string) => Promise<void>): void => {
    const door = host as unknown as {
      sendAs: (sessionId: string, ...rest: unknown[]) => Promise<void>
    }
    const real = door.sendAs.bind(host)
    door.sendAs = async (sessionId: string): Promise<void> => {
      door.sendAs = real
      return refuse(sessionId)
    }
  }

  /**
   * An arrival ahead of the next message, held by hand in the conversation's arrivals: the
   * message waits behind it, as it would behind a delivery that reached the conversation first.
   * Returns the release.
   */
  const anEarlierArrival = (sessionId: string): (() => void) => {
    const arrivals = (host as unknown as { arrivals?: unknown }).arrivals
    if (!(arrivals instanceof Map)) throw new Error('the host has no arrivals map')
    let letItGo!: () => void
    arrivals.set(
      sessionId,
      new Promise<void>((resolve) => {
        letItGo = resolve
      }),
    )
    return letItGo
  }

  /** A file the person attached, as main classified it when they did. */
  const attached = (name: string): HandedPath => {
    const path = join(root, name)
    writeFileSync(path, 'the notes\n')
    return { path, kind: 'file', outsideCwd: false }
  }

  /** A renderer store in the current window, disposed with the test. */
  const openWindow = (): ReturnType<typeof createSessionStore> => {
    const store = createSessionStore(window.bridge())
    stops.push(() => store.dispose())
    return store
  }

  /**
   * The graceful quit a person's Cmd-Q is, then the next launch: its own ledger store object, its own
   * host, and a fresh window whose renderer holds no record of anything. `gated` puts a launch gate
   * under the NEW host's provider only, so the conversation made before the quit is not held by it.
   * Returns the launch count at the relaunch, so a later count is "since the relaunch".
   */
  const quitAndRelaunch = async (gated: boolean): Promise<number> => {
    await host.closeAll()
    for (const stop of stops.splice(0)) stop()
    ledger = createLedger(db, tick)
    gate = gated ? new FakeLaunchGate() : undefined
    host = buildHost()
    window = new AWindow('webContents:2', () => host)
    windows = [window]
    return launches.length
  }

  /** A person's conversation, said something in, and left stopped when the app quit. */
  const leftOpenByTheQuit = async (
    options: { gated?: boolean; provider?: Provider } = {},
  ): Promise<{ id: string; atRelaunch: number }> => {
    const before = openWindow()
    const id = await before.create({ provider: options.provider ?? 'claude', cwd: root })
    if (id === null) throw new Error('the conversation did not start')
    expect(await before.send(id, 'said before the quit')).toBe(true)
    await waitFor(() => answered(id, 'said before the quit'), 'the answer before the quit')
    const atRelaunch = await quitAndRelaunch(options.gated === true)
    return { id, atRelaunch }
  }

  /** What the message came to, when it was not sent. */
  const refusedOf = (
    came: FirstMessageCameTo | null,
  ): Extract<FirstMessageCameTo, { sent: false }> => {
    if (came === null || came.sent) throw new Error(`it was not refused: ${JSON.stringify(came)}`)
    return came
  }

  /** What the message came to, when it was sent. */
  const sentOf = (came: FirstMessageCameTo | null): Extract<FirstMessageCameTo, { sent: true }> => {
    if (came === null || !came.sent) throw new Error(`it was not sent: ${JSON.stringify(came)}`)
    return came
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // the host: what a refused message leaves behind, and who is asked
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('the host · a message refused after it reached the conversation', () => {
    it('a refused message to a conversation this window already runs leaves it running, handed back', async () => {
      // The conversation is attached and idle, with no turn, no giver and an empty mailbox: exactly
      // what the undo would stop if it were allowed to. A message that only ATTACHED it did not
      // start it, so a refusal of the message is not a reason to stop it.
      const id = await aConversationThisWindowRuns()
      const before = launches.length
      expect(listed(id), 'the premise: this window runs it').toEqual(A_WINDOW_RUNS_IT)
      expect(launches.at(-1)?.handle.status(), 'the premise: idle, so the undo could stop it').toBe(
        'idle',
      )
      theFirstMessagesSendRefuses(async (): Promise<void> => {
        throw new Error('cannot send: refused for the test')
      })

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.refusedBy).toBe('after-the-start')
      expect(refused.said).toBe('cannot send: refused for the test.')
      expect(refused.launch).toBeNull()
      // Handed back, running here: the window keeps the conversation it had.
      expect(refused.running?.sessionId).toBe(id)
      expect(refused.running?.handover).toBe('attached')
      await letItSettle()
      expect(launches.length - before, 'attaching started nothing').toBe(0)
      expect(launches.at(-1)?.handle.status(), 'the refusal stopped the conversation').toBe('idle')
      expect(listed(id)).toEqual(A_WINDOW_RUNS_IT)
      expect(turnsOf(id), 'the refused words never went in').toEqual([])
    })

    it('…and the same refusal to a conversation this very message started stops that start again', async () => {
      // The control, one fact over: nothing ran it, so the message started it, its handover is not
      // an attach, and no message reached it. The undo still stops a start that nothing used.
      const id = await aConversationTheQuitStopped()
      const before = launches.length
      theFirstMessagesSendRefuses(async (): Promise<void> => {
        throw new Error('cannot send: refused for the test')
      })

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.refusedBy).toBe('after-the-start')
      expect(refused.said).toBe('cannot send: refused for the test.')
      expect(refused.running).toBeNull()
      expect(launches.length - before, 'the start the message made').toBe(1)
      expect(launches.at(-1)?.kind).toBe('resume')
      expect(launches.at(-1)?.handle.status()).toBe('ended')
      expect(listed(id)).toEqual(NOTHING_RUNS_IT)
    })
  })

  describe('a refused first message hands back the conversation as its refusal left it', () => {
    /**
     * Its sign-in moved, and this app's reopen for what it held did not help: the reopened life's
     * sign-in reads as moved too, so a person's message is refused, with the bar.
     */
    const thisAppsReopenDidNotHelp = async (id: string): Promise<void> => {
      LaunchCountingRuntime.everySignInMoves = true
      itsSignInMoves(launches.at(-1)!.handle)
      const before = launches.length
      await host.queueMessage(id, 'a notice', THE_APP_ITSELF)
      await waitFor(() => launches.length > before, 'this app to reopen it on the current sign-in')
      await letItSettle()
    }

    it('🔴 a moved Claude sign-in: the answer carries the bar its refusal published', async () => {
      const id = await aConversationThisWindowRuns()
      await thisAppsReopenDidNotHelp(id)

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.said).toMatch(/holding the Claude sign-in it started with/)
      expect(refused.running?.handover).toBe('attached')
      expect(refused.running?.liveness.signInSuperseded).toBe(true)
    })

    it('🔴 a moved Codex sign-in: the same', async () => {
      const { sessionId: id } = await host.createSession(
        { provider: 'codex', approvalMode: 'ask', cwd: root },
        window,
      )
      await thisAppsReopenDidNotHelp(id)

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.said).toMatch(/its profile has been signed in to another account since/)
      expect(refused.running?.liveness.signInSuperseded).toBe(true)
    })

    it('⚑ a refusal for another reason hands back no bar', async () => {
      const id = await aConversationThisWindowRuns()
      theFirstMessagesSendRefuses(async (): Promise<void> => {
        throw new Error('cannot send: refused for the test')
      })

      const refused = notSentOf(await host.startAndSend(id, 'hello', window))

      expect(refused.running?.handover).toBe('attached')
      expect(refused.running?.liveness.signInSuperseded).not.toBe(true)
    })

    it('🔴 the window keeps the bar: a running conversation it showed as recorded, refused on a moved sign-in', async () => {
      const { id } = await leftOpenByTheQuit()
      const store = openWindow()
      expect(await store.look(id)).toBe(id)
      // Something starts it with no window, as a wake or an agent's message does, while this window
      // still shows it as recorded.
      await host.resumeSession(id, null)
      await thisAppsReopenDidNotHelp(id)
      expect(store.get(id)?.phase, 'the premise: a recorded view').toBe('recorded')

      const came = refusedOf(await store.startAndSend(id, 'hello', []))

      expect(came.refusal.refusedBy).toBe('after-the-start')
      expect(store.isLive(id)).toBe(true)
      expect(store.get(id)?.error ?? '').toMatch(/holding the Claude sign-in it started with/)
      expect(store.get(id)?.meta?.liveness.signInSuperseded, 'the bar').toBe(true)
    })

    it.each(['claude', 'codex'] as const)(
      '🔴 %s · a person’s message on a moved sign-in goes in on the current one: the window ends on the reopened life',
      async (provider) => {
        const { id } = await leftOpenByTheQuit({ provider })
        const store = openWindow()
        expect(await store.look(id)).toBe(id)
        await host.resumeSession(id, null)
        expect(store.get(id)?.phase, 'the premise: a recorded view').toBe('recorded')
        // Only this life's sign-in moved: the one its reopen launches reads as current.
        itsSignInMoves(launches.at(-1)!.handle)
        const before = launches.length

        const came = await store.startAndSend(id, 'hello', [])

        expect(came?.sent).toBe(true)
        await waitFor(() => answered(id, 'hello'), 'the message to go in on the reopened life')
        await letItSettle()
        expect(launches.length - before, 'one reopen').toBe(1)
        expect(
          turnsOf(id).filter((text) => text === 'hello'),
          'it went in once',
        ).toHaveLength(1)
        expect(
          events(id).filter((event) => event.type === 'reopened' && event.because !== undefined),
          'reopened for what it held',
        ).toEqual([{ type: 'reopened', because: 'the-sign-in-moved-on' }])
        // ⚑ The window, at rest: live on the reopened life, with no refusal and no bar.
        expect(store.isLive(id)).toBe(true)
        expect(store.get(id)?.error ?? null).toBeNull()
        expect(store.get(id)?.meta?.liveness.signInSuperseded).not.toBe(true)
        const items = (): { kind?: string; text?: string }[] =>
          (store.get(id)?.transcript.items ?? []) as { kind?: string; text?: string }[]
        await waitFor(
          () =>
            items().some(
              (item) =>
                item.kind === 'assistant' &&
                (item.text ?? '').startsWith('echo: ') &&
                (item.text ?? '').includes('hello'),
            ),
          'the window to draw the answer',
        )
        // ⚑ …from the reopened life's own epoch: its first row is the reopen.
        const seam = ledger
          .events(id)
          .find((entry) => entry.event.type === 'reopened' && entry.event.because !== undefined)
        expect(seam, 'reopened for what it held').toBeDefined()
        expect(store.get(id)?.liveFrom).toBe(seam?.ordinal)
        // …with what it said before the quit still drawn, and the message once.
        expect(JSON.stringify(items())).toContain('said before the quit')
        expect(
          items().filter((item) => item.kind === 'user' && item.text === 'hello'),
          'the message drawn once',
        ).toHaveLength(1)
      },
    )

    it('🔴 …and the same when the answer reaches the window only after the reopen and the message are done', async () => {
      const { id } = await leftOpenByTheQuit()
      // ⚑ A window whose answer to the message is held until the test lets it go: everything the
      // reopen sends arrives first, inside the window's hand-over.
      const wire = window.bridge()
      let letTheAnswerGo!: () => void
      const answerHeld = new Promise<void>((resolve) => (letTheAnswerGo = resolve))
      const store = createSessionStore({
        ...wire,
        startAndSend: async (input) => {
          const answer = await wire.startAndSend(input)
          await answerHeld
          return answer
        },
      })
      stops.push(() => store.dispose())
      expect(await store.look(id)).toBe(id)
      await host.resumeSession(id, null)
      itsSignInMoves(launches.at(-1)!.handle)

      const coming = store.startAndSend(id, 'hello', [])
      await waitFor(() => answered(id, 'hello'), 'the message to go in on the reopened life')
      await letItSettle()
      expect(
        store.get(id)?.handover,
        'the premise: the answer is still on its way',
      ).toBeGreaterThan(0)
      letTheAnswerGo()
      expect((await coming)?.sent).toBe(true)

      // ⚑ At rest, with nothing more said to it: live on the reopened life.
      await waitFor(() => store.isLive(id), 'the window to take the reopened life')
      await letItSettle()
      const seam = ledger
        .events(id)
        .find((entry) => entry.event.type === 'reopened' && entry.event.because !== undefined)
      expect(seam, 'reopened for what it held').toBeDefined()
      expect(store.get(id)?.liveFrom).toBe(seam?.ordinal)
      expect(store.get(id)?.error ?? null).toBeNull()
      expect(store.get(id)?.meta?.liveness.signInSuperseded).not.toBe(true)
      const items = (store.get(id)?.transcript.items ?? []) as { kind?: string; text?: string }[]
      expect(JSON.stringify(items)).toContain('said before the quit')
      expect(items.filter((item) => item.kind === 'user' && item.text === 'hello')).toHaveLength(1)
    })
  })

  describe('the host · another window, asked again inside the arrivals entry', () => {
    it('another window that opens it while the message waits behind an earlier arrival is refused held-elsewhere', async () => {
      const id = await aConversationTheQuitStopped()
      gate = new FakeLaunchGate()
      host = buildHost()
      const before = launches.length
      const letTheEarlierArrivalGo = anEarlierArrival(id)
      let settled = false
      // No attachments, so the two asks before the arrivals entry pass on a conversation nobody has.
      const answering = host.startAndSend(id, 'hello', window)
      void answering.then(() => {
        settled = true
      })
      // Another window's own start, held inside its launch while the message waits its turn.
      const theirs = host.resumeSession(id, new AWindow('webContents:8', () => host))
      await waitFor(() => (gate?.held ?? 0) > 0, 'their start to be inside its launch')
      await letItSettle()
      expect(settled, 'the premise: the message is waiting behind the earlier arrival').toBe(false)
      gate.release()
      await theirs
      expect(listed(id), 'the premise: the other window runs it now').toEqual(A_WINDOW_RUNS_IT)

      letTheEarlierArrivalGo()
      const refused = notSentOf(await answering)

      // The kind first: without the third ask the reopen is refused by the slot's owner and the
      // answer is `the-start`, with the very same sentence.
      expect(refused.refusedBy).toBe('held-elsewhere')
      expect(refused).toEqual({
        refusedBy: 'held-elsewhere',
        said: HELD_ELSEWHERE,
        launch: null,
        running: null,
      })
      await letItSettle()
      expect(turnsOf(id), 'the words went into their conversation').toEqual([])
      expect(launches.length - before, 'one start: theirs').toBe(1)
      expect(listed(id)).toEqual(A_WINDOW_RUNS_IT)
    })

    it('…and when nobody opens it meanwhile, a message that waited behind an earlier arrival is sent', async () => {
      // The control, one fact over: the same arrivals entry and the same wait, and no other window.
      // The wait is not what refuses.
      const id = await aConversationTheQuitStopped()
      const before = launches.length
      const letTheEarlierArrivalGo = anEarlierArrival(id)
      let settled = false
      const answering = host.startAndSend(id, 'hello', window)
      void answering.then(() => {
        settled = true
      })
      await letItSettle()
      expect(settled, 'the premise: the message is waiting behind the earlier arrival').toBe(false)
      expect(launches.length - before, 'nothing started while it waited').toBe(0)

      letTheEarlierArrivalGo()
      const answer = await answering

      if (!('sent' in answer)) throw new Error(`not sent: ${JSON.stringify(answer)}`)
      expect(answer.sent.sessionId).toBe(id)
      await waitFor(() => answered(id, 'hello'), 'the message to be answered')
      expect(launches.length - before).toBe(1)
      expect(turnsOf(id)).toEqual(['hello'])
      expect(listed(id)).toEqual(A_WINDOW_RUNS_IT)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // the store: what the window says beside the box, and where it adopts
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('the store · what a recorded conversation says beside its box', () => {
    it('a cancelled start says nothing beside the box', async () => {
      const { id, atRelaunch } = await leftOpenByTheQuit({ gated: true })
      const store = openWindow()
      expect(await store.look(id)).toBe(id)
      // The premise: a recorded view WITH meta, so the record is kept and its `error` is drawn.
      expect(store.get(id)?.phase).toBe('recorded')
      expect(store.get(id)?.meta).not.toBeNull()

      const pending = store.startAndSend(id, 'hello', [])
      await waitFor(() => (gate?.held ?? 0) > 0, 'the start to be inside its launch')
      // The cancel FOUND the launch: otherwise a dropped key reads as a stalled start.
      expect(await store.cancelLaunch(id)).toBe(true)
      const came = await pending

      const refused = refusedOf(came)
      expect(came).toMatchObject({
        sent: false,
        openHere: false,
        refusal: { refusedBy: 'the-start', launch: 'cancelled' },
      })
      // The host did give a sentence for the cancel; the window is what leaves it unsaid.
      expect(
        refused.refusal.said.length,
        'the host answered the cancel with words',
      ).toBeGreaterThan(0)
      expect(store.get(id)?.error).toBeNull()
      expect(store.resumeError.value).toBeNull()
      expect(store.get(id)?.phase, 'still a recorded view').toBe('recorded')
      expect(store.isLive(id)).toBe(false)
      expect(listed(id), 'still listed, and nothing runs it').toEqual(NOTHING_RUNS_IT)
      expect(launches.length - atRelaunch, 'a cancelled start launched nothing').toBe(0)

      // The control, on the same store: a real refusal of the same door IS said beside the box.
      const notes = attached('notes.md')
      rmSync(notes.path)
      const moved = refusedOf(await store.startAndSend(id, 'look', [notes]))
      expect(moved.refusal.refusedBy).toBe('before-the-start')
      expect(store.get(id)?.error ?? '').toMatch(/moved or deleted/)
    })

    it('the last refusal beside the box is cleared by the next message', async () => {
      const { id } = await leftOpenByTheQuit()
      const store = openWindow()
      expect(await store.look(id)).toBe(id)
      const notes = attached('notes.md')
      rmSync(notes.path)
      expect(refusedOf(await store.startAndSend(id, 'look', [notes])).refusal.refusedBy).toBe(
        'before-the-start',
      )
      // The premise, read before the second call: the sentence really is beside the box.
      expect(store.get(id)?.error ?? '', 'the premise: the first refusal was said').toMatch(
        /moved or deleted/,
      )

      const came = await store.startAndSend(id, 'hello', [])

      expect(came).toEqual({ sent: true, openHere: true })
      // Nothing else clears it for this door: the entry of `startAndSend` does.
      expect(store.get(id)?.error).toBeNull()
      await waitFor(() => answered(id, 'hello'), 'the provider to answer the second message')
      expect(store.isLive(id)).toBe(true)
    })

    it('a rejection is said beside the recorded conversation', async () => {
      const { id } = await leftOpenByTheQuit()
      const store = openWindow()
      expect(await store.look(id)).toBe(id)
      expect(store.get(id)?.error, 'the premise: nothing said beside the box yet').toBeNull()

      // The wire rejects blank words with NOTHING_TO_SEND, so the host answers nothing.
      const came = await store.startAndSend(id, ' ', [])

      expect(came).toBeNull()
      expect(store.resumeError.value).not.toBeNull()
      expect(store.resumeError.value).toContain(NOTHING_TO_SEND)
      expect(store.get(id)?.error).toBe(store.resumeError.value)
      // The record is kept, because it has meta: it is a view of a real conversation.
      expect(store.get(id)?.phase).toBe('recorded')
      expect(store.get(id)?.meta).not.toBeNull()
    })

    it('…and a rejection for a conversation this window holds no record of leaves no record, and says it once', async () => {
      // The control, one fact over: no meta, so the record the call made up is not kept. The sentence
      // is then only on `resumeError`, where a launcher reads it.
      const { id } = await leftOpenByTheQuit()
      const store = openWindow()
      expect(store.get(id), 'the premise: this window holds no record of it').toBeNull()

      const came = await store.startAndSend(id, ' ', [])

      expect(came).toBeNull()
      expect(store.resumeError.value).toContain(NOTHING_TO_SEND)
      expect(store.get(id)).toBeNull()
    })
  })

  describe('the store · the conversation that took its place', () => {
    it('a conversation that could never be reopened is continued in the one that took its place', async () => {
      const { id } = await leftOpenByTheQuit()
      const ref = ledger.find(id)?.ref
      if (ref === undefined) throw new Error('the conversation has no provider ref')
      const store = openWindow()
      expect(await store.look(id)).toBe(id)
      LaunchCountingRuntime.nextResumeThrows = new ResumeError(ref, 'no such conversation', {
        noSuchSession: true,
      })

      const came = sentOf(await store.startAndSend(id, 'are you there', []))

      // The store names the conversation that runs, which is not the one it was asked about.
      const next = came.tookItsPlace
      if (next === undefined) throw new Error(`nothing took its place: ${JSON.stringify(came)}`)
      expect(next).not.toBe(id)
      expect(came.openHere).toBe(true)
      // And it is adopted under its own id: fed here, while the old record stays a recorded view.
      expect(store.isLive(next)).toBe(true)
      expect(store.isLive(id)).toBe(false)
      expect(events(id)).toContainEqual({ type: 'replaced_by', sessionId: next })
      await waitFor(() => turnsOf(next).includes('are you there'), 'the words in its place')
      expect(turnsOf(id), 'the words went to the old conversation').toEqual([
        'said before the quit',
      ])
      expect(listed(next)).toEqual(A_WINDOW_RUNS_IT)
    })

    it('…and when it can be reopened, the same message is adopted in place, naming no other conversation', async () => {
      // The control, one fact over: no `nextResumeThrows`, everything else the same.
      const { id, atRelaunch } = await leftOpenByTheQuit()
      const store = openWindow()
      expect(await store.look(id)).toBe(id)

      const came = await store.startAndSend(id, 'are you there', [])

      expect(came).toEqual({ sent: true, openHere: true })
      expect(came).not.toHaveProperty('tookItsPlace')
      expect(store.isLive(id)).toBe(true)
      await waitFor(() => answered(id, 'are you there'), 'the answer')
      expect(launches.length - atRelaunch).toBe(1)
      expect(events(id).some((event) => event.type === 'replaced_by')).toBe(false)
      expect(turnsOf(id)).toEqual(['said before the quit', 'are you there'])
    })
  })
})
