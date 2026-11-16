import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProviderConnection } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { listProviderConnections, resolveProviderConnection } from '../src/main/connections/records'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'

let db: AppDatabase
const saved = new Set<'claude' | 'codex'>()
let host: RuntimeHost
const sink: RuntimeEventSink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send: () => {},
  sendLiveness: () => {},
}
beforeEach(() => {
  saved.clear()
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

it('lists existing compatibility metadata for both providers without opening anything', async () => {
  for (const provider of ['claude', 'codex'] as const) saved.add(provider)
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

it('keeps four metadata routes across key save and removal while legacy routing follows the key', async () => {
  const f = fixture()
  const expected = [
    ...listProviderConnections(db, 'claude'),
    ...listProviderConnections(db, 'codex'),
  ]
  const legacy = () =>
    resolveProviderConnection(db, { provider: 'claude', keySaved: saved.has('claude') }).id
  expect(expected).toHaveLength(4)
  expect(await read()).toEqual(expected)
  expect(legacy()).toBe('claude:sign-in')
  saved.add('claude')
  expect(await read()).toEqual(expected)
  expect(legacy()).toBe('claude:api-key')
  saved.clear()
  expect(await read()).toEqual(expected)
  expect(legacy()).toBe('claude:sign-in')
  expect(f.prepare).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
  expect(host.sessionIds).toEqual([])
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
  expect(await read()).toEqual([
    ...listProviderConnections(db, 'claude'),
    ...listProviderConnections(db, 'codex'),
  ])
  expect(await read()).toMatchObject([
    { id: 'claude:api-key' },
    { id: 'codex:sign-in' },
    { id: 'codex:api-key' },
  ])
})

it('returns only declared metadata fields even if a module seam contains an extra value', async () => {
  const row = listProviderConnections(db, 'claude')[0]!
  fixture(() => [{ ...row, fictionalSecret: 'never-render-this-fictional-value' }])
  expect(await read()).toEqual([row])
})

it('refuses a metadata database read once the host is quitting', async () => {
  const f = fixture()
  await host.closeAll()
  await expect(read()).rejects.toThrow()
  expect(f.list).not.toHaveBeenCalled()
})

it.each(['claude', 'codex'] as const)(
  'forwards %s display metadata through the public list',
  async (provider) => {
    const f = fixture()
    db.prepare('UPDATE provider_connection SET description=? WHERE id=?').run(
      'Fictional writing and research',
      `${provider}:sign-in`,
    )
    const expected = listProviderConnections(db, provider)[0]!
    expect(await read()).toContainEqual(expected)
    expect(expected.description).toBe('Fictional writing and research')
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  },
)
