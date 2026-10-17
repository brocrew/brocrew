import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle, type RuntimeEvent } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # ⚑ F062 · the host hands a window that takes a running conversation back what it knew
 *
 * A page of the ledger can begin after the `status` that opened the running turn, so a window that
 * folds it alone reads `idle` while the turn runs. The host therefore hands over, on an `attached`
 * hand-over, `asHandedOver: { status, told }` — what its own tracker knew as of the page's last
 * row. ⚠️ The renderer's half is `session-store.test.ts`; this is the host's.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

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

describe('F062 · what the host hands over beside the page', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: RecordingSink
  const handles: FakeSessionHandle[] = []
  let counter = 0

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-passing-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, anOpenGate()),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
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
    handles.length = 0
  })

  /** ⚑ The provider says it, and the host's pump has run before anyone looks. */
  const emit = async (event: RuntimeEvent): Promise<void> => {
    ;(handles[0] as unknown as { push(event: RuntimeEvent): void }).push(event)
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  }

  it('🔴 a reload is handed the status and the activity the host was told, beside the page', async () => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: userData },
      window,
    )
    await emit({ type: 'status', state: 'working' })
    await emit({ type: 'activity', phase: 'tool', detail: 'Bash' })

    const [attached] = host.attachOpenSessions(window)
    expect(attached?.sessionId).toBe(sessionId)
    expect(attached?.handover).toBe('attached')
    expect(attached?.asHandedOver).toEqual({
      status: 'working',
      told: { said: 'an-activity', phase: 'tool', detail: 'Bash' },
    })
  })

  it('⚑ …and as of the last row: a status that ends the work takes the activity with it', async () => {
    await host.createSession({ provider: 'claude', approvalMode: 'ask', cwd: userData }, window)
    await emit({ type: 'status', state: 'working' })
    await emit({ type: 'activity', phase: 'tool', detail: 'Bash' })
    await emit({ type: 'status', state: 'idle' })

    const [attached] = host.attachOpenSessions(window)
    expect(attached?.asHandedOver?.status).toBe('idle')
    expect(attached?.asHandedOver?.told).toMatchObject({ said: 'nothing' })
  })

  it('⛔ a conversation asks nothing of a window that does not own it', async () => {
    await host.createSession({ provider: 'claude', approvalMode: 'ask', cwd: userData }, window)
    const stranger = new RecordingSink(sinkOwnerId({ id: 2 }))
    expect(host.attachOpenSessions(stranger)).toEqual([])
  })
})
