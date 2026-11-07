import { neutralHostDeps, NonPersonSink as RecordingSink } from './lib/host-fixture'
import { migratedSessionStore } from './lib/migrated-session-store'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'

function saidClosed(sink: RecordingSink): boolean {
  return sink.messages.some(
    (message) => message.event.type === 'status' && message.event.state === 'ended',
  )
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('a conversation the app has said is closed can be reopened (075, from 072 §5.3)', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let gate: { promise: Promise<void>; resolve: () => void }
  let handles: SessionHandle[]
  let resumed: string[]

  function gateClose(handle: SessionHandle): SessionHandle {
    const proxied: SessionHandle = new Proxy(handle, {
      get(target, property) {
        if (property === 'close') {
          return async (): Promise<void> => {
            await target.close()
            await gate.promise
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
    handles.push(proxied)
    return proxied
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-reopen-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    store = migratedSessionStore(db)
    gate = deferred()
    handles = []
    resumed = []
    const runtimes = new Map<string, FakeRuntime>()
    let counter = 0
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => dir),
      createRuntime: (provider): AgentRuntime => {
        const real = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, real)
        return {
          provider,
          listModels: (context) => real.listModels(context),
          start: async (options) => gateClose(await real.start(options)),
          resume: async (ref, options) => {
            resumed.push(ref.sessionId)
            return gateClose(await real.resume(ref, options))
          },
        }
      },
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 5_000,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    gate.resolve()
    await host.closeAll()
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function openOne(sink: RecordingSink): Promise<string> {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: join(dir, 'work') },
      sink,
    )
    return sessionId
  }

  it('reopens a conversation whose teardown is still running, instead of refusing it', async () => {
    const first = new RecordingSink('owner:1')
    const sessionId = await openOne(first)

    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    expect(host.sessionIds).toContain(sessionId)

    const reopening = host.resumeSession(sessionId, new RecordingSink('owner:2'))
    gate.resolve()

    await expect(reopening).resolves.toMatchObject({ sessionId })
    await closing
  })

  it('waits the same way for a session that ended on its OWN, which never sets the phase', async () => {
    const first = new RecordingSink('owner:1')
    const sessionId = await openOne(first)
    const slots = (host as unknown as { slots: Map<string, { phase: string }> }).slots
    expect(slots.get(sessionId)?.phase).toBe('live')

    const handle = handles.at(-1)
    if (!handle) throw new Error('no handle to end the stream on')
    const ending = handle.close().catch(() => {})
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    expect(slots.get(sessionId)?.phase).toBe('live')

    const reopening = host.resumeSession(sessionId, new RecordingSink('owner:2'))
    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId })
    await ending
  })

  it('🔴 265 §1 · a reopen whose window is released mid-wait starts no provider', async () => {
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const resumesBefore = resumed.length

    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')
    expect(host.sessionIds).toContain(sessionId)

    const reopening = host.resumeSession(sessionId, new RecordingSink('webContents:7'))
    reopening.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(resumed.length, 'still suspended — the provider has not been asked').toBe(resumesBefore)

    const released = host.closeSessionsForOwner(first.ownerId)
    const replacement = new RecordingSink('webContents:7')
    expect(host.attachOpenSessions(replacement)).toEqual([])

    gate.resolve()
    await expect(reopening).rejects.toThrow(/window that asked for this conversation went away/)
    await released
    await closing
    expect(resumed.length, 'no provider was resumed for a document that no longer exists').toBe(
      resumesBefore,
    )
    expect(host.sessionIds).toEqual([])
  })

  it('⚑ …and the same reopen succeeds when the window does NOT go away', async () => {
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    const reopening = host.resumeSession(sessionId, new RecordingSink('webContents:7'))
    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId })
    await closing
  })

  it('⚑ 652 · …and a reopen with NO surface is not refused by that release — it had nobody to lose', async () => {
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const resumesBefore = resumed.length
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    const reopening = host.resumeSession(sessionId, null)
    reopening.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(resumed.length, 'still suspended — the provider has not been asked').toBe(resumesBefore)
    const released = host.closeSessionsForOwner(first.ownerId)

    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId, startedWithoutAWindow: true })
    await released
    await closing
    expect(resumed.length, 'the provider WAS resumed, for nobody in particular').toBe(
      resumesBefore + 1,
    )
    expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([sessionId])
  })

  it('⚑ …and a release for a DIFFERENT window does not touch it', async () => {
    const first = new RecordingSink('webContents:7')
    const sessionId = await openOne(first)
    const closing = host.close(sessionId, first)
    await waitFor(() => saidClosed(first), 'the app to say the conversation ended')

    const reopening = host.resumeSession(sessionId, new RecordingSink('webContents:7'))
    reopening.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    await host.closeSessionsForOwner('webContents:99')

    gate.resolve()
    await expect(reopening).resolves.toMatchObject({ sessionId })
    await closing
  })

  it('does not hand back a conversation that is on its way out', async () => {
    const owner = new RecordingSink('owner:1')
    const sessionId = await openOne(owner)
    expect(host.attachOpenSessions(owner)).toHaveLength(1)

    const closing = host.close(sessionId, owner)
    await waitFor(() => saidClosed(owner), 'the app to say the conversation ended')

    expect(host.sessionIds).toContain(sessionId)
    expect(host.attachOpenSessions(owner)).toEqual([])

    gate.resolve()
    await closing
  })

  it('still refuses a second window a conversation that is genuinely OPEN', async () => {
    const sessionId = await openOne(new RecordingSink('owner:1'))

    const refused = await host
      .resumeSession(sessionId, new RecordingSink('owner:2'))
      .then(() => null)
      .catch((error: unknown) => (error as Error).message)

    expect(refused).toBe(
      'This conversation is already open in another window. Switch to that window to carry on with it.',
    )
    expect(refused).not.toContain(sessionId)
  })

  it('hands a conversation back to the surface that already owns it, instead of refusing it', async () => {
    const owner = new RecordingSink('owner:1')
    const sessionId = await openOne(owner)
    const before = handles.length

    const attached = await host.resumeSession(sessionId, new RecordingSink('owner:1'))

    expect(attached.sessionId).toBe(sessionId)
    expect(handles).toHaveLength(before)
    expect(host.sessionIds).toEqual([sessionId])
  })

  it('waits for a closed start to finish stopping, rather than refusing the reopen as still closing', async () => {
    let asked = false
    let stoppedAt = 0
    const STOPS_AFTER_MS = 150
    const stuck = new RuntimeHost({
      store,
      ...neutralHostDeps(() => dir),
      createRuntime: (provider): AgentRuntime => ({
        provider,
        listModels: () => Promise.resolve([]),
        start: (options) => {
          asked = true
          return new Promise<never>((_, reject) => {
            options.signal?.addEventListener(
              'abort',
              () =>
                setTimeout(() => {
                  stoppedAt = Date.now()
                  reject(new Error('the start was cancelled'))
                }, STOPS_AFTER_MS),
              { once: true },
            )
          })
        },
        resume: () => new Promise<never>(() => {}),
      }),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => 'sess_stuck',
      closeDrainTimeoutMs: 20,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })
    const sink = new RecordingSink()
    void stuck.createSession({ provider: 'claude', cwd: join(dir, 'work') }, sink).catch(() => {})
    await waitFor(() => asked, 'the provider to be asked for')
    await stuck.close('sess_stuck', sink)

    const reopened = await stuck.resumeSession('sess_stuck', new RecordingSink('owner:2')).then(
      () => null,
      (error: unknown) => error,
    )
    const answeredAt = Date.now()
    expect(stoppedAt).toBeGreaterThan(0)
    expect(answeredAt).toBeGreaterThanOrEqual(stoppedAt)
    const said = reopened instanceof Error ? reopened.message : ''
    expect(said).not.toContain('putting away')
    expect(said).not.toContain('already open')
    await stuck.closeAll()
  })
})
