import { afterEach, beforeEach, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  listProviderConnections,
  resolveProviderConnection,
} from '../src/main/db/provider-connections'
import { providerDescriptor } from '@brobot2/shared'

let db: AppDatabase
beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(() => db.close())

it('lists sign-ins first, and the saved key only while one is saved', () => {
  expect(listProviderConnections(db, 'claude', false).map((row) => row.id)).toEqual([
    'claude:sign-in',
  ])
  const records = listProviderConnections(db, 'claude', true)
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

it('refuses a missing, cross-provider, disabled or noncompatibility explicit selection without fallback', () => {
  for (const connectionId of ['missing', 'codex:sign-in', 'claude:api-key'])
    expect(() =>
      resolveProviderConnection(db, { provider: 'claude', connectionId, keySaved: false }),
    ).toThrow()
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
  expect(listProviderConnections(db, 'claude', false).map((row) => row.id)).toEqual([
    'claude:sign-in',
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
    expect(contract.versionSource).toBe(provider === 'claude' ? 'sdk' : 'app-server')
    expect(contract.additionalConnections).toBe(false)
    expect(contract).not.toHaveProperty('host')
  }
})
