import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProcessExit,
  FakeProviderSessions,
  FakeRuntime,
  type AgentRuntime,
  type ProviderRuntimeContext,
  type SessionHandle,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { createLaunchRegistry } from '../src/main/runtime/launch-registry'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { readLines } from '../src/main/archive/native-file'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * **Own every process you started, at every moment — including the ones nobody registered** (070,
 * from 068 findings 1, 2, 3 and 7).
 *
 * 062 fixed the ordinary path; the first independent review broke the edges and found one defect
 * wearing four faces: **ownership was recorded after an asynchronous external spawn, and released
 * before termination was confirmed.**
 *
 * ⚠️ **Every test here exists because an existing one could not reach it**, and 068 said so case by
 * case. That is the standard this file has to meet, so each block names the counterexample:
 *
 *  - the second-quit test sent event two only AFTER awaiting the whole shutdown;
 *  - the never-arriving-start test kept the process alive so a late JavaScript callback could run;
 *  - the hand-back tests used immediately-closing fakes and never resumed during a deferred close;
 *  - a half-written last line was read as a whole one;
 *  - and nothing anywhere exercised a model probe's lifetime.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * ⚑ **D-017b · the `not-confirmed-stopped` refusal's own clause** — it said *"its agent has not
 * confirmed that it stopped"*, a process fact (`05` rule 5), and now says what BroBot2 has not
 * finished. ⛔ One literal for the refusal AND for the paired *no longer refused for that reason*
 * below, so the negative cannot go vacuous under a rewording the positive did not follow.
 */
const NOT_CONFIRMED_STOPPED = 'has not finished putting away its last session'

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

/**
 * A handle whose `close()` can be held open — the lever 068 said the hand-back tests were missing
 * ("immediately closing fakes"). A Proxy rather than a subclass or a spread: the Fake's state lives
 * in own fields its own methods mutate, so anything that re-homes `this` quietly stops being the
 * session under test.
 */
function gateClose(
  handle: SessionHandle,
  gate: Promise<void>,
  onClose: () => void,
): { handle: SessionHandle; closed: () => boolean } {
  let finished = false
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          onClose()
          await gate
          await target.close()
          finished = true
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return { handle: proxied, closed: () => finished }
}

describe('the launch registry (070)', () => {
  it('refuses a second launch for a subject until the first TERMINATION settles', async () => {
    const launches = createLaunchRegistry()
    const one = launches.open('session sess_1', 'sess_1')
    const terminating = deferred()

    // The caller is done — it has stopped waiting, which every caller here does on a bound.
    launches.finish(one, terminating.promise)

    // ⚠️ The finding in one assertion (068 #2): "hand-back frees the reservation before
    // termination". Handing the launch back is not the same as the process being gone.
    expect(launches.refuse('sess_1')).toBe('its provider has not confirmed it stopped')

    terminating.resolve()
    await one.settled
    expect(launches.refuse('sess_1')).toBeNull()
  })

  it('releases a launch that terminated by FAILING, not only one that terminated cleanly', async () => {
    const launches = createLaunchRegistry()
    const one = launches.open('session sess_1', 'sess_1')
    launches.finish(one, Promise.reject(new Error('the adapter threw on the way out')))

    await one.settled
    // A teardown that threw still ended the process's story here. Holding the id forever would make
    // one bad adapter permanently un-resumable, which is a different bug in the same family.
    expect(launches.refuse('sess_1')).toBeNull()
  })

  it('waits for what a cancellation started, not merely for the cancellation', async () => {
    const launches = createLaunchRegistry()
    const probe = launches.open('codex model probe')
    const tearingDown = deferred()
    const aborted: string[] = []
    probe.signal.addEventListener('abort', () => {
      aborted.push('abort')
      launches.finish(probe, tearingDown.promise)
    })

    launches.closeAdmission()
    expect(aborted).toEqual(['abort'])

    let settled = false
    void launches.pending().then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    // The whole point of `pending()`: the child is still going down, so the quit is still waiting.
    expect(settled).toBe(false)

    tearingDown.resolve()
    await launches.pending()
    expect(launches.size).toBe(0)
  })

  it('finishes once — the first call, the one carrying the termination, decides', async () => {
    const launches = createLaunchRegistry()
    const one = launches.open('session sess_1', 'sess_1')
    const terminating = deferred()

    launches.finish(one, terminating.promise)
    // `createSession`'s catch calls this after `handBack` already did. If the later, bare call won,
    // it would erase the very promise the ownership rests on.
    launches.finish(one)
    expect(launches.refuse('sess_1')).toBe('its provider has not confirmed it stopped')

    terminating.resolve()
    await one.settled
    expect(launches.refuse('sess_1')).toBeNull()
  })

  it('lets a probe be in flight without blocking any session', () => {
    const launches = createLaunchRegistry()
    launches.open('codex model probe')

    // A probe carries no subject on purpose. Giving it a synthetic one would let an unfinished probe
    // refuse a real session that merely collided with the name.
    expect(launches.refuse('sess_1')).toBeNull()
    expect(launches.size).toBe(1)
  })

  it('refuses everything once admission is closed, subject or not', () => {
    const launches = createLaunchRegistry()
    launches.closeAdmission()

    expect(() => launches.open('session sess_1', 'sess_1')).toThrow('shutting down')
    expect(() => launches.open('codex model probe')).toThrow('shutting down')
  })
})

