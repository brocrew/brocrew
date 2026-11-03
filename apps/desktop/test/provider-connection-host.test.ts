import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { resolveProviderConnection } from '../src/main/db/provider-connections'
import { onProviderConnection } from '../src/main/providers'
import { prepareCodexHome } from '../src/main/providers/codex'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

let db: AppDatabase
let dir: string
let host: RuntimeHost
const sink: RuntimeEventSink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send: () => {},
  sendLiveness: () => {},
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-connections-'))
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(async () => {
  await host?.closeAll()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function fixture() {
  const store = createSessionStore(db)
  const sessions = new FakeProviderSessions()
  const state: { revision: number; revisionOf?: (provider: Provider) => number } = { revision: 0 }
  let number = 0
  const prepare = vi.fn<(provider: Provider, profile: string) => string | Promise<string>>(
    (provider, profile) => {
      const home = join(dir, profile, provider)
      mkdirSync(home, { recursive: true })
      return home
    },
  )
  const resolve = (provider: Provider, id?: string | null) => {
    const connection = resolveProviderConnection(db, { provider, connectionId: id })
    if (id != null && connection.id !== resolveProviderConnection(db, { provider }).id)
      throw new Error('The selected connection conflicts with the current credential route')
    return connection
  }
  const connectionFor = vi.fn((provider: Provider, id?: string | null) => resolve(provider, id).id)
  const create = vi.fn((provider: Provider, id?: string | null) =>
    onProviderConnection(
      provider,
      () => new FakeRuntime(provider, { sessions }),
      (requested) => resolve(provider, requested),
      id,
    ),
  )
  const deps = {
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: create,
    prepareProviderHome: prepare,
    providerHomePath: (provider: Provider, profile: string) => join(dir, profile, provider),
    resolveCwd: () => dir,
    newSessionId: () => `fictional-session-${++number}`,
    readProviderConfig: (_provider: Provider, home: string) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'fictional-small',
      authNote: null,
      files: [],
    }),
  }
  Reflect.set(deps, 'connectionFor', connectionFor)
  Reflect.set(deps, 'connectionRevision', (provider: Provider) =>
    state.revisionOf?.(provider) ?? state.revision,
  )
  host = new RuntimeHost(deps)
  return { store, prepare, create, connectionFor, state, deps }
}

it('Codex key consumption during real home preparation cannot launch under changed-back sign-in metadata', async () => {
  const f = fixture()
  const keys = new ApiKeys(f.store, {
    available: () => true,
    seal: (key) => Buffer.from(key).toString('base64'),
    open: (sealed) => Buffer.from(sealed, 'base64').toString(),
  })
  f.state.revisionOf = (provider) => keys.revision(provider)
  let applied: string | undefined
  const copied = vi.fn()
  f.prepare.mockImplementation((_provider, profile) =>
    prepareCodexHome(
      {
        managedRoot: dir,
        defaultProfile: 'fern',
        homeOf: (name) => join(dir, name, 'codex'),
        profiles: () => ['fern'],
        assertMayOpen: () => {},
      },
      profile,
      {
        provisionHome: (_root, home) => {
          mkdirSync(home, { recursive: true })
        },
        provisionCodexAuth: copied,
        key: {
          isSaved: () => keys.status('codex').set,
          current: async () => {
            await keys.set('codex', 'fictional-willow-key')
            const key = await keys.current('codex')
            keys.remove('codex')
            return key
          },
          change: async (_home, change) => {
            applied = change.to
            return { ok: true, authMethod: 'apikey' }
          },
        },
      },
    ),
  )
  await expect(host.createSession({ provider: 'codex', profileId: 'fern' }, sink)).rejects.toThrow(
    'connection changed',
  )
  expect(applied).toBe('the-key')
  expect(keys.revision('codex')).toBe(2)
  expect(copied).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  expect(db.prepare('SELECT connection_id FROM provider_session').all()).toEqual([])
})

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: records successful new launches on the admitted connection and per-agent home`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern', cwd: dir }, sink)
    expect(f.connectionFor).toHaveBeenCalledWith(provider)
    expect(f.create).toHaveBeenCalledWith(provider, `${provider}:sign-in`)
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
    expect(created.providerHome).toBe(join(dir, 'fern', provider))
  })

  it(`${provider}: rejects a disabled connection before preparing a home or creating a runtime`, async () => {
    const f = fixture()
    db.prepare('UPDATE provider_connection SET enabled=0 WHERE id=?').run(`${provider}:sign-in`)
    await expect(host.createSession({ provider, profileId: 'fern' }, sink)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([])
  })

  it(`${provider}: model admission refuses a disabled connection before preparing its home`, async () => {
    const f = fixture()
    db.prepare('UPDATE provider_connection SET enabled=0 WHERE id=?').run(`${provider}:sign-in`)
    expect(await host.providerModels('fern', provider)).toMatchObject({ ok: false })
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it(`${provider}: a key changed and changed back during preparation cannot launch`, async () => {
    const f = fixture()
    const prepare = f.prepare.getMockImplementation()!
    f.prepare.mockImplementation((kind, profile) => {
      f.state.revision += 2
      return prepare(kind, profile)
    })
    await expect(host.createSession({ provider, profileId: 'fern' }, sink)).rejects.toThrow()
    expect(f.create).not.toHaveBeenCalled()
    expect(db.prepare('SELECT id FROM provider_session').all()).toEqual([])
  })

  it(`${provider}: resume retains a recorded binding instead of choosing a newly saved key`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=? WHERE id=?').run(
      `${provider}:sign-in`,
      created.sessionId,
    )
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    f.prepare.mockClear()
    f.create.mockClear()
    await expect(host.resumeSession(created.sessionId, sink)).rejects.toThrow()
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.store.connectionOf(created.sessionId)).toBe(`${provider}:sign-in`)
  })

  it(`${provider}: reopening legacy NULL chooses dynamically without backfilling`, async () => {
    const f = fixture()
    const created = await host.createSession({ provider, profileId: 'fern' }, sink)
    await host.close(created.sessionId, sink)
    db.prepare('UPDATE provider_session SET connection_id=NULL WHERE id=?').run(created.sessionId)
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
    const resumed = await host.resumeSession(created.sessionId, sink)
    expect(resumed.ref).toEqual(created.ref)
    expect(resumed.providerHome).toBe(join(dir, 'fern', provider))
    expect(f.store.connectionOf(created.sessionId)).toBeNull()
    expect(f.create).toHaveBeenLastCalledWith(provider, `${provider}:api-key`)
  })
}
