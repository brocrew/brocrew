import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import {
  FakeProviderSessions,
  FakeRuntime,
  ResumeError,
  type ResumeOptions,
  type SessionRef,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { createSessionStore, type FirstMessageCameTo } from '../src/renderer/src/lib/session-store'
import { LAUNCHER, useSurface, type Surface } from '../src/renderer/src/composables/useSurface'
import type {
  RuntimeBridge,
  RuntimeChangeMessage,
  RuntimeCommand,
  RuntimeEventMessage,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import { proseSpans } from './lib/prose-spans'

/**
 * D-017b, 701 M6 · the person is taken to the conversation that took a recorded one's place.
 *
 * A message sent from a recorded conversation's view continues it in one act (`store.startAndSend`).
 * When that conversation's history can never be reopened, the host starts another conversation in
 * its place and the store names it (`tookItsPlace`). `RuntimeScreen.continueIt` then puts THAT
 * conversation on screen, unless the reader moved while the start was in the air: the view is read
 * before the await and handed to `showConversation` after it. When it is left out, the words are
 * sent and answered in a conversation the person is never shown, and the view they are looking at
 * is the old one that stopped taking messages.
 *
 * Nothing in this repository mounts `RuntimeScreen`, so the part that has to be read is read: a
 * census over the source of `continueIt`, comments blanked. Everything it stands for is driven:
 * a real host over a real SQLite ledger and migrations, the real dispatcher and the wire's clone,
 * the real renderer session store and the real `useSurface`. The only double is the provider, which
 * can be told to fail the next resume the way an adapter does when the conversation is gone.
 * Every negative assertion sits beside a positive one read off the same reader.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')
const SCREEN = 'renderer/src/components/RuntimeScreen.vue'

/** Every comment blanked, newlines kept, so the census reads only code. */
function code(file: string, source: string): string {
  let out = source
  for (const span of proseSpans(file, source)) {
    out = out.replace(span.text, span.text.replace(/[^\n]/g, ' '))
  }
  return out
}

/** One declaration's body out of the screen's code, up to its closing line. */
function bodyOf(source: string, opening: string, closing: string): string {
  const start = source.indexOf(opening)
  expect(start, `${opening} is not in ${SCREEN}`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf(closing, start))
}

/** The window: the sink the host writes to, and the bridge the renderer store reads through. */
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

/** The fake provider, with one shot: the error the next resume throws, as a real adapter's. */
class ResumeFailingRuntime extends FakeRuntime {
  static nextResumeThrows: unknown = null

  constructor(provider: Provider, sessions: FakeProviderSessions) {
    super(provider, { sessions })
  }

  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const thrown = ResumeFailingRuntime.nextResumeThrows
    if (thrown !== null) {
      ResumeFailingRuntime.nextResumeThrows = null
      throw thrown
    }
    return super.resume(ref, options)
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('the person is taken to the conversation that took a recorded one’s place', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let window: AWindow
  let windows: AWindow[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  const stops: (() => void)[] = []
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ResumeFailingRuntime(provider, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d017b-place-'))
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-d017b-place-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_700_000
    ledger = createLedger(db, tick)
    counter = 0
    hosts = []
    issued = new FakeProviderSessions()
    ResumeFailingRuntime.nextResumeThrows = null
    host = buildHost()
    window = new AWindow('webContents:1', () => host)
    windows = [window]
  })

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const openWindow = (): ReturnType<typeof createSessionStore> => {
    const store = createSessionStore(window.bridge())
    stops.push(() => store.dispose())
    return store
  }

  const turnsOf = (sessionId: string): string[] =>
    ledger
      .events(sessionId)
      .flatMap(({ event }) => (event.type === 'user_turn' ? [event.text] : []))

  /** A person's conversation, said something in, and left stopped when the app quit. */
  const leftOpenByTheQuit = async (): Promise<string> => {
    const before = openWindow()
    const id = await before.create({ provider: 'claude', cwd: root })
    if (id === null) throw new Error('the conversation did not start')
    expect(await before.send(id, 'said before the quit')).toBe(true)
    await waitFor(
      () => turnsOf(id).includes('said before the quit'),
      'the words before the quit to be recorded',
    )
    await host.closeAll()
    for (const stop of stops.splice(0)) stop()
    ledger = createLedger(db, tick)
    host = buildHost()
    window = new AWindow('webContents:2', () => host)
    windows = [window]
    return id
  }

  /** The reader has the recorded conversation open: drawn by a look, on a real surface. */
  const readingIt = async (
    store: ReturnType<typeof createSessionStore>,
    id: string,
  ): Promise<Surface> => {
    const surface = useSurface(store)
    await nextTick()
    expect(await store.look(id)).toBe(id)
    // The screen's `openConversation`: the view read before the look, handed to the surface after.
    surface.showConversation(id, surface.view())
    await nextTick()
    expect(surface.activeId.value, 'the premise: the reader is on it').toBe(id)
    expect(surface.surface.value, 'the premise: and it is drawn').toBe('conversation')
    expect(store.get(id)?.phase).toBe('recorded')
    return surface
  }

  /**
   * `RuntimeScreen.continueIt`'s ending, as written on the screen: the view is read before the
   * await, and the conversation that took the place is put on screen after it. The census below
   * pins that the screen says this.
   */
  const continueIt = async (
    store: ReturnType<typeof createSessionStore>,
    surface: Surface,
    sessionId: string,
    text: string,
  ): Promise<FirstMessageCameTo | null> => {
    const from = surface.view()
    const came = await store.startAndSend(sessionId, text, [])
    if (came?.tookItsPlace !== undefined && came.openHere) {
      surface.showConversation(came.tookItsPlace, from)
    }
    return came
  }

  const theHistoryIsGone = (id: string): void => {
    const ref = ledger.find(id)?.ref
    if (ref === undefined) throw new Error('the conversation has no provider ref')
    ResumeFailingRuntime.nextResumeThrows = new ResumeError(ref, 'no such conversation', {
      noSuchSession: true,
    })
  }

  it('the screen’s continueIt puts the conversation that took the place on screen, from the view it read before the start', () => {
    const screen = code('RuntimeScreen.vue', readFileSync(join(SRC, SCREEN), 'utf8'))
    const body = bodyOf(screen, 'async function continueIt(', '\n}\n')
    const shows =
      /if \(came\?\.tookItsPlace !== undefined && came\.openHere\) \{?\s*showConversation\(came\.tookItsPlace, from\)/
    // The positive: the call, guarded by both facts, handed the view read before anything awaited.
    expect(body).toMatch(shows)
    expect(body.indexOf('const from = view()')).toBeGreaterThan(-1)
    expect(body.indexOf('const from = view()')).toBeLessThan(body.indexOf('await '))
    expect(body.indexOf('await store.startAndSend(')).toBeLessThan(body.search(shows))
    // The negative, on the same reader: the body without the call is not matched, so the pattern
    // can tell the screen that shows it from the screen that does not.
    const without = body.replace(/\n *if \(came\?\.tookItsPlace[^\n]*/, '')
    expect(without).not.toBe(body)
    expect(without).not.toMatch(shows)
    expect(without).not.toMatch(/showConversation\(/)
  })

  it('a message from a recorded view whose history is gone is answered in the conversation that took its place, and the reader is taken there', async () => {
    const id = await leftOpenByTheQuit()
    const store = openWindow()
    const surface = await readingIt(store, id)
    theHistoryIsGone(id)

    const came = await continueIt(store, surface, id, 'are you there')

    const next = came?.sent ? came.tookItsPlace : undefined
    if (next === undefined) throw new Error(`nothing took its place: ${JSON.stringify(came)}`)
    expect(next).not.toBe(id)
    // The words went to the conversation in its place, not to the one the reader was on.
    await waitFor(() => turnsOf(next).includes('are you there'), 'the words in its place')
    expect(turnsOf(id)).toEqual(['said before the quit'])
    // And the reader is on it: selected, drawn, and no destination in the way.
    expect(surface.activeId.value).toBe(next)
    expect(surface.place.value).toBeNull()
    expect(surface.surface.value).toBe('conversation')
    expect(store.isLive(next)).toBe(true)
    expect(surface.active.value?.sessionId).toBe(next)
  })

  it('…and when it can be reopened, nothing took its place and the reader stays on it', async () => {
    // The control, one fact over: the history is there, everything else the same.
    const id = await leftOpenByTheQuit()
    const store = openWindow()
    const surface = await readingIt(store, id)

    const came = await continueIt(store, surface, id, 'are you there')

    expect(came).toEqual({ sent: true, openHere: true })
    expect(came).not.toHaveProperty('tookItsPlace')
    await waitFor(() => turnsOf(id).includes('are you there'), 'the words in it')
    expect(surface.activeId.value).toBe(id)
    expect(surface.surface.value).toBe('conversation')
    expect(store.isLive(id)).toBe(true)
  })

  it('…and a reader who moved to the launcher while it started is not pulled back onto it', async () => {
    // The view is read before the await, so the answer that lands late loses to the reader. The
    // control is the first arm above: the same start, nobody moving, and the reader is taken.
    const id = await leftOpenByTheQuit()
    const store = openWindow()
    const surface = await readingIt(store, id)
    theHistoryIsGone(id)

    const pending = continueIt(store, surface, id, 'are you there')
    // `continueIt` has read its view and is waiting on the start: the reader presses New.
    surface.place.value = LAUNCHER
    const came = await pending

    const next = came?.sent ? came.tookItsPlace : undefined
    if (next === undefined) throw new Error(`nothing took its place: ${JSON.stringify(came)}`)
    await waitFor(() => turnsOf(next).includes('are you there'), 'the words in its place')
    await nextTick()
    expect(surface.place.value).toBe(LAUNCHER)
    expect(surface.surface.value).toBe('launcher')
    expect(surface.activeId.value).toBe(id)
    // It is still reachable: the store holds it, fed here, for the rail to list.
    expect(store.isLive(next)).toBe(true)
  })
})