describe('a launch nobody has a handle for is still terminable (070, from 068 finding 2)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost | null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-launch-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    host = null
  })

  afterEach(() => {
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * A runtime that spawns and then waits — the shape 068 measured on Codex, where the detached
   * transport exists before the awaited handshake. `tornDown` is the child; the signal is the only
   * thing that can reach it, because no handle ever leaves this function.
   */
  function buildHost(
    seen: { tornDown: string[]; signals: (AbortSignal | undefined)[] },
    alsoOnLaunch?: (signal: AbortSignal | undefined) => void,
  ) {
    let counter = 0
    const never = deferred()
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider): AgentRuntime => ({
        provider,
        // ⚑ **D-042 · R1 moved a fact here: a launch NAMES its model and effort before it spawns**,
        // and a Codex launch naming nothing reads `model/list` and names its `isDefault` row at that
        // row's own default effort. An empty list now refuses the launch (`nothing-names-a-model`,
        // F2) before `start` — so no signal is ever handed out and there is no wedged handshake for
        // the quit to reach. One row, marked as Codex marks its default, keeps the wedge the
        // HANDSHAKE's, which is what 068 measured.
        listModels: () =>
          Promise.resolve([
            {
              id: 'fake',
              label: 'fake',
              isDefault: true as const,
              efforts: [{ id: 'medium', label: 'medium' }],
              defaultEffort: 'medium',
            },
          ]),
        start: async (options) => {
          seen.signals.push(options.signal)
          options.signal?.addEventListener('abort', () => seen.tornDown.push('start'))
          alsoOnLaunch?.(options.signal)
          // The handshake that never answers. Nothing below this line ever runs, which is the
          // condition the old coverage could only simulate by keeping a late callback alive.
          await never.promise
          throw new Error('unreachable in this test')
        },
        resume: () => Promise.reject(new Error('not used here')),
      }),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
  }

  it('a quit TERMINATES a start whose handshake never answers, instead of walking past it', async () => {
    const seen = { tornDown: [] as string[], signals: [] as (AbortSignal | undefined)[] }
    host = buildHost(seen)
    const creating = host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink())
    void creating.catch(() => {})
    await waitFor(() => seen.signals.length === 1, 'the provider to be asked for')

    // ⚠️ **This is the case 068 said had no coverage.** The old test released the start so a late
    // JavaScript callback could hand the handle back — which is only possible while the process is
    // alive. Here the launch never resolves at all, so the ONLY thing that can reach the child is
    // the cancel, and there was none.
    expect(seen.tornDown).toEqual([])
    await expect(host.closeAll()).resolves.toBeUndefined()

    expect(seen.tornDown).toEqual(['start'])
    // …and the launch context really carried it, rather than the host merely holding a controller.
    expect(seen.signals[0]?.aborted).toBe(true)
  })

  it('still returns within its bound while it does it', async () => {
    const seen = { tornDown: [] as string[], signals: [] as (AbortSignal | undefined)[] }
    host = buildHost(seen)
    void host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink()).catch(() => {})
    await waitFor(() => seen.signals.length === 1, 'the provider to be asked for')

    // The hazard the fix could have introduced, and 062's own rule: a quit that never completes is
    // worse for the user than the orphan it is trying to avoid. Cancelling is not waiting.
    //
    // ⚠️ This one is a HAZARD guard and proves nothing about the mechanism — the review pointed out
    // it would pass just as well if the wait had been left out altogether. The test below is the
    // half that would not.
    const began = Date.now()
    await host.closeAll()
    expect(Date.now() - began).toBeLessThan(1_500)
  })

  it('cancels ONE session when one window closes, without touching the others', async () => {
    const seen = { tornDown: [] as string[], signals: [] as (AbortSignal | undefined)[] }
    host = buildHost(seen)
    void host
      .createSession({ provider: 'codex', cwd: dir }, new RecordingSink('owner:1'))
      .catch(() => {})
    void host
      .createSession({ provider: 'codex', cwd: dir }, new RecordingSink('owner:2'))
      .catch(() => {})
    await waitFor(() => seen.signals.length === 2, 'both providers to be asked for')

    // ⚠️ The review's point: `closeAll` goes through `closeAdmission`, which aborts EVERYTHING — so
    // every test that quits would still pass with `launches.cancel(slot.launch)` deleted from
    // `close()`. The per-slot cancel has its own caller (a window going away, or the Close button on
    // a session whose provider is still starting), and this is the only thing that exercises it.
    await host.closeSessionsForOwner('owner:1')

    expect(seen.signals[0]?.aborted).toBe(true)
    expect(seen.signals[1]?.aborted).toBe(false)
    expect(seen.tornDown).toEqual(['start'])
  })
})

