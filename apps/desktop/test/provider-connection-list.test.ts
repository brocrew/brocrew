import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProviderConnection } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { listProviderConnections } from '../src/main/db/provider-connections'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'

let db: AppDatabase
let host: RuntimeHost
const sink: RuntimeEventSink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send: () => {},
  sendLiveness: () => {},
}
beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(async () => {
  await host?.closeAll()
  db.close()
})

function fixture(read?: () => readonly ProviderConnection[]) {
  const prepare = vi.fn(() => {
    throw new Error('metadata must not prepare a home')
  })
  const create = vi.fn(() => {
    throw new Error('metadata must not create a runtime')
  })
  const list = vi.fn(
    read ??
      (() =>
        ['claude', 'codex'].flatMap((provider) =>
          listProviderConnections(db, provider as 'claude' | 'codex'),
        )),
  )
  const deps = {
    store: createSessionStore(db),
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => '/fictional/exports',
    createRuntime: create,
    prepareProviderHome: prepare,
    providerHomePath: () => '/fictional/home',
    resolveCwd: () => '/fictional/work',
    newSessionId: () => 'fictional-session',
    readProviderConfig: () => ({
      home: '/fictional/home',
      homeEnv: 'FICTIONAL_HOME',
      model: 'fictional-small',
      authNote: null,
      files: [],
    }),
  }
  Reflect.set(deps, 'listConnections', list)
  host = new RuntimeHost(deps)
  return { prepare, create, list }
}
const read = () =>
  executeRuntimeCommand(host, sink, runtimeCommandSchema.parse({ kind: 'providerConnections' }))

it('accepts a parameterless metadata read and strips route or credential inputs', () => {
  expect(runtimeCommandSchema.safeParse({ kind: 'providerConnections' }).success).toBe(true)
  expect(
    runtimeCommandSchema.parse({
      kind: 'providerConnections',
      provider: 'codex',
      connectionId: 'fictional-extra',
      key: 'fictional-key',
    }),
  ).toEqual({ kind: 'providerConnections' })
})

it('lists existing compatibility metadata for both providers without opening anything', async () => {
  for (const provider of ['claude', 'codex'])
    db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
      provider,
      'fictional-sealed',
      1,
    )
  const f = fixture()
  const expected = [
    ...listProviderConnections(db, 'claude'),
    ...listProviderConnections(db, 'codex'),
  ]
  expect(await read()).toEqual(expected)
  expect(expected).toHaveLength(4)
  expect(f.list).toHaveBeenCalledTimes(1)
  expect(f.prepare).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  expect(host.sessionIds).toEqual([])
})

it('does not invent a saved-key connection or retain one after its key is removed', async () => {
  fixture()
  expect(await read()).toEqual([
    ...listProviderConnections(db, 'claude'),
    ...listProviderConnections(db, 'codex'),
  ])
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
    'claude',
    'fictional-sealed',
    1,
  )
  expect(await read()).toEqual([
    ...listProviderConnections(db, 'claude'),
    ...listProviderConnections(db, 'codex'),
  ])
  db.prepare('DELETE FROM provider_api_key').run()
  expect(await read()).toHaveLength(2)
})

it('does not expose an extra endpoint or a changed compatibility endpoint', async () => {
  fixture()
  db.prepare(
    'INSERT INTO provider_connection(id,provider,name,auth_method,credential_source,base_url) VALUES(?,?,?,?,?,?)',
  ).run(
    'fictional-extra',
    'claude',
    'Fictional gateway',
    'api-key',
    'provider-api-key',
    'https://fictional.invalid',
  )
  db.prepare('UPDATE provider_connection SET base_url=? WHERE id=?').run(
    'https://fictional.invalid',
    'claude:sign-in',
  )
  expect(await read()).toEqual(listProviderConnections(db, 'codex'))
})

it('returns only declared metadata fields even if a module seam contains an extra value', async () => {
  const row = listProviderConnections(db, 'claude')[0]!
  fixture(() => [{ ...row, fictionalSecret: 'never-render-this-fictional-value' }])
  expect(await read()).toEqual([row])
})

it('does not rewrite any existing rows when the list is drawn repeatedly', async () => {
  fixture()
  const before = db.prepare('SELECT * FROM provider_connection ORDER BY id').all()
  await read()
  await read()
  expect(db.prepare('SELECT * FROM provider_connection ORDER BY id').all()).toEqual(before)
  expect(db.prepare('SELECT * FROM provider_session').all()).toEqual([])
  expect(db.prepare('SELECT * FROM agent_identity').all()).toEqual([])
})

it('refuses a metadata database read once the host is quitting', async () => {
  const f = fixture()
  await host.closeAll()
  await expect(read()).rejects.toThrow()
  expect(f.list).not.toHaveBeenCalled()
})
