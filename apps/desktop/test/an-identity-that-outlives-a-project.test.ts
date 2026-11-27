import {
  fixtureProviderConfig,
  neutralHostDeps,
  RecordingSink as NullSink,
} from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { HOME_FOLDER } from '../src/main/connections/homes'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('an identity that outlives a project', () => {
  let dir: string
  let db: AppDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-identity-'))
  })
  afterEach(() => {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const migrated = (): AppDatabase => {
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    return db
  }

  describe('what a person sets belongs to the identity', () => {
    let userData: string
    let store: SessionStore
    let host: RuntimeHost
    let folders: string[]
    let counter: number

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-identity-grant-'))
      folders = ['default']
      counter = 0
      migrated()
      store = createSessionStore(db)
      host = new RuntimeHost({
        store,
        ...neutralHostDeps(() => userData),
        createRuntime: (provider: Provider) => new FakeRuntime(provider),
        listProfiles: () => folders,
        prepareProviderHome: (provider, profileId) => {
          const home = join(userData, 'provider-homes', HOME_FOLDER, profileId, provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider, profileId) =>
          join(userData, 'provider-homes', HOME_FOLDER, profileId, provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${++counter}`,
        readProviderConfig: fixtureProviderConfig,
      })
    })
    afterEach(async () => {
      await host.closeAll()
      rmSync(userData, { recursive: true, force: true })
    })

    it('a server association made while working one ticket is what the next conversation reads', async () => {
      store.create({
        id: 'sess_a',
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'explorer',
      })
      const server = store.registerExternalMcpServer({
        name: 'notes',
        url: 'http://127.0.0.1:9/mcp',
        reach: 'restricted',
      })
      if (server === null) throw new Error('the server was not registered')
      const saved = host.setExternalMcpServers('explorer', [server.id])
      expect(saved?.externalMcpServerIds).toEqual([server.id])

      store.create({
        id: 'sess_b',
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'explorer',
      })
      expect(store.agentIdentityOf('explorer')?.externalMcpServerIds).toEqual([server.id])
    })

    it('still refuses to configure an identity that does not exist, and creates nothing', () => {
      expect(host.setExternalMcpServers('nobody', [])).toBeNull()
      expect(db.prepare('SELECT count(*) AS n FROM agent_identity').get()).toEqual({ n: 0 })
    })

    it('a directory with no identity row is still named as an orphan, and creates nothing', () => {
      folders = ['default', 'Explorer', 'ghost']
      store.create({
        id: 'sess_a',
        provider: 'claude',
        cwd: dir,
        approvalMode: 'ask',
        profileId: 'Explorer',
      })
      const list = host.agentIdentities()
      expect(list.foldersWithoutARow).toEqual(['default', 'ghost'])
      expect(db.prepare('SELECT count(*) AS n FROM agent_identity').get()).toEqual({ n: 1 })
    })
  })

  describe('one identity opened twice by a person', () => {
    it('a PERSON may open the same identity twice, on either provider, with no rail at all', async () => {
      const userData = mkdtempSync(join(tmpdir(), 'brobot2-identity-person-'))
      const work = mkdtempSync(join(tmpdir(), 'brobot2-identity-person-work-'))
      migrated()
      let counter = 0
      const host = new RuntimeHost({
        store: createSessionStore(db),
        ...neutralHostDeps(() => userData),
        createRuntime: (provider: Provider) => new FakeRuntime(provider),
        listProfiles: () => ['default', 'worker'],
        prepareProviderHome: (provider, profileId) => {
          const home = join(userData, 'provider-homes', HOME_FOLDER, profileId, provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider, profileId) =>
          join(userData, 'provider-homes', HOME_FOLDER, profileId, provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${++counter}`,
        readProviderConfig: fixtureProviderConfig,
      })
      try {
        const sink = new NullSink()
        const a = await host.createSession(
          { provider: 'codex', profileId: 'worker', cwd: work, approvalMode: 'ask' },
          sink,
        )
        const b = await host.createSession(
          { provider: 'claude', profileId: 'worker', cwd: work, approvalMode: 'ask' },
          sink,
        )
        expect(a.sessionId).not.toBe(b.sessionId)
        expect(
          db.prepare('SELECT id, agent_identity_id FROM provider_session ORDER BY id').all(),
        ).toEqual([
          { id: a.sessionId, agent_identity_id: 'aid:worker' },
          { id: b.sessionId, agent_identity_id: 'aid:worker' },
        ])
      } finally {
        await host.closeAll()
        rmSync(userData, { recursive: true, force: true })
        rmSync(work, { recursive: true, force: true })
      }
    })
  })
})