describe('hand-back keeps the id until the provider is really gone (070, from 068 finding 2)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let arriving: { promise: Promise<void>; resolve: () => void } | null
  let closing: { promise: Promise<void>; resolve: () => void }
  let resumes: number
  let closeAttempts: number
  let gated: { handle: SessionHandle; closed: () => boolean } | null

  function buildHost() {
    let counter = 0
    const runtimes = new Map<string, AgentRuntime>()
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider): AgentRuntime => {
        const cached = runtimes.get(provider)
        if (cached) return cached
        const real = new FakeRuntime(provider)
        const wrapped: AgentRuntime = {
          provider,
          listModels: (context) => real.listModels(context),
          start: (options) => real.start(options),
          resume: async (ref, options) => {
            resumes += 1
            const handle = await real.resume(ref, options)
            // Held AFTER the handle exists, so a close landing now finds a provider to hand back —
            // the interval `whyNotOurs` refuses in.
            if (arriving) await arriving.promise
            gated = gateClose(handle, closing.promise, () => closeAttempts++)
            return gated.handle
          },
        }
        runtimes.set(provider, wrapped)
        return wrapped
      },
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-handback-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    arriving = null
    closing = deferred()
    resumes = 0
    closeAttempts = 0
    gated = null
    host = buildHost()
  })

  afterEach(async () => {
    arriving?.resolve()
    closing.resolve()
    await host.closeAll().catch(() => {})
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a resume attempted while the handed-back provider is still closing', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'claude', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')
    await host.close(created.sessionId, sink)
    resumes = 0
    arriving = deferred()

    // A reopen, closed while its provider is still starting — the hand-back path.
    const reopening = host.resumeSession(created.sessionId, new RecordingSink('owner:1'))
    void reopening.catch(() => {})
    await waitFor(() => resumes === 1, 'the resume to reach the provider')

    const abandoning = host.close(created.sessionId, sink)
    arriving.resolve()
    // The bound expires here: `close()` returns, the caller has stopped waiting, and `close()` on
    // the handle has NOT come back. This is the exact state 068 described and no test could enter,
    // because the fakes closed immediately.
    await abandoning
    // The SENTENCE, not the diagnostic (100): the raw text — which names the session id — still
    // goes to the log, and what a caller is handed no longer carries it.
    await expect(reopening).rejects.toThrow('was closed while it was opening')
    expect(closeAttempts).toBe(1)
    const handedBack = gated
    expect(handedBack?.closed()).toBe(false)

    // ⚠️ **Two providers for one record must be impossible.** Before 070 the reservation was freed
    // on the first line of `handBack`, so this resume was admitted and spawned a second child onto
    // the same transcript while the first was still shutting down.
    await expect(
      host.resumeSession(created.sessionId, new RecordingSink('owner:2')),
    ).rejects.toThrow(NOT_CONFIRMED_STOPPED)
    expect(resumes).toBe(1)

    // …and the id comes back the moment the provider really is gone. Refusing forever would be a
    // different bug: a conversation permanently unopenable because one close was slow.
    arriving = null
    closing.resolve()
    await waitFor(() => handedBack?.closed() === true, 'the provider to finish closing')
    await expect(
      host.resumeSession(created.sessionId, new RecordingSink('owner:3')),
    ).resolves.toMatchObject({ sessionId: created.sessionId })
  })
})

