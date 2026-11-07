import { neutralHostDeps } from './lib/host-fixture'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type {
  RuntimeCommand,
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  get aPersonIsBehindIt() {
    return this.ownerId.startsWith('webContents:')
  }
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  readonly alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

describe('person-window commands preserve stream ownership', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** The surface that opened the conversation. */
  let owner: RecordingSink
  /** A second window with the id and no claim to it — 062's loser. */
  let stranger: RecordingSink
  let sessionId: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-authority-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    let counter = 0
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => dir),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) => join(dir, 'provider-homes', profileId, provider),
      resolveCwd: (id, requested) => requested ?? join(dir, 'scratch', id),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
    owner = new RecordingSink('webContents:1')
    stranger = new RecordingSink('webContents:2')
    const created = await host.createSession({ provider: 'codex', cwd: dir }, owner)
    sessionId = created.sessionId
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const ask = (who: RecordingSink, command: RuntimeCommand): Promise<unknown> =>
    executeRuntimeCommand(host, who, command)

  it.each(['owned', 'unowned', 'agent-held'] as const)(
    'another window sends, approves, stops and closes a %s conversation without taking its stream',
    async (kind) => {
      const receiver =
        kind === 'owned' ? owner : kind === 'agent-held' ? new RecordingSink('agent:helper') : null
      if (kind !== 'owned')
        sessionId = (await host.createSession({ provider: 'codex', cwd: dir }, receiver)).sessionId
      const initial = host.unclaimedSessions().map((entry) => entry.sessionId)
      const watch = () =>
        receiver?.events() ?? host.latestHistory(sessionId).entries.map((entry) => entry.event)
      await ask(stranger, { kind: 'send', sessionId, text: 'run something' })
      await waitFor(
        () => watch().some((event) => event.type === 'permission_request'),
        'permission request',
      )
      const requestId = (
        watch().find((event) => event.type === 'permission_request') as { id: string }
      ).id
      await ask(stranger, {
        kind: 'respondPermission',
        sessionId,
        requestId,
        decision: { outcome: 'allow' },
      })
      await waitFor(
        () => watch().some((event) => event.type === 'tool_result'),
        'permitted tool result',
      )
      expect(
        await ask(stranger, {
          kind: 'respondPermission',
          sessionId,
          requestId: 'not-pending',
          decision: { outcome: 'allow' },
        }),
      ).toMatchObject({ outcome: 'refused' })
      expect(host.attachOpenSessions(stranger)).toEqual([])
      expect(stranger.messages).toHaveLength(0)
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual(initial)
      await host.closeSessionsForOwner(stranger.ownerId)
      expect(host.sessionIds).toContain(sessionId)
      await ask(stranger, { kind: 'interrupt', sessionId })
      await ask(stranger, { kind: 'close', sessionId })
      expect(host.sessionIds).not.toContain(sessionId)
      expect(store.events(sessionId).some((entry) => entry.event.type === 'user_command')).toBe(
        true,
      )
    },
  )

  it.each(['owned', 'unowned', 'agent-held'] as const)(
    'a recorded-view first message reaches a %s session without transferring its stream',
    async (kind) => {
      const receiver =
        kind === 'owned' ? owner : kind === 'agent-held' ? new RecordingSink('agent:helper') : null
      if (kind !== 'owned')
        sessionId = (await host.createSession({ provider: 'codex', cwd: dir }, receiver)).sessionId
      const initial = host.unclaimedSessions().map((entry) => entry.sessionId)
      await host.look(sessionId, stranger, false)
      const answer = await ask(stranger, {
        kind: 'startAndSend',
        sessionId,
        text: 'from the recorded view',
      })
      expect(answer).toMatchObject({
        sent: { sessionId, handover: 'recorded', cannotTakeAMessage: null },
      })
      await waitFor(
        () => store.events(sessionId).some((entry) => entry.event.type === 'user_turn'),
        'recorded-view message',
      )
      expect(
        store
          .events(sessionId)
          .filter(
            (entry) =>
              entry.event.type === 'user_turn' && entry.event.text === 'from the recorded view',
          ),
      ).toHaveLength(1)
      expect(host.attachOpenSessions(stranger)).toEqual([])
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual(initial)
      await host.closeSessionsForOwner(stranger.ownerId)
      expect(host.sessionIds).toContain(sessionId)
      if (receiver)
        expect(host.attachOpenSessions(receiver).map((entry) => entry.sessionId)).toContain(
          sessionId,
        )
    },
  )

  it('a second window changes approval mode without gaining the stream', async () => {
    await ask(stranger, { kind: 'setApprovalMode', sessionId, mode: 'auto' })
    expect(
      db.prepare('SELECT approval_mode AS mode FROM provider_session WHERE id = ?').get(sessionId),
    ).toMatchObject({ mode: 'auto' })
    expect(host.attachOpenSessions(owner).map((entry) => entry.sessionId)).toContain(sessionId)
    expect(host.attachOpenSessions(stranger)).toEqual([])
  })

  it('close of an absent conversation remains a no-op', async () => {
    await expect(
      ask(stranger, { kind: 'close', sessionId: 'sess_absent' }),
    ).resolves.toBeUndefined()
  })

  it('resume and claim still respect the current stream owner', async () => {
    expect(host.attachOpenSessions(stranger)).toEqual([])
    await expect(host.resumeSession(sessionId, stranger)).rejects.toThrow(
      describeUnavailable('already-open-elsewhere'),
    )
    await expect(ask(stranger, { kind: 'claim', sessionId })).rejects.toThrow(
      describeUnavailable('already-open-elsewhere'),
    )
    expect(host.attachOpenSessions(owner)).toHaveLength(1)
    const spawned = await host.createSession({ provider: 'codex', cwd: dir }, null)
    expect(
      (
        (await ask(stranger, { kind: 'claim', sessionId: spawned.sessionId })) as {
          sessionId: string
        }
      ).sessionId,
    ).toBe(spawned.sessionId)
  })
})

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}
