import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import * as connections from '../src/main/db/provider-connections'
import type { Provider, ProviderConnection } from '@brobot2/shared'

let db: AppDatabase
beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(() => db.close())

function choose(connection: string, provider?: Provider): ProviderConnection {
  const resolve = Reflect.get(connections, 'resolveNamedProviderConnection') as
    | ((
        db: AppDatabase,
        selection: { connection: string; provider?: Provider },
      ) => ProviderConnection)
    | undefined
  expect(resolve, 'a named connection is resolved before a launch is planned').toBeTypeOf(
    'function',
  )
  if (!resolve) throw new Error('Named connection selection is absent')
  return resolve(db, { connection, ...(provider === undefined ? {} : { provider }) })
}

it('resolves a stable ID without needing a provider or a machine path', () => {
  expect(choose('claude:sign-in')).toMatchObject({ provider: 'claude', id: 'claude:sign-in' })
  expect(choose('codex:sign-in')).toMatchObject({ provider: 'codex', id: 'codex:sign-in' })
})
it('accepts a unique stored name and the flat picker label', () => {
  expect(choose(' subscription ')).toMatchObject({ id: 'claude:sign-in' })
  expect(choose('Claude · subscription')).toMatchObject({ id: 'claude:sign-in' })
  expect(choose('Codex · ChatGPT')).toMatchObject({ id: 'codex:sign-in' })
})
it('refuses an explicit provider that contradicts an ID or labelled connection', () => {
  expect(() => choose('codex:sign-in', 'claude')).toThrow()
  expect(() => choose('Codex · ChatGPT', 'claude')).toThrow()
  expect(choose('subscription', 'claude').provider).toBe('claude')
})
it('refuses ambiguous names rather than selecting the first provider', () => {
  db.prepare("UPDATE provider_connection SET name = 'fern' WHERE auth_method = 'sign-in'").run()
  expect(() => choose('fern')).toThrow()
  expect(choose('fern', 'codex').id).toBe('codex:sign-in')
  expect(choose('Claude · fern').id).toBe('claude:sign-in')
})
it('keeps stable IDs authoritative when another entry is renamed to that ID', () => {
  db.prepare(
    "UPDATE provider_connection SET name = 'claude:sign-in' WHERE id = 'codex:sign-in'",
  ).run()
  expect(choose('claude:sign-in').provider).toBe('claude')
})
it('does not expose an unsaved key, a disabled entry or a custom endpoint', () => {
  expect(() => choose('claude:api-key')).toThrow()
  db.prepare("UPDATE provider_connection SET enabled=0 WHERE id='claude:sign-in'").run()
  expect(() => choose('subscription')).toThrow()
  db.prepare(
    "UPDATE provider_connection SET base_url='https://fern.invalid' WHERE id='codex:sign-in'",
  ).run()
  expect(() => choose('ChatGPT')).toThrow()
})
it('rejects addresses, paths and unknown or empty names without a fallback', () => {
  for (const name of ['', ' ', 'https://fern.invalid', '/fictional/fern', 'missing'])
    expect(() => choose(name)).toThrow()
})
it('resolves saved-key metadata without reading or unsealing the stored value', () => {
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
    'claude',
    'fictional-sealed-fern',
    1,
  )
  const prepare = vi.spyOn(db, 'prepare')
  expect(choose('Claude · API key').id).toBe('claude:api-key')
  expect(JSON.stringify(choose('claude:api-key'))).not.toContain('fictional-sealed-fern')
  expect(prepare.mock.calls.some(([sql]) => /select\s+(?:\*|sealed)/i.test(sql))).toBe(false)
  prepare.mockRestore()
})
it('does not admit future connection rows through a matching display name', () => {
  db.prepare(
    `INSERT INTO provider_connection
    (id,provider,name,auth_method,credential_source,base_url,enabled,contract_version)
    VALUES ('fern-extra','claude','Fern gateway','api-key','provider-api-key',NULL,1,1)`,
  ).run()
  expect(() => choose('Fern gateway')).toThrow()
  expect(() => choose('fern-extra')).toThrow()
})
