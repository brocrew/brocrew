import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # 🔴 707 · R41 — an agent a person reads is NAMED, in the sentences main composes
 *
 * ⚑ **PM ruling R41** (`702` F-4): *"every identity a person reads is NAMED (`agentName`), never by
 * slug — the set-aside sentence's SUBJECT (…for “fresh”…) included."* ⚑ The set-aside's subject is
 * `a-persons-choice-holds-the-whole-launch.test.ts`' (§1); this file is the other sentence main
 * composes for a person about an identity by its slug (`707`'s map, read-only on `224e1f45`). ⚠️
 * `707` measured two; the digest's *"…, proposed by <agent>"* went with proposals at D-016.
 *
 * | sentence | where a person reads it | `main` |
 * |---|---|---|
 * | `not-its-provider`'s *"<agent> runs on Codex…"* | the model-choice sheet's Save | the slug in quotes — *"“builder” runs on Codex"* |
 *
 * ⚠️ **Each arm is measured where the two readings DIVERGE** — a name a PERSON gave the identity —
 * because *BroBot* for `brobot` is also what `profileLabel` prints, and a fold that had only moved to
 * that function would pass an arm about BroBot. ⚑ **And each has its control**: an identity with no
 * display name reads its canonical spelling, as every other surface draws it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const NAMED = 'Hedda'

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

describe('707 · R41 — an agent a person reads is named', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let window: RecordingSink
  const START = Date.UTC(2030, 0, 1)
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-707-r41-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-707-r41-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⛔ **Past `0013`'s own wall clock** — `a-second-project-and-the-grant.test.ts` argues why.
    clock = START
    store = createSessionStore(db, tick)
    counter = 0
    const handles: FakeSessionHandle[] = []
    const issued = new FakeProviderSessions()
    const gate = anOpenGate()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the model-choice sheet's refusal
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · `not-its-provider` — the identity a person was choosing for', () => {
    const refusedFor = async (displayName: string | null): Promise<string> => {
      expect(
        store.createAgentIdentity(
          { slug: 'builder', displayName: null, provider: 'codex' },
          { by: 'a-person' },
        ),
      ).not.toBeNull()
      expect(store.setAgentDisplayName('builder', displayName)).toBe(true)
      const out = (await executeRuntimeCommand(host, window, {
        kind: 'setAgentModelAndEffort',
        profileId: 'builder',
        provider: 'claude',
        model: 'narrow',
        effort: null,
      })) as { ok: boolean; rail?: string; reason?: string }
      expect(out).toMatchObject({ ok: false, rail: 'not-its-provider' })
      return String(out.reason)
    }

    it('🔴 an identity a person named is refused by its NAME', async () => {
      const said = await refusedFor(NAMED)
      // ⛔ Measured on `main`: *"Choose a Codex model: “builder” runs on Codex, …"*.
      expect(said).toContain(`Choose a Codex model: ${NAMED} runs on Codex,`)
      expect(said).not.toContain('builder')
    })

    it('⚑ control: an identity with NO display name reads its canonical spelling', async () => {
      const said = await refusedFor(null)
      // ⚑ `builder` on both sides of the change — `main` quoted it as an id, `agentName` does not
      expect(said).toMatch(/^Choose a Codex model: “?builder”? runs on Codex,/)
    })
  })
})
