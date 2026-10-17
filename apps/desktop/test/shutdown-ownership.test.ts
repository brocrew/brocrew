import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { createAppLifetime } from '../src/main/app-lifetime'
import { createArchiveCoordinator, isArchiveRefused } from '../src/main/archive/archive-coordinator'
import type { UserHomeSession } from '../src/main/adopt/user-homes'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * **The quit must wait for the import work it admitted, and it must not miss a provider that is
 * still starting** (062, from 061 findings 1 and 2).
 *
 * Two defects, one shape: the host did not own the thing it was responsible for.
 *
 *  1. One sticky boolean stood for several different ideas — cancel the background work, refuse new
 *     work, and (by omission) drain. So everything here has an import already in flight, part-way
 *     through a file.
 *  2. Ownership began when `start()`/`resume()` RESOLVED. In the interval before that — an external
 *     process spawn, the slowest thing this app does — a quit walked a map the provider was not in
 *     yet, and the handle then registered into a host that was already down.
 *
 * Driven against a REAL SQLite database and, where the claim is about ordering, through the real
 * `createAppLifetime`: "the connection closed after the import finished" is not a property a fake
 * store can hold an opinion about.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('the archive coordinator (062)', () => {
  it('refuses new background work once the gate is closed, and says which kind of refusal it is', async () => {
    const archives = createArchiveCoordinator()
    archives.rejectNewBackgroundWork()

    const refused = await archives.background(() => Promise.resolve('ran')).catch((e: unknown) => e)

    expect(isArchiveRefused(refused)).toBe(true)
    // Refusals are told apart from failures, because a caller with an honest "nothing happened"
    // answer of its own must not report a quit as an error the user should act on.
    expect(isArchiveRefused(new Error('the disk went away'))).toBe(false)
  })

  it('drains the work in flight before it returns, including work that failed', async () => {
    const archives = createArchiveCoordinator()
    const finished: string[] = []
    const slow = deferred()

    const background = archives.background(async () => {
      await slow.promise
      finished.push('background')
      throw new Error('the file went away mid-pass')
    })
    // In flight, and nothing about it has settled when the drain starts, which is the case the old
    // shutdown had no answer for at all.
    const drained = archives.drain().then(() => finished.push('drain'))
    slow.resolve()

    await expect(background).rejects.toThrow('the file went away mid-pass')
    await drained
    // A job that failed is still a job that finished, and the drain must not reject on its behalf:
    // the only question it answers is whether anyone is still holding the connection.
    expect(finished).toEqual(['background', 'drain'])
  })

  it('refuses everything once drained, so nothing can start against a closed database', async () => {
    const archives = createArchiveCoordinator()
    await archives.drain()

    expect(archives.gate).toBe('closed')
    await expect(archives.background(() => Promise.resolve(1))).rejects.toThrow('shutting down')
  })

  it('runs background work one at a time, and a pass that threw does not block the next', async () => {
    const archives = createArchiveCoordinator()
    const order: string[] = []
    const first = deferred()

    const a = archives.background(async () => {
      order.push('a:start')
      await first.promise
      order.push('a:end')
      throw new Error('boom')
    })
    const b = archives.background(() => {
      order.push('b:start')
      return Promise.resolve()
    })

    await waitFor(() => order.length > 0, 'the first pass to start')
    expect(order).toEqual(['a:start'])
    first.resolve()
    await expect(a).rejects.toThrow('boom')
    await b

    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
  })

  it('starts a pass that was queued when the gate shut ALREADY cancelled, rather than refusing it', async () => {
    // Two passes, the second sitting behind the first when the quit arrives — the case the old
    // sticky flag got wrong by letting it run against a closing database.
    //
    // It still runs, and that is deliberate: it was admitted while the gate was open, so the drain
    // is holding the connection for it either way. What changes is that it starts with its answer
    // already given — no batches, nothing written. Refusing it here would hand the
    // caller an error for work the shutdown is waiting on regardless.
    const archives = createArchiveCoordinator()
    const first = deferred()
    let sawCancelled: boolean | null = null

    const a = archives.background(() => first.promise)
    const b = archives.background((cancelled) => {
      sawCancelled = cancelled()
      return Promise.resolve()
    })

    archives.rejectNewBackgroundWork()
    first.resolve()

    await a
    await b
    expect(sawCancelled).toBe(true)
    // …whereas one that arrives AFTER the gate shut never becomes the drain's problem at all.
    await expect(archives.background(() => Promise.resolve())).rejects.toThrow('shutting down')
  })
})