describe('a derive never reads a half-written last line (070, from 068 finding 3)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-tail-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    store.adopt({
      id: 'sess_tail',
      provider: 'codex',
      sessionId: 'thread_tail',
      cwd: dir,
      profileId: 'default',
      updatedAt: 1_000,
      createdAt: 1_000,
    })
  })

  afterEach(() => {
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** One Codex message, as its rollout keeps it. */
  const said = (role: 'user' | 'assistant', text: string): string =>
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: {
        type: 'message',
        role,
        content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
      },
    })

  /** Two whole lines and a third caught mid-write — a JSONL writer between the object and its `\n`. */
  function plantMidWrite(): { path: string; whole: string[]; rest: string } {
    const whole = [said('user', 'the first'), said('assistant', 'the second')]
    const last = said('user', 'the third')
    const cut = last.slice(0, 20)
    const path = join(dir, 'rollout.jsonl')
    writeFileSync(path, `${whole.join('\n')}\n${cut}`)
    return { path, whole, rest: last.slice(20) }
  }

  it('the line reader says when the last line arrived without its newline', () => {
    const { path } = plantMidWrite()
    const chunk = readLines(path, 0, 100)

    expect(chunk.done).toBe(true)
    expect(chunk.partial).toBe(true)
    // A file that ends properly is not partial — the distinction has to be real in both directions
    // or the guard is a constant.
    const clean = join(dir, 'clean.jsonl')
    writeFileSync(clean, 'a\nb\n')
    expect(readLines(clean, 0, 100)).toMatchObject({
      done: true,
      partial: false,
      lines: ['a', 'b'],
    })
  })

  const fromFile =
    (path: string) =>
    (from: number, maxLines: number): ReturnType<typeof readLines> =>
      readLines(path, from, maxLines)

  it('leaves a half-written tail unpublished so an ordinary import can retry', async () => {
    const { path } = plantMidWrite()
    const tally = { eventsWritten: 0, unreadableLines: 0 }
    const before = store.ledgerStatus('sess_tail')

    const outcome = await deriveLedger(store, 'sess_tail', 'codex', fromFile(path), {
      fallbackAt: 1_000,
      tally,
    })

    expect(outcome).toBe('still-writing')
    expect(store.ledgerStatus('sess_tail').derivedThrough).toBe(before.derivedThrough)
    expect(store.ledgerStatus('sess_tail').normalizerVersion).toBe(before.normalizerVersion)
    expect(store.ledgerStatus('sess_tail').derived).not.toBe('current')
    // ⚠️ **Not read as an unreadable line**: half a record is not a record yet.
    expect(tally.unreadableLines).toBe(0)
    expect(JSON.stringify(store.events('sess_tail'))).not.toContain('the third')
  })

  it('an ordinary import reads it once the rest of the line lands', async () => {
    const { path, rest } = plantMidWrite()
    await deriveLedger(store, 'sess_tail', 'codex', fromFile(path), { fallbackAt: 1_000 })

    // The writer finishes the object it was in the middle of.
    writeFileSync(path, `${readFileSync(path, 'utf8')}${rest}\n`)
    const tally = { eventsWritten: 0, unreadableLines: 0 }
    const again = await deriveLedger(store, 'sess_tail', 'codex', fromFile(path), {
      fallbackAt: 1_000,
      tally,
    })

    expect(again).toBe('imported')
    expect(store.ledgerStatus('sess_tail').derivedThrough).toBe(3)
    expect(tally.unreadableLines).toBe(0)
    expect(JSON.stringify(store.events('sess_tail'))).toContain('the third')
  })
})

