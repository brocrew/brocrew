import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * A provider that is only slow is waited for. Starting, reopening after a close, and stopping a
 * turn to send instead each end when the provider answers, fails, exits or the person stops it —
 * never because time passed. Every case runs on a Claude and a Codex double.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * Short values for the waits the host used to give up after, so a host that still gives up does
 * so within the test; a host that waits ignores them. Not typed as deps on purpose: the point is
 * that none of them may end a wait.
 */
const SHORT_OLD_BOUNDS: Record<string, number> = {
  launchTimeoutMs: 40,
  closeDrainTimeoutMs: 20,
  interruptWaitMs: 40,
}

/** Comfortably past every shortened bound above. */
const PAST_THE_OLD_BOUNDS_MS = 300

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

interface Held {
  promise: Promise<void>
  release: () => void
}

/** Every gate a test made, so none is left holding a teardown after it. */
const gates: Held[] = []

function held(): Held {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  const gate = { promise, release }
  gates.push(gate)
  return gate
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (predicate()) return
    await pause(5)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Where a promise stands now: settled one way or the other, or still waiting. */
async function standing(
  promise: Promise<unknown>,
): Promise<'resolved' | 'pending' | { rejected: string }> {
  return await Promise.race([
    promise.then(
      () => 'resolved' as const,
      (error: unknown) => ({ rejected: error instanceof Error ? error.message : String(error) }),
    ),
    pause(0).then(() => 'pending' as const),
  ])
}

/**
 * What the test controls about the provider: when a start or resume answers, when a close
 * finishes, when a stop takes effect, and what text each handle was sent.
 */
interface ProviderControls {
  startHeld: Held | null
  resumeHeld: Held | null
  closeHeld: Held | null
  stopHeld: Held | null
  readonly sent: string[]
  readonly handles: SessionHandle[]
  readonly launchesAsked: number[]
}

/** Whether these words reached the provider, inside whatever this app wraps them in. */
function wentIn(controls: ProviderControls, words: string): boolean {
  return controls.sent.some((text) => text.includes(words))
}

function controlled(
  handle: SessionHandle,
  controls: ProviderControls,
  closeHeld: Held | null,
  stopHeld: Held | null,
): SessionHandle {
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'send') {
        return async (text: string, ...rest: unknown[]): Promise<void> => {
          controls.sent.push(text)
          await (target.send as (...args: unknown[]) => Promise<void>)(text, ...rest)
        }
      }
      if (property === 'close' && closeHeld !== null) {
        return async (): Promise<void> => {
          await target.close()
          await closeHeld.promise
        }
      }
      if (property === 'interrupt' && stopHeld !== null) {
        return async (): Promise<void> => {
          await stopHeld.promise
          await target.interrupt()
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  controls.handles.push(proxied)
  return proxied
}

describe.each<Provider>(['claude', 'codex'])('a slow %s provider is waited for', (provider) => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let controls: ProviderControls

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-slow-provider-'))
    const userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    controls = {
      startHeld: null,
      resumeHeld: null,
      closeHeld: null,
      stopHeld: null,
      sent: [],
      handles: [],
      launchesAsked: [],
    }
    const real = new FakeRuntime(provider)
    let counter = 0
    const deps: RuntimeHostDeps = {
      store,
      discoverSessions: NO_DISCOVERY,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath: () => null,
      createRuntime: (): AgentRuntime => ({
        provider,
        listModels: (context) => real.listModels(context),
        start: async (options) => {
          controls.launchesAsked.push(Date.now())
          const startHeld = controls.startHeld
          if (startHeld !== null) await startHeld.promise
          return controlled(
            await real.start(options),
            controls,
            controls.closeHeld,
            controls.stopHeld,
          )
        },
        resume: async (ref, options) => {
          controls.launchesAsked.push(Date.now())
          const resumeHeld = controls.resumeHeld
          if (resumeHeld !== null) await resumeHeld.promise
          return controlled(
            await real.resume(ref, options),
            controls,
            controls.closeHeld,
            controls.stopHeld,
          )
        },
      }),
      prepareProviderHome: (p, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, p),
      providerHomePath: (p, profileId) => join(userData, 'provider-homes', 'default', profileId, p),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (p, home) => ({
        home,
        homeEnv: p === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    }
    host = new RuntimeHost({ ...deps, ...SHORT_OLD_BOUNDS })
  })

  afterEach(async () => {
    for (const gate of gates.splice(0)) gate.release()
    await host.closeAll()
    if (db.open) db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const anOpenConversation = async (sink: RecordingSink, approvalMode?: 'ask'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, cwd: join(dir, 'work'), ...(approvalMode ? { approvalMode } : {}) },
      sink,
    )
    return sessionId
  }

  it('a new conversation whose provider answers late opens, and nothing closes it', async () => {
    controls.startHeld = held()
    const sink = new RecordingSink()
    const opening = host.createSession({ provider, cwd: join(dir, 'work') }, sink)
    await waitFor(() => controls.launchesAsked.length === 1, 'the provider to be asked to start')
    await pause(PAST_THE_OLD_BOUNDS_MS)
    expect(await standing(opening)).toBe('pending')

    controls.startHeld.release()
    const { sessionId } = await opening
    expect(host.sessionIds).toContain(sessionId)
    expect(controls.handles).toHaveLength(1)
    expect(controls.handles[0]!.status()).not.toBe('ended')

    await host.send(sessionId, 'hello after a slow start', sink)
    await waitFor(() => wentIn(controls, 'hello after a slow start'), 'the message to go in')
  })

  it('a message to a stopped conversation whose provider reopens late goes in once it answers', async () => {
    const sink = new RecordingSink()
    const sessionId = await anOpenConversation(sink)
    await host.close(sessionId, sink)
    await waitFor(() => !host.sessionIds.includes(sessionId), 'the conversation to be put away')

    controls.resumeHeld = held()
    const sending = host.send(sessionId, 'are you there?', sink)
    await waitFor(() => controls.launchesAsked.length === 2, 'the provider to be asked to reopen')
    await pause(PAST_THE_OLD_BOUNDS_MS)
    expect(await standing(sending)).toBe('pending')
    expect(wentIn(controls, 'are you there?')).toBe(false)

    controls.resumeHeld.release()
    await expect(sending).resolves.toBeUndefined()
    await waitFor(() => wentIn(controls, 'are you there?'), 'the message to go in')
  })

  it('a reopen while the last session is still being put away waits for it, then opens', async () => {
    const closeHeld = held()
    controls.closeHeld = closeHeld
    const sink = new RecordingSink()
    const sessionId = await anOpenConversation(sink)
    controls.closeHeld = null
    const closing = host.close(sessionId, sink)
    await pause(PAST_THE_OLD_BOUNDS_MS)

    const reopening = host.resumeSession(sessionId, new RecordingSink('owner:2'))
    await pause(PAST_THE_OLD_BOUNDS_MS)
    expect(await standing(reopening)).toBe('pending')

    closeHeld.release()
    await expect(reopening).resolves.toMatchObject({ sessionId })
    await closing
  })

  it('a message sent while the last session is still being put away goes in after it', async () => {
    const closeHeld = held()
    controls.closeHeld = closeHeld
    const sink = new RecordingSink()
    const sessionId = await anOpenConversation(sink)
    controls.closeHeld = null
    const closing = host.close(sessionId, sink)
    await pause(PAST_THE_OLD_BOUNDS_MS)

    const sending = host.send(sessionId, 'one more thing', sink)
    await pause(PAST_THE_OLD_BOUNDS_MS)
    expect(await standing(sending)).toBe('pending')

    closeHeld.release()
    await expect(sending).resolves.toBeUndefined()
    await waitFor(() => wentIn(controls, 'one more thing'), 'the message to go in')
    await closing
  })

  it('stop-and-send on a turn the provider is slow to stop holds the words and sends them when it stops', async () => {
    controls.stopHeld = held()
    const sink = new RecordingSink()
    const sessionId = await anOpenConversation(sink, 'ask')
    await host.send(sessionId, 'the long turn', sink)
    const turnHandle = controls.handles.at(-1)!
    await waitFor(() => turnHandle.status() !== 'idle', 'the first turn to be running')

    const replacing = host.sendInterrupting(sessionId, 'do this instead', sink)
    // Past the two seconds and five seconds the host used to wait before refusing.
    await pause(5_600)
    expect(await standing(replacing)).toBe('pending')
    expect(controls.sent).toHaveLength(1)
    expect(wentIn(controls, 'do this instead')).toBe(false)

    controls.stopHeld.release()
    await expect(replacing).resolves.toBeUndefined()
    await waitFor(() => wentIn(controls, 'do this instead'), 'the replacement to go in')
    expect(controls.sent).toHaveLength(2)
  }, 20_000)
})

describe('a sign-in nobody has finished yet stays open until it is finished or cancelled', () => {
  let dir: string
  let host: RuntimeHost
  let finish: ((outcome: { success: boolean; state: { state: 'usable' } }) => void) | null
  let cancelled: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-slow-sign-in-'))
    finish = null
    cancelled = 0
    let settle: (outcome: {
      success: boolean
      state: { state: 'usable' | 'unknown'; reason?: string }
    }) => void
    const auth = {
      credentialHome: (provider: Provider, profileId: string) =>
        join(dir, 'provider-homes', profileId, provider),
      check: async () => ({ state: 'usable' as const }),
      reprovision: async () => 'replaced' as const,
      signIn: async () => ({
        authUrl: 'https://example.invalid/fictional-login',
        completed: new Promise<{
          success: boolean
          state: { state: 'usable' | 'unknown'; reason?: string }
        }>((resolve) => {
          settle = resolve
          finish = resolve
        }),
        // As the real flow does: a cancel ends the sign-in it withdraws.
        cancel: async () => {
          cancelled += 1
          settle({ success: false, state: { state: 'unknown', reason: 'canceled' } })
        },
      }),
    }
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) => join(dir, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => 'sess_1',
      listProfiles: () => ['default'],
      providerAuth: auth as unknown as RuntimeHostDeps['providerAuth'],
      openExternal: async () => {},
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await host.closeAll()
    rmSync(dir, { recursive: true, force: true })
  })

  it('is still open past five minutes, and completes when the person finishes in the browser', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const flow = host.signInProvider('codex', 'default')
    let outcome: unknown = null
    void flow.then((result) => {
      outcome = result
    })
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000)
    expect(outcome).toBeNull()
    expect(cancelled).toBe(0)
    finish?.({ success: true, state: { state: 'usable' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(await flow).toMatchObject({ success: true })
  })

  it('ends when the person cancels it', async () => {
    const flow = host.signInProvider('codex', 'default')
    await vi.waitFor(() => expect(finish).not.toBeNull())
    await host.cancelProviderSignIn('codex', 'default')
    expect(await flow).toMatchObject({ success: false })
    // Asked once by the Cancel, and once more by the sign-in's own clean-up, as on every path.
    expect(cancelled).toBeGreaterThanOrEqual(1)
  })
})
