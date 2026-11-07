import { waitFor } from './lib/f093-host'
import { fixtureProviderConfig, neutralHostDeps, prepareUnprofiledHome } from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, type SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

class WindowSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('716 · R62, D-017b — a conversation still closing says no process word, and still carries on', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let closeGate: { promise: Promise<void>; release: () => void } | null
  let counter: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-716-r62-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ledger = createSessionStore(db)
    const sessions = new FakeProviderSessions()
    counter = 0
    closeGate = null
    host = new RuntimeHost({
      store: ledger,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider, { sessions })
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          const handle = await start(opts)
          const gate = closeGate
          return (gate === null ? handle : holdingItsClose(handle, gate.promise)) as never
        }
        return runtime
      },
      prepareProviderHome: (provider: Provider) => prepareUnprofiledHome(userData, provider),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: fixtureProviderConfig,
    })
  })

  afterEach(async () => {
    closeGate?.release()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const open = async (sink: RuntimeEventSink | null): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      sink,
    )
    return sessionId
  }

  const rowOf = (sessionId: string): ResumableSessionInfo | UnresumableSessionInfo | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )

  const closingNow = async (sessionId: string): Promise<{ ending: Promise<void> }> => {
    const ending = host.close(sessionId, THE_APP_ITSELF)
    await waitFor(
      () => ledger.events(sessionId).some((one) => one.event.type === 'status'),
      'the provider to announce its ending while the teardown is parked',
    )
    return { ending }
  }

  it('🔴 D-017b · a conversation on its way out carries no process word — no `closing` beside `running`', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)

    expect(host.sessionIds).toContain(sessionId)
    const row = rowOf(sessionId)
    expect(row).toBeDefined()
    expect(row?.state).toBeDefined()
    expect(row).not.toHaveProperty('closing')

    closeGate.release()
    await ending
    expect(host.sessionIds).not.toContain(sessionId)
    expect(rowOf(sessionId)).toBeDefined()
    expect(rowOf(sessionId)).not.toHaveProperty('closing')
  })

  it('⚑ control — `running` does not move: a closing conversation is still `not-running`', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    expect(rowOf(sessionId)?.running).toBe('not-running')
    closeGate.release()
    await ending
    expect(rowOf(sessionId)?.running).toBe('not-running')
  })

  it('🔴 D-017b · the two `not-running` rows read the same — a close in flight is not told apart from a dead process', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    ledger.create({
      id: 'sess_from_a_dead_process',
      provider: 'claude',
      cwd: userData,
      approvalMode: 'ask',
      profileId: 'default',
    })
    const closing = rowOf(sessionId)
    const dead = rowOf('sess_from_a_dead_process')
    expect(closing).toBeDefined()
    expect(dead).toBeDefined()
    expect(closing?.running).toBe(dead?.running)
    expect(closing?.state).toEqual(dead?.state)
    expect(closing).not.toHaveProperty('closing')
    expect(dead).not.toHaveProperty('closing')
    closeGate.release()
    await ending
  })

  it('⚑ control — a running conversation is still told by `running` — unwatched or held by a window', async () => {
    const unwatched = await open(null)
    const held = await open(new WindowSink('webContents:1'))
    expect(rowOf(unwatched)).toMatchObject({ running: 'unwatched' })
    expect(rowOf(held)).toMatchObject({ running: 'in-a-window' })
    expect(rowOf(unwatched)).not.toHaveProperty('closing')
    expect(rowOf(held)).not.toHaveProperty('closing')
  })

  it('🔴 D-017b · the UNRESUMABLE half says no process word either — a live Claude session with no ref yet is there', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    db.prepare('UPDATE provider_session SET external_ref = NULL WHERE id = ?').run(sessionId)
    const half = host.unresumableSessions().find((row) => row.sessionId === sessionId)
    expect(half).toBeDefined()
    expect(host.resumableSessions().some((row) => row.sessionId === sessionId)).toBe(false)
    expect(half?.state).toBeDefined()
    expect(half).not.toHaveProperty('closing')
    closeGate.release()
    await ending
    expect(
      host.unresumableSessions().find((row) => row.sessionId === sessionId),
    ).not.toHaveProperty('closing')
  })

  it('⚑ control — Resume waits for it: a reopen pressed while it closes opens it', async () => {
    closeGate = deferred()
    const sessionId = await open(null)
    const { ending } = await closingNow(sessionId)
    expect(host.sessionIds).toContain(sessionId)
    const reopening = host.resumeSession(sessionId, new WindowSink('webContents:2'))
    closeGate.release()
    await ending
    await expect(reopening).resolves.toMatchObject({ sessionId })
    expect(rowOf(sessionId)).toMatchObject({ running: 'in-a-window' })
  })
})