describe('a provider the host could not confirm stopped (070)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let closing: { promise: Promise<void>; resolve: () => void }

  function buildHost() {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider): AgentRuntime => {
        const real = new FakeRuntime(provider)
        return {
          provider,
          listModels: (context) => real.listModels(context),
          start: async (options) => {
            const handle = await real.start(options)
            return gateClose(handle, closing.promise, () => {}).handle
          },
          resume: (ref, options) => real.resume(ref, options),
        }
      },
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-unconfirmed-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    closing = deferred()
    host = buildHost()
  })

  afterEach(async () => {
    // Released and given a turn before the connection goes: the gated close ends the stream, and a
    // pump still delivering into a closed database is noise this test is not about.
    closing.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records the session terminal and lets it go, and keeps its ledger the recording', async () => {
    const created = await host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink())

    // The stop times out — `closeDrainTimeoutMs` is 40ms and `closing` is never resolved here — so
    // the host lets go of a provider it could not confirm stopped.
    await host.closeAll()

    // 051's order is unchanged by the receipt: the session is still recorded terminal and let go.
    expect(store.find(created.sessionId)?.status).toBe('ended')
    expect(host.sessionIds).toEqual([])
    // …and 065's contract still reads it honestly: this ledger is a RECORDING, so `derived` is null.
    const status = store.ledgerStatus(created.sessionId)
    expect(status.present).toBe(true)
    expect(status.derived).toBeNull()
  })

  /**
   * ⛔ **222 §3, from 208 H3 — the turn's ending is the RECEIPT's to state.**
   *
   * H3: *"Claude's bounded cleanup is promoted into a false process-termination receipt… timeout
   * should produce unknown/still owned."* The finalizer was hard-coding the TURN's ending to
   * `'ended'` on both branches — so a teardown that could confirm nothing wrote the same durable
   * ending as one that could, and 222's Sessions page then said it in the same word.
   *
   * ⚑ **The paired positive is six tests in `session-ownership.test.ts`** (`endReason: 'ended'` on
   * every ending whose provider DID stop). Without them this would be satisfiable by writing
   * `'unknown'` unconditionally, which would be the same lie pointed the other way.
   */
  it('222 §3 · a turn open when an UNCONFIRMED stop let go is recorded `unknown`, not `ended`', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    // A turn has to be OPEN for there to be an ending to over-claim. `FakeRuntime` opens one on
    // send and this test never lets it finish — the close is what interrupts it.
    await host.send(created.sessionId, 'run the build', sink)
    await waitFor(
      () => store.turns(created.sessionId).some((turn) => turn.closedAt === null),
      'an open turn',
    )

    // `closing` is never resolved here, so `stopProvider` times out at 40ms and the host lets go of
    // a provider it could not confirm stopped — H3's exact condition.
    await host.closeAll()

    const turns = store.turns(created.sessionId)
    const last = turns[turns.length - 1]
    expect(last?.closedAt, 'the turn must be closed, or nothing was recorded at all').not.toBeNull()
    expect(last?.endReason).toBe('unknown')
    // ⚠️ **The SESSION is still terminal.** 222 §3's scope ruling: the ending we SHOW must not claim
    // more than the receipt knows; the row's own terminal state — this app has let go — is not in
    // doubt and is not tri-stated.
    expect(store.find(created.sessionId)?.status).toBe('ended')
    // …and the surface reads it. Without this the fix is a database detail nobody meets.
    expect(store.recordedOne(created.sessionId)?.lastEnding).toBe('unknown')
  })

  it('keeps the id refused until the provider really goes', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')
    await host.close(created.sessionId, sink)

    // The slot is gone — the session is over as far as the UI is concerned — but the process is not
    // confirmed down, and the UI's Reopen button is one click away.
    expect(host.sessionIds).toEqual([])
    await expect(
      host.resumeSession(created.sessionId, new RecordingSink('owner:2')),
    ).rejects.toThrow(NOT_CONFIRMED_STOPPED)
  })
})

/**
 * **What 070 must NOT have moved** (acceptance 7): 051's order, the provider stopped while the host
 * still holds the handle.
 */
describe('051 is unchanged by 070', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let transcript: string
  let order: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-unchanged-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    order = []
    transcript = join(dir, 'rollout.jsonl')
    writeFileSync(transcript, `${JSON.stringify({ type: 'a' })}\n`)
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => {
        order.push('archive-read')
        return transcript
      },
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider): AgentRuntime => {
        const real = new FakeRuntime(provider)
        return {
          provider,
          listModels: (context) => real.listModels(context),
          start: async (options) => {
            const handle = await real.start(options)
            return new Proxy(handle, {
              get(target, property) {
                if (property === 'close') {
                  return async (): Promise<void> => {
                    // 051's rule: the provider is stopped WHILE the host still holds the handle.
                    order.push(`close(registered:${host.sessionIds.length})`)
                    await target.close()
                  }
                }
                const value = Reflect.get(target, property, target) as unknown
                return typeof value === 'function' ? (value as () => unknown).bind(target) : value
              },
            })
          },
          resume: (ref, options) => real.resume(ref, options),
        }
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
    })
  })

  afterEach(() => {
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('the quit stops the provider while the session is still registered, and reads no transcript', async () => {
    await host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink())

    // The real order: stop making catch-up work, close the sessions, drain what was admitted.
    host.stopSweeping()
    await host.closeAll()
    await host.drainArchiveWork()

    // 051's order: the provider was stopped while the session was still registered — and a close
    // copies nothing, so the provider's file is not read on the way out.
    expect(order).toEqual(['close(registered:1)'])
    expect(host.sessionIds).toEqual([])
  })
})

