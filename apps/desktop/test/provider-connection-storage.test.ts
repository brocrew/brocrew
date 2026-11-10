import { afterEach, beforeEach, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { resolveProviderConnection } from '../src/main/db/provider-connections'
import {
  createSessionStore,
  type NewSessionRecord,
  type SessionStore,
} from '../src/main/db/session-store'

let db: AppDatabase
let store: SessionStore
beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  store = createSessionStore(db, () => 100)
})
afterEach(() => db.close())

function create(id: string, connectionId?: string) {
  const input: NewSessionRecord & { connectionId?: string } = {
    id,
    provider: 'claude',
    cwd: '/fictional/fern',
    approvalMode: 'ask',
    profileId: 'fern',
    model: 'fictional-small',
    ...(connectionId === undefined ? {} : { connectionId }),
  }
  store.create(input)
}

it('records a new successful launch binding without rewriting its original fields', () => {
  create('fictional-new', 'claude:sign-in')
  expect(
    db
      .prepare('SELECT connection_id,provider,cwd,model FROM provider_session WHERE id=?')
      .get('fictional-new'),
  ).toEqual({
    connection_id: 'claude:sign-in',
    provider: 'claude',
    cwd: '/fictional/fern',
    model: 'fictional-small',
  })
})

it('keeps legacy null choices null when read and reopened', () => {
  create('fictional-legacy')
  const before = db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-legacy')
  const read = Reflect.get(store, 'connectionOf') as ((id: string) => string | null) | undefined
  expect(read).toBeTypeOf('function')
  expect(read?.('fictional-legacy')).toBeNull()
  expect(read?.('fictional-missing')).toBeNull()
  store.find('fictional-legacy')
  expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-legacy')).toEqual(
    before,
  )
  store.reopened('fictional-legacy', 200)
  expect(
    db.prepare('SELECT connection_id FROM provider_session WHERE id=?').get('fictional-legacy'),
  ).toEqual({ connection_id: null })
})

for (const connectionId of ['codex:sign-in', 'fictional-missing']) {
  it(`refuses unavailable binding ${connectionId} atomically`, () => {
    expect(() => create('fictional-refused', connectionId)).toThrow()
    expect(
      db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-refused'),
    ).toBeUndefined()
    expect(db.prepare("SELECT * FROM agent_identity WHERE slug='fern'").get()).toBeUndefined()
  })
}

it('records a resolved key choice after the saved key changes, without repeating availability admission', () => {
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
    'claude',
    'fictional-key',
    1,
  )
  const selected = resolveProviderConnection(db, { provider: 'claude', keySaved: true })
  db.prepare('DELETE FROM provider_api_key WHERE provider=?').run('claude')
  create('fictional-resolved-key', selected.id)
  expect(store.connectionOf('fictional-resolved-key')).toBe(selected.id)
})

it('keeps a saved-key reference rather than copying the sealed value', () => {
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
    'claude',
    'fictional-sealed',
    1,
  )
  create('fictional-key', 'claude:api-key')
  expect(
    db.prepare('SELECT connection_id FROM provider_session WHERE id=?').get('fictional-key'),
  ).toEqual({ connection_id: 'claude:api-key' })
  expect(db.prepare('SELECT sealed FROM provider_api_key WHERE provider=?').get('claude')).toEqual({
    sealed: 'fictional-sealed',
  })
})

it('binds an unlaunched service only on its first actual launch and refuses later retargeting', () => {
  create('fictional-service')
  const first = Reflect.apply(store.firstLaunchOf, store, [
    { id: 'fictional-service', model: 'fictional-small', connectionId: 'claude:sign-in' },
  ])
  expect(first).toBe(true)
  expect(
    db.prepare('SELECT connection_id FROM provider_session WHERE id=?').get('fictional-service'),
  ).toEqual({ connection_id: 'claude:sign-in' })
  const before = db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-service')
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
    'claude',
    'fictional-sealed',
    1,
  )
  expect(() =>
    Reflect.apply(store.firstLaunchOf, store, [
      { id: 'fictional-service', connectionId: 'claude:api-key' },
    ]),
  ).toThrow()
  expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-service')).toEqual(
    before,
  )
})

it('does not fill a legacy NULL binding when its provider already named the conversation', () => {
  create('fictional-old')
  db.prepare('UPDATE provider_session SET external_ref=? WHERE id=?').run(
    JSON.stringify({
      provider: 'claude',
      sessionId: 'fictional-native',
      cwd: '/fictional/fern',
      rotation: 0,
    }),
    'fictional-old',
  )
  const before = db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-old')
  expect(
    Reflect.apply(store.firstLaunchOf, store, [
      { id: 'fictional-old', connectionId: 'claude:sign-in' },
    ]),
  ).toBe(false)
  expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-old')).toEqual(
    before,
  )
})

it('renaming compatibility connections cannot split or erase the existing provider wall', () => {
  create('fictional-subscription', 'claude:sign-in')
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
    'claude',
    'fictional-sealed',
    1,
  )
  create('fictional-key-wall', 'claude:api-key')
  for (const id of ['fictional-subscription', 'fictional-key-wall'])
    store.append(
      id,
      0,
      {
        type: 'error',
        fatal: false,
        message: 'claude is rate-limited (seven_day); resets 1970-01-01T01:00:00.200Z',
      },
      110,
    )
  const before = store.providerLimitsSeen(200).rows
  expect(before.map((wall) => [wall.provider, wall.standing])).toEqual([['claude', 'stopped']])
  db.prepare('UPDATE provider_connection SET name=? WHERE id=?').run(
    'Fictional renamed subscription',
    'claude:sign-in',
  )
  db.prepare('UPDATE provider_connection SET name=? WHERE id=?').run(
    'Fictional renamed key',
    'claude:api-key',
  )
  expect(store.providerLimitsSeen(200).rows).toEqual(before)
})
