import { neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

function sharedRuntime(provider: Provider, sessions: FakeProviderSessions): FakeRuntime {
  return new FakeRuntime(provider, { sessions })
}

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
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('421 · a live conversation is never drawn as ended', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let sessions: FakeProviderSessions
  let closeGate: { promise: Promise<void>; release: () => void } | null
  let window1: WindowSink
  let window2: WindowSink
  let counter: number

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-421-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    ledger = createSessionStore(db)
    sessions = new FakeProviderSessions()
    counter = 0
    closeGate = null
    host = new RuntimeHost({
      store: ledger,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => {
        const runtime = sharedRuntime(provider, sessions)
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          const handle = await start(opts)
          const gate = closeGate
          return (gate === null ? handle : holdingItsClose(handle, gate.promise)) as never
        }
        return runtime
      },
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      closeDrainTimeoutMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window1 = new WindowSink('webContents:1')
    window2 = new WindowSink('webContents:2')
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

  const runningOf = (sessionId: string): string | undefined => {
    const rows = [...host.resumableSessions(), ...host.unresumableSessions()]
    return rows.find((row) => row.sessionId === sessionId)?.running
  }

  const statusOf = (sessionId: string): string | undefined => {
    const rows = [...host.resumableSessions(), ...host.unresumableSessions()]
    return rows.find((row) => row.sessionId === sessionId)?.status
  }

  describe('§1 · what the host says it is doing with a recorded row', () => {
    it('🔴 tells the three states apart, and every one of them is reachable', async () => {
      const unwatched = await open(null)
      const held = await open(window1)
      ledger.create({
        id: 'sess_from_a_dead_process',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })

      expect(runningOf(unwatched)).toBe('unwatched')
      expect(runningOf(held)).toBe('in-a-window')
      expect(runningOf('sess_from_a_dead_process')).toBe('not-running')
    })

    it('🔴 …and the STATUS column cannot, which is why the field exists', async () => {
      const live = await open(null)
      ledger.create({
        id: 'sess_from_a_dead_process',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })

      expect(statusOf(live)).toBe('idle')
      expect(statusOf('sess_from_a_dead_process')).toBe('idle')
      expect(runningOf(live)).toBe('unwatched')
      expect(runningOf('sess_from_a_dead_process')).toBe('not-running')

      ledger.closeOpenTurn('sess_from_a_dead_process', 'unknown', Date.now())
      expect(statusOf('sess_from_a_dead_process')).toBe('idle')
      expect(ledger.settleOrphanRuns(Date.now(), new Set())).toBe(0)
      expect(statusOf('sess_from_a_dead_process')).toBe('idle')
    })

    it('⚠️ a conversation on its way OUT is not running, and the claim door agrees', async () => {
      closeGate = deferred()
      const sessionId = await open(null)
      const ending = host.close(sessionId, THE_APP_ITSELF)
      await waitFor(
        () => ledger.events(sessionId).some((one) => one.event.type === 'status'),
        'the provider to announce its ending while the teardown is parked',
      )

      expect(host.sessionIds).toContain(sessionId)
      expect(runningOf(sessionId)).toBe('not-running')
      expect(() => host.claimSession(sessionId, window1)).toThrow(
        describeUnavailable('still-closing'),
      )

      closeGate.release()
      await ending
      expect(runningOf(sessionId)).toBe('not-running')
      expect(host.sessionIds).not.toContain(sessionId)
    })

    it('⚑ both list commands carry it, and neither half is the half with the live rows', async () => {
      const live = await open(null)
      ledger.create({
        id: 'sess_no_ref',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })

      const resumable = host.resumableSessions()
      const unresumable = host.unresumableSessions()
      expect(resumable.map((row) => row.sessionId)).toContain(live)
      expect(unresumable.map((row) => row.sessionId)).toContain('sess_no_ref')
      for (const row of [...resumable, ...unresumable]) {
        expect(row.running, row.sessionId).toBeDefined()
      }
      expect(resumable.find((row) => row.sessionId === live)!.running).toBe('unwatched')
      expect(unresumable.find((row) => row.sessionId === 'sess_no_ref')!.running).toBe(
        'not-running',
      )

      host.claimSession(live, window1)
      expect(host.resumableSessions().find((row) => row.sessionId === live)!.running).toBe(
        'in-a-window',
      )
    })
  })

  describe('§2 · what taking a conversation over costs, against what reopening one costs', () => {
    it('🔴 a claim does NOT make the conversation mortal — the window goes and it lives', async () => {
      const sessionId = await open(null)
      host.claimSession(sessionId, window1)

      window1.alive = false
      await host.closeSessionsForOwner('webContents:1')

      expect(host.sessionIds).toContain(sessionId)
      expect(runningOf(sessionId)).toBe('unwatched')
      expect(ledger.find(sessionId)?.status).not.toBe('ended')
      expect(ledger.events(sessionId).map((one) => one.event.type)).not.toContain(
        'conversation_ended',
      )

      const started = await open(window1)
      await host.closeSessionsForOwner('webContents:1')
      expect(host.sessionIds).not.toContain(started)
      expect(host.sessionIds).toContain(sessionId)
    })

    it('🔴 a REOPEN does — and that is a finding this dispatch pins rather than fixes', async () => {
      const spawned = await open(null)
      await host.close(spawned, THE_APP_ITSELF)
      expect(ledger.find(spawned)?.status).toBe('ended')

      const reopened = await host.resumeSession(spawned, window1)
      expect(reopened.sessionId).toBe(spawned)
      expect(runningOf(spawned)).toBe('in-a-window')

      window1.alive = false
      await host.closeSessionsForOwner('webContents:1')

      expect(host.sessionIds).not.toContain(spawned)
      expect(runningOf(spawned)).toBe('not-running')

      const claimed = await open(null)
      host.claimSession(claimed, window2)
      window2.alive = false
      await host.closeSessionsForOwner('webContents:2')
      expect(host.sessionIds).toContain(claimed)
    })

    it('⚠️ …and the repair for that is a later slice, named rather than improvised', () => {
      ledger.create({
        id: 'sess_shape',
        provider: 'claude',
        cwd: userData,
        approvalMode: 'ask',
        profileId: 'default',
      })
      const row = ledger.recordedOne('sess_shape')
      expect(row).not.toBeNull()
      expect(Object.keys(row as object)).not.toContain('ownerId')
    })
  })
})
