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
 * # ⚑ A stream fragment the provider marks `passing` is neither kept nor sent
 *
 * Landing coverage for the CPU fixes: Claude's partial-message frames were 77% of every row and about
 * ten a second under load. The adapter marks a well-formed one `passing`; **the host takes its
 * arrival as a sign the provider is working, writes no ledger row and sends nothing to the window.**
 * ⛔ And what is NOT a fragment — a thinking delta that carries words, a frame this build does not
 * know — is still kept and sent.
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

const aFragment = (label: string): RuntimeEvent => ({
  type: 'unknown',
  provider: 'claude',
  category: 'activity',
  label,
  raw: { type: 'stream_event' },
  passing: true,
})

describe('a passing fragment reaches the host', () => {
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

  const unknownRows = (id: string) =>
    store
      .events(id)
      .map((entry) => entry.event)
      .filter((event) => event.type === 'unknown')

  const sentUnknowns = () =>
    window.messages.filter((message) => 'event' in message && message.event.type === 'unknown')

  it('🔴 a passing fragment is not written and not sent; one that is not passing is both', async () => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: userData },
      window,
    )
    const rowsBefore = unknownRows(sessionId).length
    const sentBefore = sentUnknowns().length

    for (let i = 0; i < 5; i++) await emit(aFragment('input_json_delta'))
    expect(unknownRows(sessionId), 'a passing fragment was written').toHaveLength(rowsBefore)
    expect(sentUnknowns(), 'a passing fragment was sent').toHaveLength(sentBefore)

    // The paired positive: the same event without the mark, so the check above is not passing over
    // a path that drops every unknown.
    const kept: RuntimeEvent = { ...aFragment('thinking_delta') }
    delete (kept as { passing?: true }).passing
    await emit(kept)
    expect(unknownRows(sessionId)).toHaveLength(rowsBefore + 1)
    expect(sentUnknowns()).toHaveLength(sentBefore + 1)
  })

  it('⚑ the next event is numbered right behind what was kept: a fragment takes no ordinal', async () => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: userData },
      window,
    )
    const last = (): number => store.events(sessionId).at(-1)?.ordinal ?? -1
    const before = last()
    await emit(aFragment('signature_delta'))
    await emit(aFragment('content_block_stop'))
    expect(last()).toBe(before)
    await emit({ type: 'error', message: 'a row that stays', fatal: false })
    expect(last()).toBe(before + 1)
  })
})