describe('a quit waits for the import in flight, and closes the database after it (062)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let transcript: string
  let found: UserHomeSession[]

  /**
   * A provider file holding a real conversation repeated past one derive batch (two thousand) — so
   * a stop can land between the batches, and what lands before it is derivable.
   */
  function plantLong(name: string): string {
    const fixture = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'fixtures/claude-transcript.jsonl'),
      'utf8',
    )
      .split('\n')
      .filter((line) => line !== '')
    const path = join(dir, `${name}.jsonl`)
    const repeats = Math.ceil(5_000 / fixture.length)
    writeFileSync(path, `${Array.from({ length: repeats }, () => fixture.join('\n')).join('\n')}\n`)
    return path
  }

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      // The session's provider file, which an import reads.
      nativeTranscriptPath: () => transcript,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      userHomeSessions: () => ({ found, skipped: [] }),
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  /** The real shutdown, in the real order, with a marker on every step the assertions need. */
  function quit(order: string[]) {
    const lifetime = createAppLifetime({
      // 271 §2. Recorded rather than stubbed away, so the assertions below see WHERE in the real
      // order the window is told — which is the whole of that finding: announced after any of these
      // steps, on an idle app it would be announced after the window had already gone.
      announceClosing: () => order.push('announceClosing'),
      stopArchiveWork: () => {
        order.push('stopArchiveWork')
        host.stopSweeping()
      },
      closeAllSessions: () => host.closeAll(),
      drainArchiveWork: () => {
        order.push('drain:start')
        return host.drainArchiveWork()
      },
      closeDatabase: () => {
        // 🔴 **273, from `272` finding 1.** Recorded here and nowhere else, because this is the ONE
        // moment the ordering claim is about: the renderer→main door has to be shut BEFORE this
        // line, not alongside it. Written as two different words rather than a boolean so a failure
        // reads as what it is in the order array below.
        order.push(host.closing ? 'door:shut' : 'door:open')
        order.push('closeDatabase')
        db.close()
      },
      quit: () => order.push('quit'),
      // Reachable only from a repeated quit SIGNAL, which nothing here sends — recorded rather than
      // stubbed away, so a shutdown that took this door would show up in the order below (163).
      exit: (code) => order.push(`exit:${code}`),
      // 294: the real shutdown arms a deadline outside this process; here it is only recorded.
      armLastResort: (withinMs) => order.push(`armLastResort:${String(withinMs)}`),
      log: (message, error) => order.push(`log:${message} ${String(error)}`),
      // The real clock, because this harness runs the REAL host: the report it produces is about a
      // teardown that genuinely closes providers, and freezing time here would make every number in
      // it zero.
      now: () => Date.now(),
    })
    lifetime.beforeQuit({ preventDefault: () => {} })
    return lifetime
  }

  /** Re-open the database the quit closed. What survived a shutdown is only readable this way. */
  function reopen(): { db: AppDatabase; store: SessionStore } {
    const reopened = openDatabase(join(dir, 'brobot2.sqlite'))
    return { db: reopened, store: createSessionStore(reopened) }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-shutdown-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    host = buildHost()
    found = []
    transcript = plantLong('long')
  })

  afterEach(() => {
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('waits for an import ALREADY IN FLIGHT and MID-FILE, and closes SQLite only after it', async () => {
    const order: string[] = []
    let batches = 0
    let quitting: ReturnType<typeof quit> | null = null

    // The witness is the WRITE itself, stamped as it happens. "Did anything write after the
    // connection closed?" is then a question about this list rather than about timing luck.
    const real = store
    const watched: SessionStore = {
      ...real,
      appendGeneration: (sessionId, generation, entries) => {
        real.appendGeneration(sessionId, generation, entries)
        order.push('write')
        // The quit lands part-way through the file.
        if (++batches === 1) quitting = quit(order)
      },
    }
    host = buildHost({ store: watched })
    found = [
      {
        provider: 'claude',
        sessionId: 'thread-big',
        path: transcript,
        cwd: dir,
        profileId: null,
        bytes: 10_000,
        updatedAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      },
    ]

    // NOT awaited before the quit: awaiting it here would let the import settle and leave the
    // drain with nothing to wait for.
    const importing = host
      .importUserHomeSession('claude', 'thread-big')
      .finally(() => order.push('import:settled'))
    await waitFor(() => quitting !== null, 'the quit to be raised mid-file')
    await quitting!.shuttingDown
    const imported = await importing

    // It stopped where it was told, and said so as a STOP rather than as a failure.
    expect(imported.outcome).toBe('stopped')
    // **The ordering IS the finding.** The import settled before the connection closed, and no
    // write ever landed after it.
    expect(order.indexOf('import:settled')).toBeLessThan(order.indexOf('closeDatabase'))
    expect(order.lastIndexOf('write')).toBeLessThan(order.indexOf('closeDatabase'))
    // 🔴 **273's whole ordering claim** (from `272` finding 1): by the time this real connection
    // closes, the renderer→main door is already shut — so a session-list refresh arriving in that
    // window is refused with a sentence rather than answered out of a database that is gone.
    expect(order).toContain('door:shut')
    expect(order).not.toContain('door:open')
    expect(order.indexOf('door:shut')).toBeLessThan(order.indexOf('closeDatabase'))
    // And the stopped build published nothing: the row is there, with no conversation to read.
    const after = reopen()
    try {
      const recorded = after.store.recorded()
      expect(recorded).toHaveLength(1)
      expect(after.store.ledgerStatus(recorded[0]!.sessionId).present).toBe(false)
    } finally {
      after.db.close()
    }
  })

  it('never publishes a ledger from a file the quit cut short, and a later pass reads it whole', async () => {
    store.adopt({
      id: 'sess_adopted',
      provider: 'claude',
      sessionId: 'thread-adopted',
      cwd: dir,
      profileId: 'default',
      updatedAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
    })

    // The quit lands after the first batch, part-way through the file.
    const real = store
    let batches = 0
    host = buildHost({
      store: {
        ...real,
        appendGeneration: (sessionId, generation, entries) => {
          real.appendGeneration(sessionId, generation, entries)
          if (++batches === 1) host.stopSweeping()
        },
      },
    })

    await host.adoptSessions()
    // ⚑ Non-vacuity: the build did start, so it is the stop that kept it unpublished.
    expect(batches).toBe(1)
    expect(store.ledgerStatus('sess_adopted').present).toBe(false)

    // …and the conversation is deferred, not lost: a later pass reads the file and derives it.
    const later = buildHost()
    await later.adoptSessions()
    expect(store.ledgerStatus('sess_adopted').present).toBe(true)
  })
})