describe('model probes are owned (070, from 068 finding 7)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let probes: { provider: string; signal: AbortSignal | undefined }[]
  let answering: { promise: Promise<void>; resolve: () => void }
  let finished: string[]

  /** ⚑ D-049 · both providers' lists, each asked through the host's one-provider read. */
  const bothLists = () =>
    Promise.all([
      host.providerModels(DEFAULT_PROFILE_ID, 'claude'),
      host.providerModels(DEFAULT_PROFILE_ID, 'codex'),
    ])

  function buildHost() {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider): AgentRuntime => ({
        provider,
        listModels: async (context: ProviderRuntimeContext) => {
          probes.push({ provider, signal: context.signal })
          // The 15-second window 068 measured, compressed: a real provider child exists for all of
          // it, and only the adapter's `finally` would close it.
          await Promise.race([
            answering.promise,
            new Promise<void>((resolve) => {
              context.signal?.addEventListener('abort', () => resolve())
            }),
          ])
          // ⚠️ **A teardown that takes measurable time, deliberately.** Aborting is the ASK; closing
          // the child is the work, and Codex's is end stdin → SIGTERM the group → SIGKILL. Resolving
          // instantly here would let this test pass whether or not `closeAll` waits for anything.
          await new Promise((resolve) => setTimeout(resolve, 50))
          finished.push(provider)
          return []
        },
        start: () => Promise.reject(new Error('not used here')),
        resume: () => Promise.reject(new Error('not used here')),
      }),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 200,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-probe-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    probes = []
    answering = deferred()
    finished = []
    host = buildHost()
  })

  afterEach(() => {
    answering.resolve()
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('hands every probe a cancel', async () => {
    const asking = bothLists()
    await waitFor(() => probes.length === 2, 'both providers to be probed')

    // Both, not one: each provider's probe is its own child, and a probe without a signal is a
    // child nothing can reach.
    expect(probes.map((p) => p.provider).sort()).toEqual(['claude', 'codex'])
    for (const probe of probes) expect(probe.signal).toBeInstanceOf(AbortSignal)

    answering.resolve()
    await asking
  })

  it('aborts a probe in flight and WAITS for it before the quit finishes', async () => {
    const asking = bothLists()
    void asking.catch(() => {})
    await waitFor(() => probes.length === 2, 'both providers to be probed')
    expect(finished).toEqual([])

    // ⚠️ **`closeAll()` owned only session slots.** A probe has no slot — it is not a session — so
    // quitting here terminated Electron with two authenticated children mid-handshake, and repeated
    // quick launches accumulated them.
    //
    // There are no sessions at all in this test, so `Promise.all(slots)` is empty: the ONLY thing
    // that can make `closeAll` take any time is the launch wait. Delete `settledWithin(pending())`
    // and `finished` is still empty on the next line. This is the assertion that proves the wait,
    // rather than the bound test above, which proves only that it ends.
    await host.closeAll()

    expect(finished.sort()).toEqual(['claude', 'codex'])
    for (const probe of probes) expect(probe.signal?.aborted).toBe(true)
    await asking
  })

  it('refuses a NEW probe once the quit has begun, and spawns nothing', async () => {
    await host.closeAll()

    await expect(bothLists()).rejects.toThrow('shutting down')
    // The refusal is before the spawn, not after it — the same rule `createSession` follows.
    expect(probes).toEqual([])
  })

  it('still answers from a probe that already finished', async () => {
    answering.resolve()
    const before = await bothLists()
    await host.closeAll()

    // A cached answer is a value, not a process. Refusing it would take a list away from a read made
    // while the app winds down, for no safety gained.
    await expect(bothLists()).resolves.toEqual(before)
    expect(probes).toHaveLength(2)
  })
})

/**
 * ⛔ **`terminated` must mean terminated** (233, from 229 H1, verified by the PM).
 *
 * ## The shape no test in this repository could hold
 *
 * Every "the provider did not stop" test above — and the whole of the `gateClose` lever this file
 * is built on — models a `close()` that **never resolves**. That proves the host's outer timeout
 * maps to `unknown`, and it is a different defect from the one 229 H1 found.
 *
 * ⚠️ **The Claude shape is a `close()` that resolves FALSELY**, and it resolves on time. The
 * adapter awaits `withTimeout(query.return(), 5 s)` over an SDK `performCleanup()` that races
 * `transport.waitForExit()` against 2 000 ms — so every layer under it always resolves — while the
 * SDK's own transport has SIGTERM scheduled 2 s out and SIGKILL 5 s after that, both `unref`'d.
 * `runFinalize` then read timely settlement as *the provider stopped*: `writerStopped: true` on the
 * archive, `'ended'` on the turn (222's `stopped ? 'ended' : 'unknown'` could not reach its second
 * branch), the id freed, and `closeAll()` with nothing to warn about. A reopen inside that window
 * starts a SECOND writer against a live process.
 *
 * Nothing above could say it, because the double could not: `FakeSessionHandle.close()` has no
 * `await` in its body and there was no process behind it to disagree. {@link FakeProcessExit} is
 * the property being added to the double (179 §4), and these are the four consequences it makes
 * visible — each one a thing the app CERTIFIED on no evidence.
 */
