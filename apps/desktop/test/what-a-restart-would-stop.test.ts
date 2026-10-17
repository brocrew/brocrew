import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeRuntime,
  type RuntimeEvent,
  type SessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **W4.109 · B1 — what a restart of this app would stop**, read by the updater before it
 * installs: an update never installs mid-turn.
 *
 * ⚑ The stream the host folds is pushed by the test, one event at a time (`575`'s `pushable`), so
 * a message can be on its way into a turn while the provider has said nothing — the case the
 * second review found missing: the provider still says idle, and a restart would cut the turn.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** A handle whose stream this test pushes into (`575`'s). */
function pushable(handle: SessionHandle): {
  readonly handle: SessionHandle
  push: (event: RuntimeEvent) => void
} {
  const waiting: RuntimeEvent[] = []
  let wake: (() => void) | null = null
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return () => ({
          async *[Symbol.asyncIterator]() {
            for (;;) {
              while (waiting.length > 0) yield waiting.shift() as RuntimeEvent
              await new Promise<void>((resolve) => {
                wake = resolve
              })
            }
          },
        })
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return {
    handle: proxied,
    push: (event) => {
      waiting.push(event)
      wake?.()
      wake = null
    },
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const WORKING = { type: 'status', state: 'working' } as RuntimeEvent
const IDLE = { type: 'status', state: 'idle' } as RuntimeEvent

describe('W4.109 · B1 · what a restart of this app would stop', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let runtime: FakeRuntime
  let counter: number
  const streams = new Map<string, (event: RuntimeEvent) => void>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-restart-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    runtime = new FakeRuntime('claude')
    streams.clear()
    counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${String(++counter)}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** The window that holds the conversations, and sends to them. */
  const window = new RecordingSink('alice')

  /** One conversation whose stream this test drives. */
  const open = async (): Promise<string> => {
    const start = runtime.start.bind(runtime)
    let pushTo: ((event: RuntimeEvent) => void) | null = null
    runtime.start = async (opts: StartOptions) => {
      const driven = pushable(await start(opts))
      pushTo = driven.push
      return driven.handle as never
    }
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, profileId: 'alice', approvalMode: 'auto' },
      window,
    )
    runtime.start = start
    if (pushTo === null) throw new Error('the runtime never started a session')
    streams.set(sessionId, pushTo)
    return sessionId
  }

  const say = async (sessionId: string, event: RuntimeEvent): Promise<void> => {
    const push = streams.get(sessionId)
    if (push === undefined) throw new Error(`no stream held for ${sessionId}`)
    const before = store.events(sessionId).length
    push(event)
    await waitFor(
      () => store.events(sessionId).length > before,
      `${sessionId} to fold ${event.type}`,
    )
  }

  it('⚑ a conversation at rest is not listed: a restart would stop nothing', async () => {
    await open()
    expect(host.whatARestartWouldStop()).toEqual([])
  })

  it('🔴 a message on its way into a turn is a turn running, before its provider says so', async () => {
    const one = await open()
    await host.send(one, 'do the thing', window)
    // ⚑ The provider has said nothing yet: the host's own turn is what is open.
    expect(host.whatARestartWouldStop()).toEqual([
      expect.objectContaining({ conversation: one, turnRunning: true }),
    ])
    await say(one, WORKING)
    expect(host.whatARestartWouldStop()).toEqual([
      expect.objectContaining({ conversation: one, turnRunning: true }),
    ])
    await say(one, { type: 'turn', state: 'completed' } as RuntimeEvent)
    await say(one, IDLE)
    expect(host.whatARestartWouldStop()).toEqual([])
  })
})
