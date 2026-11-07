import {
  codexFixtureConfig,
  neutralHostDeps,
  NonPersonSink as RecordingSink,
} from './lib/host-fixture'
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
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { createLaunchRegistry } from '../src/main/runtime/launch-registry'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { readLines } from '../src/main/archive/native-file'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

function processFixtureDeps(folder: () => string) {
  let counter = 0
  const home = (provider: Provider) => join(folder(), 'homes', provider)
  return {
    ...neutralHostDeps(folder),
    prepareProviderHome: home,
    providerHomePath: home,
    resolveCwd: (sessionId: string, requested?: string) =>
      requested ?? join(folder(), 'scratch', sessionId),
    newSessionId: () => `sess_${++counter}`,
    readProviderConfig: codexFixtureConfig,
  }
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

async function expectWaitingForExit(work: Promise<unknown>): Promise<void> {
  let settled = false
  void work.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(settled).toBe(false)
}

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

    launches.finish(one, terminating.promise)

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
    launches.finish(one)
    expect(launches.refuse('sess_1')).toBe('its provider has not confirmed it stopped')

    terminating.resolve()
    await one.settled
    expect(launches.refuse('sess_1')).toBeNull()
  })

  it('lets a probe be in flight without blocking any session', () => {
    const launches = createLaunchRegistry()
    launches.open('codex model probe')

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

  function buildHost(
    seen: { tornDown: string[]; signals: (AbortSignal | undefined)[] },
    alsoOnLaunch?: (signal: AbortSignal | undefined) => void,
  ) {
    const never = deferred()
    return new RuntimeHost({
      store,
      ...processFixtureDeps(() => dir),
      createRuntime: (provider): AgentRuntime => ({
        provider,
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
          await never.promise
          throw new Error('unreachable in this test')
        },
        resume: () => Promise.reject(new Error('not used here')),
      }),
      closeDrainTimeoutMs: 40,
    })
  }

  it('a quit TERMINATES a start whose handshake never answers, instead of walking past it', async () => {
    const seen = { tornDown: [] as string[], signals: [] as (AbortSignal | undefined)[] }
    host = buildHost(seen)
    const creating = host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink())
    void creating.catch(() => {})
    await waitFor(() => seen.signals.length === 1, 'the provider to be asked for')

    expect(seen.tornDown).toEqual([])
    await expect(host.closeAll()).resolves.toBeUndefined()

    expect(seen.tornDown).toEqual(['start'])
    expect(seen.signals[0]?.aborted).toBe(true)
  })

  it('still returns within its bound while it does it', async () => {
    const seen = { tornDown: [] as string[], signals: [] as (AbortSignal | undefined)[] }
    host = buildHost(seen)
    void host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink()).catch(() => {})
    await waitFor(() => seen.signals.length === 1, 'the provider to be asked for')

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
    const runtimes = new Map<string, AgentRuntime>()
    return new RuntimeHost({
      store,
      ...processFixtureDeps(() => dir),
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
            if (arriving) await arriving.promise
            gated = gateClose(handle, closing.promise, () => closeAttempts++)
            return gated.handle
          },
        }
        runtimes.set(provider, wrapped)
        return wrapped
      },
      closeDrainTimeoutMs: 40,
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

  it('a resume waits while the handed-back provider is still closing', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'claude', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')
    await host.close(created.sessionId, sink)
    resumes = 0
    arriving = deferred()

    const reopening = host.resumeSession(created.sessionId, new RecordingSink('owner:1'))
    void reopening.catch(() => {})
    await waitFor(() => resumes === 1, 'the resume to reach the provider')

    const abandoning = host.close(created.sessionId, sink)
    arriving.resolve()
    await abandoning
    await expect(reopening).rejects.toThrow('was closed while it was opening')
    expect(closeAttempts).toBe(1)
    const handedBack = gated
    expect(handedBack?.closed()).toBe(false)

    const next = host.resumeSession(created.sessionId, new RecordingSink('owner:2'))
    try {
      await expectWaitingForExit(next)
      expect(resumes).toBe(1)
      expect(handedBack?.closed()).toBe(false)
    } finally {
      arriving = null
      closing.resolve()
    }
    await waitFor(() => handedBack?.closed() === true, 'the provider to finish closing')
    await expect(next).resolves.toMatchObject({ sessionId: created.sessionId })
    expect(resumes).toBe(2)
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
    expect(tally.unreadableLines).toBe(0)
    expect(JSON.stringify(store.events('sess_tail'))).not.toContain('the third')
  })

  it('an ordinary import reads it once the rest of the line lands', async () => {
    const { path, rest } = plantMidWrite()
    await deriveLedger(store, 'sess_tail', 'codex', fromFile(path), { fallbackAt: 1_000 })

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
    const sessions = new FakeProviderSessions()
    return new RuntimeHost({
      store,
      ...processFixtureDeps(() => dir),
      createRuntime: (provider): AgentRuntime => {
        const real = new FakeRuntime(provider, { sessions })
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
      closeDrainTimeoutMs: 40,
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
    closing.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records the session terminal and lets it go, and keeps its ledger the recording', async () => {
    const created = await host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink())

    await host.closeAll()

    expect(store.find(created.sessionId)?.status).toBe('ended')
    expect(host.sessionIds).toEqual([])
    const status = store.ledgerStatus(created.sessionId)
    expect(status.present).toBe(true)
    expect(status.derived).toBeNull()
  })

  it('222 §3 · a turn open when an UNCONFIRMED stop let go is recorded `unknown`, not `ended`', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await host.send(created.sessionId, 'run the build', sink)
    await waitFor(
      () => store.turns(created.sessionId).some((turn) => turn.closedAt === null),
      'an open turn',
    )

    await host.closeAll()

    const turns = store.turns(created.sessionId)
    const last = turns[turns.length - 1]
    expect(last?.closedAt, 'the turn must be closed, or nothing was recorded at all').not.toBeNull()
    expect(last?.endReason).toBe('unknown')
    expect(store.find(created.sessionId)?.status).toBe('ended')
    expect(store.recordedOne(created.sessionId)?.lastEnding).toBe('unknown')
  })

  it('keeps the reopen waiting until the provider really goes', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')
    await host.close(created.sessionId, sink)

    expect(host.sessionIds).toEqual([])
    const next = host.resumeSession(created.sessionId, new RecordingSink('owner:2'))
    try {
      await expectWaitingForExit(next)
      expect(host.sessionIds).toEqual([])
    } finally {
      closing.resolve()
    }
    await expect(next).resolves.toMatchObject({ sessionId: created.sessionId })
  })
})

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
    host = new RuntimeHost({
      store,
      ...processFixtureDeps(() => dir),
      nativeTranscriptPath: () => {
        order.push('archive-read')
        return transcript
      },
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
    })
  })

  afterEach(() => {
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('the quit stops the provider while the session is still registered, and reads no transcript', async () => {
    await host.createSession({ provider: 'codex', cwd: dir }, new RecordingSink())

    host.stopSweeping()
    await host.closeAll()
    await host.drainArchiveWork()

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

  const bothLists = () =>
    Promise.all([
      host.providerModels(DEFAULT_PROFILE_ID, 'claude'),
      host.providerModels(DEFAULT_PROFILE_ID, 'codex'),
    ])

  function buildHost() {
    return new RuntimeHost({
      store,
      ...processFixtureDeps(() => dir),
      createRuntime: (provider): AgentRuntime => ({
        provider,
        listModels: async (context: ProviderRuntimeContext) => {
          probes.push({ provider, signal: context.signal })
          await Promise.race([
            answering.promise,
            new Promise<void>((resolve) => {
              context.signal?.addEventListener('abort', () => resolve())
            }),
          ])
          await new Promise((resolve) => setTimeout(resolve, 50))
          finished.push(provider)
          return []
        },
        start: () => Promise.reject(new Error('not used here')),
        resume: () => Promise.reject(new Error('not used here')),
      }),
      closeDrainTimeoutMs: 200,
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

    await host.closeAll()

    expect(finished.sort()).toEqual(['claude', 'codex'])
    for (const probe of probes) expect(probe.signal?.aborted).toBe(true)
    await asking
  })

  it('refuses a NEW probe once the quit has begun, and spawns nothing', async () => {
    await host.closeAll()

    await expect(bothLists()).rejects.toThrow('shutting down')
    expect(probes).toEqual([])
  })

  it('still answers from a probe that already finished', async () => {
    answering.resolve()
    const before = await bothLists()
    await host.closeAll()

    await expect(bothLists()).resolves.toEqual(before)
    expect(probes).toHaveLength(2)
  })
})

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
    return new RuntimeHost({
      store,
      ...processFixtureDeps(() => dir),
      createRuntime: (which): AgentRuntime => new FakeRuntime(which, { exit, sessions: provider }),
      closeDrainTimeoutMs: 40,
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
    exit.confirm()
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('⛔ when close resolved but nothing exited, says the turn was interrupted', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await host.send(created.sessionId, 'run the build', sink)
    await waitFor(
      () => store.turns(created.sessionId).some((turn) => turn.closedAt === null),
      'an open turn',
    )

    await host.close(created.sessionId, sink)

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
    expect(store.find(created.sessionId)?.status).toBe('ended')
  })

  it('keeps the launch, so a reopen waits until the resolved close has a proven exit', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await waitFor(() => store.find(created.sessionId)?.ref !== undefined, 'the provider ref')

    await host.close(created.sessionId, sink)

    expect(host.sessionIds).toEqual([])
    expect(exit.isConfirmed).toBe(false)
    const next = host.resumeSession(created.sessionId, new RecordingSink('owner:2'))
    try {
      await expectWaitingForExit(next)
      expect(exit.isConfirmed).toBe(false)
      expect(host.sessionIds).toEqual([])
    } finally {
      exit.confirm()
    }
    await expect(next).resolves.toMatchObject({ sessionId: created.sessionId })
  })

  it('⛔ warns on the quit instead of certifying a clean stop', async () => {
    const sink = new RecordingSink()
    await host.createSession({ provider: 'codex', cwd: dir }, sink)

    await host.closeAll()

    expect(exit.isConfirmed).toBe(false)
    expect(warnings.join('\n')).toContain('had not confirmed termination')
    expect(warnings.join('\n')).toContain('may still be running')
  })

  it('⚑ …and a PROVEN exit releases the id, and warns about nothing', async () => {
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex', cwd: dir }, sink)
    await host.send(created.sessionId, 'run the build', sink)
    await waitFor(
      () => store.turns(created.sessionId).some((turn) => turn.closedAt === null),
      'an open turn',
    )
    exit.confirm()

    await host.close(created.sessionId, sink)

    await expect(
      host.resumeSession(created.sessionId, new RecordingSink('owner:2')),
    ).resolves.toMatchObject({ sessionId: created.sessionId })
    expect(warnings.join('\n')).not.toContain('did not confirm it stopped')

    await host.closeAll()
    expect(warnings.join('\n')).not.toContain('had not confirmed termination')
  })
})

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
    host = new RuntimeHost({
      store,
      ...processFixtureDeps(() => dir),
      createRuntime: (which): AgentRuntime => {
        const real = new FakeRuntime(which, { exit, sessions: provider })
        return {
          provider: which,
          listModels: (context) => real.listModels(context),
          start: async (options) => {
            const handle = await real.start(options)
            starts++
            await arriving.promise
            return handle
          },
          resume: (ref, options) => real.resume(ref, options),
        }
      },
      closeDrainTimeoutMs: 40,
    })
  })

  afterEach(async () => {
    arriving.resolve()
    exit.confirm()
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps a reopen pending after handBack until exit, then says the conversation was never recorded', async () => {
    const sink = new RecordingSink()
    const creating = host.createSession({ provider: 'codex', cwd: dir }, sink)
    creating.catch(() => {})
    await waitFor(() => starts === 1, 'the start to reach the provider')

    const abandoning = host.close('sess_1', sink)
    arriving.resolve()
    await abandoning
    await creating.catch(() => {})

    expect(exit.isConfirmed).toBe(false)
    expect(store.recordedOne('sess_1')).toBeNull()
    const next = host.resumeSession('sess_1', new RecordingSink('owner:2'))
    try {
      await expectWaitingForExit(next)
      expect(starts).toBe(1)
      expect(exit.isConfirmed).toBe(false)
    } finally {
      exit.confirm()
    }
    await expect(next).rejects.toMatchObject({ cause: { unavailable: 'not-recorded' } })
    expect(store.recordedOne('sess_1')).toBeNull()
    expect(starts).toBe(1)
  })
})
