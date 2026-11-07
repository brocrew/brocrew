import { neutralHostDeps, NonPersonSink as RecordingSink } from './lib/host-fixture'
import { migratedSessionStore } from './lib/migrated-session-store'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'

const SHORT_OLD_BOUNDS: Record<string, number> = {
  launchTimeoutMs: 40,
  closeDrainTimeoutMs: 20,
  interruptWaitMs: 40,
}

const PAST_THE_OLD_BOUNDS_MS = 300

interface Held {
  promise: Promise<void>
  release: () => void
}

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

interface ProviderControls {
  startHeld: Held | null
  resumeHeld: Held | null
  closeHeld: Held | null
  stopHeld: Held | null
  readonly sent: string[]
  readonly handles: SessionHandle[]
  readonly launchesAsked: number[]
}

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
    store = migratedSessionStore(db)
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
    const launch = async (gate: Held | null, start: () => Promise<SessionHandle>) => {
      controls.launchesAsked.push(Date.now())
      if (gate !== null) await gate.promise
      return controlled(await start(), controls, controls.closeHeld, controls.stopHeld)
    }
    let counter = 0
    const deps: RuntimeHostDeps = {
      store,
      ...neutralHostDeps(() => dir),
      createRuntime: (): AgentRuntime => ({
        provider,
        listModels: (context) => real.listModels(context),
        start: (options) => launch(controls.startHeld, () => real.start(options)),
        resume: (ref, options) => launch(controls.resumeHeld, () => real.resume(ref, options)),
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

  it.each(['its Stop', 'its window going away'] as const)(
    'a reopen waiting for the last session to be put away ends on %s, and starts nothing after',
    async (how) => {
      const closeHeld = held()
      controls.closeHeld = closeHeld
      const sink = new RecordingSink()
      const sessionId = await anOpenConversation(sink)
      controls.closeHeld = null
      const closing = host.close(sessionId, sink)
      await pause(PAST_THE_OLD_BOUNDS_MS)

      const window = new RecordingSink('owner:2')
      const reopening = host.resumeSession(sessionId, window, 'k-reopen')
      reopening.catch(() => undefined)
      await pause(50)
      expect(await standing(reopening)).toBe('pending')

      if (how === 'its Stop') expect(await host.cancelLaunch('k-reopen', 'owner:2')).toBe(true)
      else await host.closeSessionsForOwner('owner:2')
      const ended = await standing(reopening.then(() => undefined))
      expect(ended).not.toBe('pending')
      expect(ended).not.toBe('resolved')
      expect([...host.workInFlight()]).toContain(sessionId)

      const asked = controls.launchesAsked.length
      closeHeld.release()
      await closing
      await pause(PAST_THE_OLD_BOUNDS_MS)
      expect(controls.launchesAsked.length).toBe(asked)
    },
  )

  it('a Stop the host acknowledges, at any moment as the last close ends, means the reopen does not happen', async () => {
    for (let ticks = 0; ticks <= 30; ticks++) {
      const closeHeld = held()
      controls.closeHeld = closeHeld
      const sink = new RecordingSink()
      const sessionId = await anOpenConversation(sink)
      controls.closeHeld = null
      const closing = host.close(sessionId, sink)
      await pause(PAST_THE_OLD_BOUNDS_MS / 10)
      const owner = `owner:stop-${ticks}`
      const window = new RecordingSink(owner)
      const reopening = host.resumeSession(sessionId, window, `k-${ticks}`)
      const outcome = reopening.then(
        () => 'reopened' as const,
        () => 'refused' as const,
      )
      await pause(5)
      closeHeld.release()
      for (let i = 0; i < ticks; i++) await Promise.resolve()
      const acknowledged = await host.cancelLaunch(`k-${ticks}`, owner)
      await closing
      if (acknowledged)
        expect(await outcome, `a Stop ${ticks} ticks after the close`).toBe('refused')
      else await outcome
      for (const holder of [window, sink])
        await Promise.resolve()
          .then(() => host.close(sessionId, holder))
          .catch(() => undefined)
    }
  }, 60_000)

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
