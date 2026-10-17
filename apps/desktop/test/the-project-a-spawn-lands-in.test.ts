import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type CallerIdentity,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **459 · the project a spawn lands in** — ⚑ **D-016 · there is no project to land in now.**
 *
 * ⛔ `459` gave `spawn_agent` a `project` argument after a PM BroBot had just staffed landed in
 * `default` and could not see the project it was told it manages. It keyed the live-session rail
 * on parent + identity + PROJECT, let a parent place a child in a project it created or stood in,
 * and refused every other placement `not-your-project`. ⛔ **D-016 deleted projects**, and with
 * them the argument, the placement, `not-your-project`, the project's folder as a spawn's default
 * and the same-tick narrowing across two projects — so every case about those went.
 *
 * ⚑ **What stays is the half of the rail's key that was never about a project**: the live-session
 * rail is keyed on the PARENT (`428`), so two parents asking for one identity is demand and both are
 * admitted. ⚑ D-016: the rail became the give's LOOKUP — one conversation per helper per giver — so
 * the same parent giving twice reaches the conversation it has, and that half is pinned in
 * `a-starting-child-is-already-in-its-project.test.ts` §4.
 *
 * ⛔ **Real host, real SQLite ledger, real migrations.** The only double is the provider.
 */
describe('459 · the project a spawn lands in', () => {
  class PersonSink implements RuntimeEventSink {
    readonly aPersonIsBehindIt = true
    readonly messages: RuntimeEventMessage[] = []
    alive = true
    constructor(readonly ownerId: string) {}
    send(message: RuntimeEventMessage): void {
      this.messages.push(message)
    }
    sendLiveness(): void {}
  }

  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let window: PersonSink
  let counter: number
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-place-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-place-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, tick)
    counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new PersonSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a conversation has run as it — criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  describe('⚑ §1 · the rail is keyed on the parent', () => {
    /**
     * ⛔ **The blocker is the PARENT's own**, which is `428`'s half of the key. ⚠️ Without this a
     * rail that had lost the parent clause — one live conversation of an identity in the whole app —
     * would refuse the second parent below. (D-016: both parents stood in project `alpha`; the
     * project half of the key went with projects, and this half is the whole key now.)
     */
    it('⚑ a second parent still gets its own conversation of that identity', async () => {
      await bringIdentityIntoBeing('pm')
      const one = await personOpens('lead-a')
      const two = await personOpens('lead-b')

      const mine = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'mine',
          brief: 'mine',
        },
        speakingAs(one),
      )
      const yours = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'yours',
          brief: 'yours',
        },
        speakingAs(two),
      )
      // ⚑ Same identity, two parents — demand, and each give starts its own conversation.
      expect(mine.ok).toBe(true)
      expect(yours.ok).toBe(true)
      if (!mine.ok || !yours.ok) return
      // ⚑ **D-042 moved where a start is said** — `started` (null for a conversation that existed)
      // became `runsOn.how`.
      expect(mine.runsOn.how).toBe('started')
      expect(yours.runsOn.how).toBe('started')
      expect(mine.owner).not.toBe(yours.owner)
      expect(store.identityOf(mine.owner)?.profileSlug).toBe('pm')
      expect(store.identityOf(yours.owner)?.profileSlug).toBe('pm')
    })
  })
})
