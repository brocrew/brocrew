import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { AppDatabase } from '../src/main/db/connection'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  RecordingSink,
  closeHostFixture,
  fixtureDatabase,
  fixtureFolder,
  numberedFixtureHostPaths,
  waitFor,
} from './lib/host-fixture'
import { stillWaiting } from './helpers/provider-close-waits'

/**
 * Card 197, batch 5: a person's Reopen of a conversation still being torn down waits for the
 * teardown, however long a slow PC takes over it, instead of being refused "still closing" once a
 * fixed bound passes. The teardown here is held in its exit-based command cleanup, the step a slow
 * machine stretches past the stop and drain bounds. The same holds for a start closed before its
 * provider arrived, held here in its home preparation.
 */
describe("a person's Reopen waits out a slow teardown", () => {
  const DRAIN_MS = 40
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let cleanup: Promise<void>
  let finishCleanup: () => void
  let homeReady: Promise<void>
  let finishHome: () => void
  let homesAsked: number

  beforeEach(() => {
    userData = fixtureFolder('brobot2-slow-teardown-')
    db = fixtureDatabase(userData)
    store = createSessionStore(db)
    cleanup = Promise.resolve()
    finishCleanup = () => undefined
    homeReady = Promise.resolve()
    finishHome = () => undefined
    homesAsked = 0
    // One runtime per provider, so the Reopen resumes the thread the first life began.
    const runtimes = new Map<string, FakeRuntime>()
    const paths = numberedFixtureHostPaths(() => userData, Date.now)
    host = new RuntimeHost({
      store,
      ...paths,
      // A start can be held in its home preparation, the step before its launch clock.
      prepareProviderHome: (...args) => {
        homesAsked++
        return homeReady.then(() => paths.prepareProviderHome(...args))
      },
      createRuntime: (provider) => {
        const runtime = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, runtime)
        return runtime
      },
      closeDrainTimeoutMs: DRAIN_MS,
      stopWorkerCommands: () => cleanup,
    })
  })

  afterEach(async () => {
    finishCleanup()
    finishHome()
    await closeHostFixture(host, db, userData)
  })

  it('waits past twice the drain bound, then reopens the same conversation', async () => {
    const sink = new RecordingSink('owner:1')
    const { sessionId } = await host.createSession({ provider: 'codex', cwd: userData }, sink)
    await waitFor(() => store.find(sessionId)?.ref !== undefined, 'the provider ref')
    cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })

    const closing = host.close(sessionId, sink)
    const reopening = host.resumeSession(sessionId, new RecordingSink('owner:2'))

    // Well past `settleTeardown`'s bound of twice the drain, the teardown is still running.
    expect(await stillWaiting(reopening, DRAIN_MS * 8), 'still waiting, not refused').toBe(true)

    finishCleanup()
    await closing
    await expect(reopening).resolves.toMatchObject({ sessionId })
  })

  it('waits past the arrival bound for a start closed before it arrived, then reopens', async () => {
    const sink = new RecordingSink('owner:1')
    const { sessionId } = await host.createSession({ provider: 'codex', cwd: userData }, sink)
    await waitFor(() => store.find(sessionId)?.ref !== undefined, 'the provider ref')
    await host.close(sessionId, sink)
    homeReady = new Promise<void>((resolve) => {
      finishHome = resolve
    })
    const asked = homesAsked
    const starting = host.resumeSession(sessionId, new RecordingSink('owner:2'))
    void starting.catch(() => undefined)
    await waitFor(() => homesAsked > asked, 'the start to be preparing its home')
    // Closed while it is still starting: the close itself gives the start its bounded wait.
    await host.close(sessionId, sink)
    const reopening = host.resumeSession(sessionId, new RecordingSink('owner:3'))

    // Well past `awaitArrival`'s bound of the drain, the closed start has still not ended.
    expect(await stillWaiting(reopening, DRAIN_MS * 8), 'still waiting, not refused').toBe(true)

    finishHome()
    await expect(reopening).resolves.toMatchObject({ sessionId })
  })
})
