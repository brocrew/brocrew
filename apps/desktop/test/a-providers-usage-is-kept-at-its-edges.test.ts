import { RecordingSink, neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, MAX_USAGE_WINDOWS, type FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import {
  importProviderUsageFile,
  PROVIDER_USAGE_FILE,
  usageKeptIn,
  type KeptUsage,
} from '../src/main/provider-usage-file'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # F096 · a provider's usage is kept — the cap, and a reset that alone moved
 *
 * ⚑ `a-providers-usage-is-kept-told-to-agents-and-warned.test.ts` keeps, restarts and warns, and
 * `the-usage-warning-at-its-edges-and-each-verbs-refusal.test.ts` asks the warning's own edges.
 * Two things the host does were measured by neither:
 *
 *  - **§1 · the host holds at most sixteen windows of readings a provider.** The "past sixteen
 *    windows" test checks only the windows SEEN, which take the oldest's place; the readings refuse
 *    a seventeenth, and no test read them, so dropping that cap went unseen.
 *  - **§2 · a reset that alone moved is written.** Every test that writes moves the percentage; a
 *    frame whose only change is the reset was taken as saying the same again and survived.
 *
 * ⚑ Fake readings only, on a temp `userData`: no provider, credential or network is touched.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

const WEEK = 7 * 24 * 60 * 60 * 1000

describe('F096 · a provider’s usage, kept at its edges', () => {
  describe('§1–§2 · on a host', () => {
    let userData: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let window: RecordingSink
    let handles: FakeSessionHandle[]
    let clock: number
    let writes: number
    let counter = 0

    const hostOn = (): RuntimeHost => {
      const issued = new FakeProviderSessions()
      return new RuntimeHost({
        store,
        ...neutralHostDeps(() => userData),
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
        now: () => clock,
        usageKept: {
          read: () => usageKeptIn(db).read(),
          write: (usage) => {
            writes += 1
            usageKeptIn(db).write(usage)
          },
        },
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    }

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-usage-edges-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      store = createSessionStore(db)
      window = new RecordingSink(sinkOwnerId({ id: 1 }))
      handles = []
      clock = Date.UTC(2026, 9, 5, 2, 11)
      writes = 0
      host = hostOn()
    })

    afterEach(async () => {
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
    })

    const open = async (provider: Provider = 'claude'): Promise<FakeSessionHandle> => {
      await host.createSession({ provider, cwd: userData }, window)
      return handles.at(-1)!
    }
    const pump = async (): Promise<void> => {
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const reading = async (
      handle: FakeSessionHandle,
      readings: { window: string; usedPercent: number | null; resetsAt: number | null }[],
    ): Promise<void> => {
      handle.simulateProviderUsage(readings)
      await pump()
    }
    const kept = () => usageKeptIn(db).read().readings

    it('⛔ §1 · past sixteen windows, the readings refuse a new one — though the windows seen take it', async () => {
      const handle = await open()
      for (let i = 0; i < MAX_USAGE_WINDOWS; i += 1) {
        await reading(handle, [{ window: `w${String(i)}`, usedPercent: 1, resetsAt: null }])
        clock += 1_000
      }
      await reading(handle, [{ window: 'w0', usedPercent: 1, resetsAt: null }])
      clock += 1_000
      await reading(handle, [{ window: 'new', usedPercent: 1, resetsAt: null }])

      // ⚑ The control: the frame naming `new` arrived — the windows seen took it.
      expect(host.usageWindowsSeen().claude.map((one) => one.window)).toContain('new')
      // ⛔ …and the readings held stay at sixteen, the first sixteen, without it.
      const held = host.providerUsage().claude.map((one) => one.window)
      expect(held).toHaveLength(MAX_USAGE_WINDOWS)
      expect(held).not.toContain('new')
      expect(held).toEqual(Array.from({ length: MAX_USAGE_WINDOWS }, (_, i) => `w${String(i)}`))
    })

    it('🔴 §2 · a frame whose only change is the reset is written, and the file says the new reset', async () => {
      const handle = await open()
      await reading(handle, [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + WEEK }])
      expect(writes).toBe(1)

      // 🔴 The same percentage, a later reset: a number moved, so it is kept.
      await reading(handle, [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + 2 * WEEK }])
      expect(writes).toBe(2)
      expect(kept().claude).toEqual([
        { window: 'seven_day', usedPercent: 11, resetsAt: clock + 2 * WEEK, at: clock },
      ])

      // ⚑ The control: the same frame again moves nothing, and writes nothing.
      await reading(handle, [{ window: 'seven_day', usedPercent: 11, resetsAt: clock + 2 * WEEK }])
      expect(writes).toBe(2)
    })
  })

  describe('recorded account tags imported into SQLite', () => {
    let dir: string
    let database: AppDatabase
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-usage-tags-'))
      database = openDatabase(join(dir, 'brobot2.sqlite'))
      applyMigrations(database, migrationsFolder)
    })
    afterEach(() => {
      if (database.open) database.close()
      rmSync(dir, { recursive: true, force: true })
    })

    const usageAt = (tag: string): KeptUsage => ({
      readings: {
        claude: [],
        codex: [{ window: 'weekly', usedPercent: 11, resetsAt: null, at: 1_000, account: tag }],
      },
      seen: { claude: [], codex: [] },
      readOn: { codex: tag },
    })

    it.each([
      'native-account:fictional/account-G7',
      'a'.repeat(32),
      `credential:${'b'.repeat(64)}`,
      `account:${'c'.repeat(64)}`,
      'api-revision:17',
    ])('preserves the exact recorded account tag through import and reopen: %s', (tag) => {
      const usage = usageAt(tag)
      writeFileSync(join(dir, PROVIDER_USAGE_FILE), JSON.stringify(usage))
      importProviderUsageFile(database, dir)
      expect(usageKeptIn(database).read()).toEqual(usage)
      database.close()
      database = openDatabase(join(dir, 'brobot2.sqlite'))
      expect(usageKeptIn(database).read()).toEqual(usage)
    })

    it('does not import an empty native account identifier', () => {
      writeFileSync(join(dir, PROVIDER_USAGE_FILE), JSON.stringify(usageAt('native-account:')))
      importProviderUsageFile(database, dir)
      expect(usageKeptIn(database).read().readOn).toBeUndefined()
      expect(usageKeptIn(database).read().readings.codex[0]?.account).toBeUndefined()
    })
  })
})