describe('233 · a close that resolves is not a process that exited (from 229 H1)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let exit: FakeProcessExit
  let provider: FakeProviderSessions
  let warnings: string[]
  let realWarn: typeof console.warn

  function buildHost(): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      // ⚑ **The plain double, with a process.** No `gateClose` anywhere: `close()` resolves
      // promptly and on its own, exactly as Claude's does, and the ONLY thing that has not happened
      // is the exit.
      //
      // ⚠️ The provider-side record is SHARED across calls (186), because `createRuntime` is called
      // again for the reopen: a fresh `FakeProviderSessions` per call would refuse the resume as an
      // unissued ref, and the positive test would then pass for the wrong reason — a refusal that
      // says nothing about whether ownership was released.
      createRuntime: (which): AgentRuntime => new FakeRuntime(which, { exit, sessions: provider }),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-terminated-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    exit = new FakeProcessExit()
    provider = new FakeProviderSessions()
    warnings = []
    realWarn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '))
    host = buildHost()
  })

  afterEach(async () => {
    console.warn = realWarn
    // Let the process go before the connection does, so a launch this suite still owns cannot keep
    // a later `closeAll` waiting.
    exit.confirm()
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * ⚠️ **The turn's ending is `interrupted` here, and 233's own brief expected `unknown`.** Traced
   * before it was written down: `unknown` is what `store.terminate` writes for a turn still OPEN
   * when it runs, and in this scenario no turn is. Every adapter terminalises its own turn inside
   * `close()` and does it FIRST — Claude runs `machine.forceEnd()` and only then awaits
   * `detachQueryAwaitingExit()` — so a `close()` that RESOLVES has always interrupted the turn on
   * its way, whatever the process did afterwards. `interrupted` is therefore the honest ending: the
   * adapter really did interrupt that turn.
   *
   * ⚑ **So `unknown` is not a consequence of this fix, and saying it was would be the over-claim
   * this dispatch exists to remove.** It stays reachable exactly where 222 put it and where Block E
   * pins it — a close that never resolves, so the turn is still open at `store.terminate`. What 233
   * makes reachable is 208 H3's OTHER half, *"still owned"*, and the three facts below are it.
   */
  it('⛔ when close resolved but nothing exited, says the turn was interrupted', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await host.send(created.sessionId, 'run the build', sink)
    await waitFor(
      () => store.turns(created.sessionId).some((turn) => turn.closedAt === null),
      'an open turn',
    )

    await host.close(created.sessionId, sink)

    // ⚑ **The anti-vacuity pair, and it is the whole test.** If `close()` had merely hung, this
    // would be indistinguishable from Block E — so the two halves are asserted separately:
    //
    //  - the adapter's teardown RAN TO COMPLETION. `session:'ended'` is emitted by the last line of
    //    `FakeSessionHandle.doClose()`, exactly as it is by Claude's, so its presence is the only
    //    observation from out here that says the close resolved rather than hung. Under Block E's
    //    gated close this event never arrives.
    //  - and the process was never declared gone.
    //
    // ⚠️ The second line alone was the first draft of this test, and it is a TAUTOLOGY: nothing in
    // the host, the runtime or the double ever calls `confirm()`. Found by this dispatch's own
    // adversarial pass, which is the second time that pass has caught an assertion that could not
    // fail.
    expect(
      sink.messages.some((m) => m.event.type === 'session' && m.event.state === 'ended'),
      'the adapter teardown completed — this is a resolved close, not a hung one',
    ).toBe(true)
    expect(exit.isConfirmed, 'the process was never declared gone').toBe(false)

    const turns = store.turns(created.sessionId)
    const last = turns[turns.length - 1]
    expect(last?.closedAt, 'the turn must be closed, or nothing was recorded').not.toBeNull()
    expect(last?.endReason, 'the adapter really did interrupt it — see the note above').toBe(
      'interrupted',
    )
    // The session is still terminal — 222 §3's ruling is untouched.
    expect(store.find(created.sessionId)?.status).toBe('ended')
  })

  it('⛔ keeps the launch, so a reopen into the gap is refused with a sentence', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')

    await host.close(created.sessionId, sink)

    // The slot is gone — the UI has moved this conversation to Reopen — and the process is not.
    expect(host.sessionIds).toEqual([])
    expect(exit.isConfirmed).toBe(false)
    await expect(
      host.resumeSession(created.sessionId, new RecordingSink('owner:2')),
    ).rejects.toThrow(NOT_CONFIRMED_STOPPED)
    // ⛔ **Refused, not raced.** Before 233 this resume SUCCEEDED against a live process, because
    // `launches.finish` had been handed the resolved teardown as the termination fact.
  })

  it('⛔ warns on the quit instead of certifying a clean stop', async () => {
    const sink = new RecordingSink()
    await host.createSession({ provider: 'codex', cwd: dir }, sink)

    await host.closeAll()

    expect(exit.isConfirmed).toBe(false)
    // 202 built this warning; 229 H3 made it unreachable for Claude, because the registry had
    // already released every launch by the time `closeAll` counted them.
    expect(warnings.join('\n')).toContain('had not confirmed termination')
    expect(warnings.join('\n')).toContain('may still be running')
  })

  /**
   * ⚑ **The paired positive, and without it every assertion above is satisfiable by writing
   * `unknown` unconditionally** — the same lie pointed the other way, which is what 222's own
   * response warned about. Same host, same double, same close: the ONLY difference is that the
   * process really exits.
   */
  it('⚑ …and a PROVEN exit releases the id, and warns about nothing', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await host.send(created.sessionId, 'run the build', sink)
    await waitFor(
      () => store.turns(created.sessionId).some((turn) => turn.closedAt === null),
      'an open turn',
    )
    // ⚑ The only difference from the tests above is the receipt.
    exit.confirm()

    await host.close(created.sessionId, sink)

    // ⚑ **Ownership released, asserted as the mirror of the refusal two tests up.** A resume that
    // RESOLVES is the only observation available from outside that `launches.finish` let the entry
    // go — and it is the better one, because it is the user-visible consequence: the Reopen button
    // works the moment the process is really gone.
    await expect(
      host.resumeSession(created.sessionId, new RecordingSink('owner:2')),
    ).resolves.toMatchObject({ sessionId: created.sessionId })
    expect(warnings.join('\n')).not.toContain('did not confirm it stopped')

    await host.closeAll()
    expect(warnings.join('\n')).not.toContain('had not confirmed termination')
  })
})

