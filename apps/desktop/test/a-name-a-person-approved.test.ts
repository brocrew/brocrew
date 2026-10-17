import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

/**
 * 🔴 **639 · what a person's own creation door writes, and the absences that are its contract.**
 *
 * ⚑ **D-016**: proposals are gone — nothing proposes a `standing-agent` and nothing approves one —
 * so this file's proposal arm, its sentences and its project half-write went with them. ⛔ **What
 * stays is the CONTROL**, because its subject still exists: `RuntimeHost.createAgent` is the door a
 * PERSON walks at `NewAgent.vue`, and `SessionStore.createAgentIdentity` says it in as many words —
 * *"It writes an `agent_identity` row and NOTHING ELSE — no home and no conversation."*
 *
 * ⚠️ `every-identity-he-has.test.ts` states those absences in a comment and never counts them;
 * this file is where the zero-row facts are measured, off the DATABASE rather than any surface.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('639 · a name a person creates, and what creating it writes', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-639-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = buildHost()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** 🔴 **The DATABASE, not the host and not a surface** — the only reading that can tell
   * *nothing was written* from *nothing was shown*. */
  const oneNumber = (sql: string, ...args: string[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n

  const identityRow = (slug: string): { display_name: string | null } =>
    db.prepare('SELECT display_name FROM agent_identity WHERE slug = ?').get(slug) as {
      display_name: string | null
    }

  describe('§1 · one row, one door, and two absences that are the contract', () => {
    it('🔴 the CONTROL — the person’s own creation door leaves the identical absences', () => {
      // ⚑ `RuntimeHost.createAgent` is the door a PERSON walks at `NewAgent.vue`, and it is
      // `SessionStore.createAgentIdentity` underneath.
      const created = host.createAgent({
        slug: 'ana',
        displayName: null,
        provider: null,
      })
      expect(created).not.toBeNull()
      const id = 'aid:ana'
      // ⛔ **The anchor the counts key on is the row's own id**, or a zero below is a count of a
      // key nothing could ever have written.
      expect(created.id).toBe(id)
      for (const [what, n] of [
        [
          'identity_instruction',
          oneNumber('SELECT COUNT(*) AS n FROM identity_instruction WHERE identity_id = ?', id),
        ],
        [
          'provider_session',
          oneNumber('SELECT COUNT(*) AS n FROM provider_session WHERE profile_id = ?', 'ana'),
        ],
      ] as const) {
        expect(n, `${what} for an identity a PERSON created`).toBe(0)
      }
      // ⚑ **And the name**: a person's door falls through to the generator when nobody typed a
      // name (`584`), so the row carries a name and it is not the bare slug.
      expect(identityRow('ana').display_name).not.toBeNull()
      expect(identityRow('ana').display_name).not.toBe('ana')
    })
  })
})
