import { providerDescriptor } from '@brobot2/shared'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { listProviderConnections, resolveProviderConnection } from '../src/main/connections/records'

let db: AppDatabase
beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(() => db.close())

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: declared connection metadata includes the not-ready API route`, () => {
    expect(listProviderConnections(db, provider).map((connection) => connection.id)).toEqual([
      `${provider}:sign-in`,
      `${provider}:api-key`,
    ])
  })

  it(`${provider}: resolving an explicit not-ready route returns metadata without substituting a subscription`, () => {
    expect(
      resolveProviderConnection(db, {
        provider,
        connectionId: `${provider}:api-key`,
        keySaved: false,
      }),
    ).toMatchObject({ id: `${provider}:api-key`, provider, authMethod: 'api-key' })
  })

  it(`${provider}: a provider-local connection name resolves to its canonical ID`, () => {
    db.prepare('UPDATE provider_connection SET name=? WHERE id=?').run(
      'Fern subscription',
      `${provider}:sign-in`,
    )
    expect(
      resolveProviderConnection(db, {
        provider,
        connectionId: 'fern SUBSCRIPTION',
        keySaved: true,
      }),
    ).toMatchObject({ id: `${provider}:sign-in`, name: 'Fern subscription', authMethod: 'sign-in' })
  })

  it(`${provider}: a named API route keeps its method before adapter readiness is checked`, () => {
    db.prepare('UPDATE provider_connection SET name=? WHERE id=?').run(
      'Fern metered',
      `${provider}:api-key`,
    )
    expect(
      resolveProviderConnection(db, { provider, connectionId: 'Fern metered', keySaved: true }).id,
    ).toBe(`${provider}:api-key`)
    expect(
      resolveProviderConnection(db, { provider, connectionId: 'Fern metered', keySaved: false }),
    ).toMatchObject({ id: `${provider}:api-key`, authMethod: 'api-key' })
  })

  it(`${provider}: a canonical ID takes priority over another connection's name`, () => {
    const id = `${provider}:api-key`
    db.prepare('UPDATE provider_connection SET name=? WHERE id=?').run(id, `${provider}:sign-in`)
    expect(resolveProviderConnection(db, { provider, connectionId: id, keySaved: true }).id).toBe(
      id,
    )
  })
}

it('connection selection does not interpret an address or key as connection configuration', () => {
  const before = db.prepare('SELECT * FROM provider_connection ORDER BY id').all()
  for (const connectionId of [
    'https://fictional.invalid/inference',
    'fictional-unregistered-key',
  ]) {
    expect(() =>
      resolveProviderConnection(db, { provider: 'claude', connectionId, keySaved: true }),
    ).toThrow('The selected connection is unavailable')
  }
  expect(db.prepare('SELECT * FROM provider_connection ORDER BY id').all()).toEqual(before)
})

it('lists compatibility metadata sign-in first, without reading key availability', () => {
  expect(listProviderConnections(db, 'claude').map((row) => row.id)).toEqual([
    'claude:sign-in',
    'claude:api-key',
  ])
  const records = listProviderConnections(db, 'claude')
  expect(records.map((row) => [row.id, row.authMethod, row.credentialSource])).toEqual([
    ['claude:sign-in', 'sign-in', 'provider-sign-in'],
    ['claude:api-key', 'api-key', 'provider-api-key'],
  ])
})

it('keeps null and omitted old choices dynamic, including keys set or removed later', () => {
  for (const provider of ['claude', 'codex'] as const) {
    expect(resolveProviderConnection(db, { provider, keySaved: false }).authMethod).toBe('sign-in')
    expect(
      resolveProviderConnection(db, { provider, connectionId: null, keySaved: true }).authMethod,
    ).toBe('api-key')
  }
})

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: an explicit subscription stays selected when a key is saved`, () => {
    const connectionId = `${provider}:sign-in`
    for (const keySaved of [false, true, false]) {
      expect(resolveProviderConnection(db, { provider, connectionId, keySaved })).toMatchObject({
        id: connectionId,
        authMethod: 'sign-in',
        credentialSource: 'provider-sign-in',
      })
    }
  })
}

it('refuses a missing, cross-provider, disabled or noncompatibility explicit selection without fallback', () => {
  for (const connectionId of ['missing', 'codex:sign-in'])
    expect(() =>
      resolveProviderConnection(db, { provider: 'claude', connectionId, keySaved: false }),
    ).toThrow()
  db.prepare('UPDATE provider_connection SET enabled = 0 WHERE id = ?').run('claude:api-key')
  expect(() =>
    resolveProviderConnection(db, {
      provider: 'claude',
      connectionId: 'claude:api-key',
      keySaved: false,
    }),
  ).toThrow('The selected connection is unavailable')
  db.prepare('UPDATE provider_connection SET enabled = 1 WHERE id = ?').run('claude:api-key')
  db.prepare('UPDATE provider_connection SET enabled = 0 WHERE id = ?').run('claude:sign-in')
  expect(() => resolveProviderConnection(db, { provider: 'claude', keySaved: false })).toThrow()
  db.prepare('UPDATE provider_connection SET enabled = 1, base_url = ? WHERE id = ?').run(
    'https://fictional.invalid',
    'claude:sign-in',
  )
  expect(() => resolveProviderConnection(db, { provider: 'claude', keySaved: false })).toThrow()
})

it('does not expose extra rows even if a future or foreign writer inserted one', () => {
  db.prepare(
    `INSERT INTO provider_connection
    (id,provider,name,auth_method,credential_source,base_url,enabled,contract_version)
    VALUES ('fictional-extra','claude','company gateway','api-key','provider-api-key',NULL,1,1)`,
  ).run()
  expect(listProviderConnections(db, 'claude').map((row) => row.id)).toEqual([
    'claude:sign-in',
    'claude:api-key',
  ])
  expect(() =>
    resolveProviderConnection(db, {
      provider: 'claude',
      connectionId: 'fictional-extra',
      keySaved: false,
    }),
  ).toThrow()
})

it('describes authentication and protocol capabilities without a secret or host field', () => {
  for (const provider of ['claude', 'codex'] as const) {
    const contract = providerDescriptor(provider).connections
    expect(contract.authMethods).toEqual(['sign-in', 'api-key'])
    expect(contract.contractVersion).toBe(1)
    expect(contract).not.toHaveProperty('protocol')
    expect(contract).not.toHaveProperty('versionSource')
    expect(contract.additionalConnections).toBe(false)
    expect(contract).not.toHaveProperty('host')
  }
})