/**
 * ⛔ **The other two hand-back sites, which 233's first draft did not reach** (found by its own
 * adversarial pass, four lenses independently).
 *
 * `doStopProvider` is not the only place a launch is given back while a handle is in hand.
 * {@link RuntimeHost.handBack} — the provider that arrives for a slot somebody has since closed —
 * registered the bounded `close()` too, under a comment promising the opposite: *"the id stays
 * refused for exactly as long as we do not know"*. For Claude that promise was false, on the one
 * gesture a user reaches in two clicks: **press Close while a conversation is starting, then press
 * Reopen.** The teardown resolves in ~200 ms with the CLI child alive, the id is freed, and the
 * reopen starts a second writer against a live process — the very race 070 built the registry for.
 *
 * ⚑ Block C above already drives this path, and could not see it: its lever is `gateClose`, a close
 * that never resolves. A close that resolves FALSELY needed the double to own a process.
 */
describe('233 · a launch handed back while starting is owned against the process too', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let exit: FakeProcessExit
  let arriving: { promise: Promise<void>; resolve: () => void }
  let starts: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-handback-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    exit = new FakeProcessExit()
    arriving = deferred()
    starts = 0
    const provider = new FakeProviderSessions()
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (which): AgentRuntime => {
        const real = new FakeRuntime(which, { exit, sessions: provider })
        return {
          provider: which,
          listModels: (context) => real.listModels(context),
          // The launch does not answer until the test says so — so a Close can land INSIDE it,
          // which is the only way to reach `handBack`.
          start: async (options) => {
            const handle = await real.start(options)
            starts++
            await arriving.promise
            return handle
          },
          resume: (ref, options) => real.resume(ref, options),
        }
      },
      prepareProviderHome: (which) => join(dir, 'homes', which),
      providerHomePath: (which) => join(dir, 'homes', which),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (_which, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    arriving.resolve()
    exit.confirm()
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('⛔ keeps the id refused after handBack, until the process is proven gone', async () => {
    const sink = new RecordingSink()
    const creating = host.createSession({ provider: 'codex', cwd: dir }, sink)
    creating.catch(() => {})
    // The reservation exists but the session does not — `sessionIds` deliberately lists only
    // REGISTERED sessions — so the launch reaching the provider is what says we are inside it.
    await waitFor(() => starts === 1, 'the start to reach the provider')

    // Close lands INSIDE the launch: the slot is marked closing, and the handle that arrives next
    // is handed back rather than registered. This is `handBack`.
    const abandoning = host.close('sess_1', sink)
    arriving.resolve()
    await abandoning
    await creating.catch(() => {})

    // The teardown resolved — the double's `close()` has no `await` in its body, exactly as a
    // wedged Claude's resolves on the SDK's bounded receipt — and the process did not.
    expect(exit.isConfirmed).toBe(false)
    await expect(host.resumeSession('sess_1', new RecordingSink('owner:2'))).rejects.toThrow(
      NOT_CONFIRMED_STOPPED,
    )

    // ⚑ **The paired positive: the refusal is the OWNERSHIP's, and it lifts when the process goes.**
    // Asserted as "no longer refused for that reason" rather than as a successful reopen, because a
    // handed-back launch never registered a provider ref for one to resume onto — so a resolved
    // resume here would be a different claim than the one under test.
    exit.confirm()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await expect(host.resumeSession('sess_1', new RecordingSink('owner:2'))).rejects.not.toThrow(
      NOT_CONFIRMED_STOPPED,
    )
  })
})
