import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  type AgentRuntime,
  type RuntimeEvent,
  type SessionHandle,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const STALE_EVENT = {
  type: 'assistant_message',
  text: 'a message from the conversation that ended',
} as const satisfies RuntimeEvent

describe('293 §3 · a pump that outlived its life writes into nothing', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let gate: { promise: Promise<void>; resolve: () => void }
  let staleYielded: boolean
  let handedOut: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-stale-pump-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    gate = deferred()
    staleYielded = false
    handedOut = 0

    const holdTheStream = (handle: SessionHandle): SessionHandle =>
      new Proxy(handle, {
        get(target, property) {
          if (property === 'events') {
            return (): AsyncIterable<RuntimeEvent> => ({
              async *[Symbol.asyncIterator]() {
                for await (const event of handle.events()) yield event
                await gate.promise
                staleYielded = true
                yield STALE_EVENT
              },
            })
          }
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value
        },
      })

    const runtimes = new Map<string, FakeRuntime>()
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath: () => null,
      createRuntime: (provider): AgentRuntime => {
        const real = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, real)
        return {
          provider,
          listModels: (context) => real.listModels(context),
          start: async (options) => {
            const handle = await real.start(options)
            return ++handedOut === 1 ? holdTheStream(handle) : handle
          },
          resume: async (ref, options) => await real.resume(ref, options),
        }
      },
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 60,
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

  it('🔴 drops an event yielded after finalization instead of writing it into the reopened life', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const window = new RecordingSink('owner:1')
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: join(dir, 'work') },
      window,
    )

    await host.close(sessionId, window)
    expect(host.sessionIds, 'the teardown never released the id').not.toContain(sessionId)

    await host.resumeSession(sessionId, window)
    const reopenedAt = store.nextOrdinal(sessionId)
    const beforeTheGhost = window.messages.length

    gate.resolve()
    await waitFor(() => staleYielded, 'the held iterator to yield its buffered event')
    const droppedItAndSaidSo = (): boolean =>
      warn.mock.calls.some((call) => String(call[0]).includes('after this life was finalized'))
    await waitFor(
      () => droppedItAndSaidSo() || window.messages.length > beforeTheGhost,
      'the host to do something with the stale event',
    )

    expect(
      window.messages.slice(beforeTheGhost).map((message) => JSON.stringify(message.event)),
      'closed-provider content was delivered into the reopened conversation',
    ).not.toContainEqual(expect.stringContaining(STALE_EVENT.text))
    expect(
      host.latestHistory(sessionId).entries.map((entry) => JSON.stringify(entry.event)),
      'the stale event was written into the reopened conversation’s ledger',
    ).not.toContainEqual(expect.stringContaining(STALE_EVENT.text))
    expect(
      window.messages.map((message) =>
        message.event.type === 'error' ? message.event.message : '',
      ),
      'the reopened conversation was told it is no longer being recorded',
    ).not.toContainEqual(expect.stringContaining('no longer being recorded'))

    await host.send(sessionId, 'the conversation continues', window)
    await waitFor(
      () => store.nextOrdinal(sessionId) > reopenedAt,
      'the reopened conversation to record its own events',
    )

    expect(droppedItAndSaidSo(), 'nothing was dropped, so nothing above was tested').toBe(true)
    warn.mockRestore()
  })
})
