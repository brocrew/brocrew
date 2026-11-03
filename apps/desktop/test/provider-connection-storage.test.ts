import { afterEach, beforeEach, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type NewSessionRecord, type SessionStore } from '../src/main/db/session-store'

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
    id, provider: 'claude', cwd: '/fictional/fern', approvalMode: 'ask', profileId: 'fern', model: 'fictional-small',
    ...(connectionId === undefined ? {} : { connectionId }),
  }
  store.create(input)
}

it('records a new successful launch binding without rewriting its original fields', () => {
  create('fictional-new', 'claude:sign-in')
  expect(db.prepare('SELECT connection_id,provider,cwd,model FROM provider_session WHERE id=?').get('fictional-new')).toEqual({
    connection_id: 'claude:sign-in', provider: 'claude', cwd: '/fictional/fern', model: 'fictional-small',
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
  expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-legacy')).toEqual(before)
  store.reopened('fictional-legacy', 200)
  expect(db.prepare('SELECT connection_id FROM provider_session WHERE id=?').get('fictional-legacy')).toEqual({ connection_id: null })
})

for (const connectionId of ['codex:sign-in', 'fictional-missing', 'claude:api-key']) {
  it(`refuses unavailable binding ${connectionId} atomically`, () => {
    expect(() => create('fictional-refused', connectionId)).toThrow()
    expect(db.prepare('SELECT * FROM provider_session WHERE id=?').get('fictional-refused')).toBeUndefined()
    expect(db.prepare("SELECT * FROM agent_identity WHERE slug='fern'").get()).toBeUndefined()
  })
}

it('keeps a saved-key reference rather than copying the sealed value', () => {
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run('claude', 'fictional-sealed', 1)
  create('fictional-key', 'claude:api-key')
  expect(db.prepare('SELECT connection_id FROM provider_session WHERE id=?').get('fictional-key')).toEqual({ connection_id: 'claude:api-key' })
  expect(db.prepare('SELECT sealed FROM provider_api_key WHERE provider=?').get('claude')).toEqual({ sealed: 'fictional-sealed' })
})