describe('a provider that is still starting is owned (062)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let starts: number
  let resumes: number
  let held: { promise: Promise<void>; resolve: () => void } | null

  /**
   * A runtime whose `start()` can be held open, so a test can stand inside the interval this task
   * is about — the provider spawned, the handle not yet in anyone's hands.
   */
  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    const handles: SessionHandle[] = []
    const runtimes = new Map<string, AgentRuntime>()
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      // One runtime per provider, memoized: `FakeRuntime` validates resume against the refs IT
      // issued, so a fresh instance per call would refuse every reopen as a forged ref.
      createRuntime: (provider): AgentRuntime => {
        const cached = runtimes.get(provider)
        if (cached) return cached
        const real = new FakeRuntime(provider)
        const wrapped: AgentRuntime = {
          provider,
          listModels: (context) => real.listModels(context),
          start: async (options) => {
            starts += 1
            const handle = await real.start(options)
            handles.push(handle)
            if (held) await held.promise
            return handle
          },
          resume: async (ref, options) => {
            resumes += 1
            const handle = await real.resume(ref, options)
            handles.push(handle)
            if (held) await held.promise
            return handle
          },
        }
        runtimes.set(provider, wrapped)
        return wrapped
      },
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
    return { host: built, handles }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-starting-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    starts = 0
    resumes = 0
    held = null
    host = buildHost().host
  })

  afterEach(async () => {
    held?.resolve()
    await host.closeAll()
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('closes a provider that arrives after the quit, instead of registering it', async () => {
    const built = buildHost()
    host = built.host
    held = deferred()
    const sink = new RecordingSink()

    const creating = host.createSession({ provider: 'codex', cwd: dir }, sink)
    await waitFor(() => starts === 1, 'the provider to be asked for')

    // `closeAll()` marks every slot SYNCHRONOUSLY before it awaits anything, so releasing the start
    // now lands it in a slot that is already closing. No sleep, no ordering luck.
    const closing = host.closeAll()
    held.resolve()
    await closing

    await expect(creating).rejects.toThrow('was closed while it was opening')
    // The cost 061 named: the quit used to walk past this provider entirely. Now it is stopped.
    expect(built.handles).toHaveLength(1)
    expect(built.handles[0]?.status()).toBe('ended')
    expect(host.sessionIds).toEqual([])
    // And it never registered, so nothing of it reached the database the quit is about to close.
    expect(store.recorded()).toEqual([])
    expect(db.prepare('SELECT count(*) AS c FROM events').get()).toEqual({ c: 0 })
  })

  it('does not let a provider that never arrives hold the quit open forever', async () => {
    // ⚠️ The hazard this task could have introduced. Waiting on the reservation is how a starting
    // provider stops being invisible — and waiting on it UNBOUNDED would mean one spawn that never
    // settles hangs the quit, which is worse for the user than the orphan it prevents. So the wait
    // is bounded on the same clock `stopProvider` already uses, and the app carries on.
    const built = buildHost({ closeDrainTimeoutMs: 40 })
    host = built.host
    held = deferred() // never resolved by this test — the provider simply never turns up

    const creating = host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink())
    void creating.catch(() => {}) // it settles in afterEach; nothing here awaits it
    await waitFor(() => starts === 1, 'the provider to be asked for')

    await expect(host.closeAll()).resolves.toBeUndefined()

    // …and the ownership half survives the timeout: the slot is still marked, so the handle is
    // stopped rather than registered whenever it does arrive. That is the part that must NOT be
    // bounded, and it is asserted by releasing the start afterwards.
    held.resolve()
    await expect(creating).rejects.toThrow('was closed while it was opening')
    expect(built.handles[0]?.status()).toBe('ended')
    expect(store.recorded()).toEqual([])
  })

  it('refuses a NEW session once the quit has begun', async () => {
    await host.closeAll()

    await expect(
      host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink()),
    ).rejects.toThrow('shutting down')
    // Nothing was even asked of the provider — the refusal is before the spawn, not after it.
    expect(starts).toBe(0)
  })

  it('takes a starting session with the window that asked for it, not just the registered ones', async () => {
    const built = buildHost()
    host = built.host
    held = deferred()
    const theirs = new RecordingSink('owner:2')

    const creating = host.createSession({ provider: 'codex', cwd: dir }, theirs)
    await waitFor(() => starts === 1, 'the provider to be asked for')

    // The owner id used to be read off the REGISTERED session's sink — a field that does not exist
    // during the one interval a window is most likely to vanish in.
    const releasing = host.closeSessionsForOwner('owner:2')
    held.resolve()
    await releasing

    await expect(creating).rejects.toThrow('was closed while it was opening')
    expect(built.handles[0]?.status()).toBe('ended')
  })

  it('leaves another window alone while it does it', async () => {
    const mine = new RecordingSink('owner:1')
    const created = await host.createSession({ provider: 'codex', cwd: dir }, mine)

    await host.closeSessionsForOwner('owner:2')

    expect(host.sessionIds).toEqual([created.sessionId])
  })

  it('resumes one record ONCE, however many callers ask at the same moment', async () => {
    // A recorded session to reopen.
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'claude', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')
    await host.close(created.sessionId, sink)
    resumes = 0

    const [first, second] = await Promise.allSettled([
      host.resumeSession(created.sessionId, new RecordingSink('owner:1')),
      host.resumeSession(created.sessionId, new RecordingSink('owner:2')),
    ])

    // ⚠️ **One spawn.** Both callers used to pass the `sessions.has()` check, both spawned a
    // provider, and the second overwrote the first in the map — leaving a child nothing could stop
    // and letting either finalizer unregister the survivor.
    expect(resumes).toBe(1)
    const outcomes = [first?.status, second?.status].sort()
    expect(outcomes).toEqual(['fulfilled', 'rejected'])
    const loser = [first, second].find((result) => result?.status === 'rejected')
    // Told, not silently attached to the winner's session: its events go to somebody else's sink.
    expect((loser as PromiseRejectedResult).reason).toMatchObject({
      // ⚠️ **`still opening`, and the change of sentence is the point** (100). The loser is
      // refused at the moment the WINNER is still spawning — nothing is open yet — and the one
      // word "already open" used to cover that state as well as two others. What must survive is
      // 062's rule, which is that the loser is TOLD rather than silently attached to the winner's
      // session; the assertion below that nothing was attached is the half that pins it.
      message: expect.stringContaining('still opening'),
    })
    expect(host.sessionIds).toEqual([created.sessionId])
  })

  it('refuses a second resume while the first is still SPAWNING, not only once it is live', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'claude', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')
    await host.close(created.sessionId, sink)
    resumes = 0
    held = deferred()

    const winner = host.resumeSession(created.sessionId, new RecordingSink('owner:1'))
    await waitFor(() => resumes === 1, 'the first resume to reach the provider')

    // The gap the old check could not see: reserved, spawning, not yet registered.
    await expect(
      host.resumeSession(created.sessionId, new RecordingSink('owner:2')),
      // ⚠️ **The sentence changed and it is more accurate** (100). Nothing is open here: the
      // slot is RESERVED and its provider has not arrived, which the one word 'already open'
      // covered for three different states. This is the one with no other way out, so it is
      // also the one whose sentence carries how long it has been waiting.
    ).rejects.toThrow('still opening')
    expect(resumes).toBe(1)

    held.resolve()
    await winner
  })
})
