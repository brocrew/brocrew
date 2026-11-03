import { afterEach, beforeEach, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import type { Provider } from '@brobot2/shared'

let db: AppDatabase
let store: SessionStore
beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  store = createSessionStore(db, () => 100)
  store.createAgentIdentity(
    { slug: 'fern', displayName: 'Fern', provider: 'claude' },
    { by: 'a-person' },
  )
})
afterEach(() => db.close())
function select(provider: Provider, id: string | null, profile = 'fern'): boolean {
  const save = Reflect.get(store, 'setAgentConnection') as
    ((profile: string, provider: Provider, id: string | null) => boolean) | undefined
  expect(save, 'agent defaults store a qualified connection reference').toBeTypeOf('function')
  if (!save) throw new Error('Agent connection defaults are absent')
  return save(profile, provider, id)
}
function held(): string | null {
  const read = Reflect.get(store, 'defaultConnectionOf') as
    ((profile: string) => string | null) | undefined
  expect(read).toBeTypeOf('function')
  if (!read) throw new Error('Agent connection defaults are absent')
  return read('fern')
}
function row() {
  return db.prepare("SELECT * FROM agent_identity WHERE slug='fern'").get()
}

it('reads old defaults without filling NULL or altering any old field', () => {
  const before = row()
  expect(held()).toBeNull()
  store.modelChoiceOf('fern')
  expect(row()).toEqual(before)
})
it('saves a stable default and projects it only when one was chosen', () => {
  expect(store.agentIdentities()[0]).not.toHaveProperty('connectionId')
  expect(select('claude', 'claude:sign-in')).toBe(true)
  expect(held()).toBe('claude:sign-in')
  expect(store.agentIdentities()[0]).toMatchObject({
    provider: 'claude',
    connectionId: 'claude:sign-in',
  })
  db.prepare("UPDATE provider_connection SET name='Fern renamed' WHERE id='claude:sign-in'").run()
  expect(held()).toBe('claude:sign-in')
})
it('a new default never rewrites existing bound or legacy conversations or their history', () => {
  for (const [id, connectionId] of [
    ['fictional-bound', 'claude:sign-in'],
    ['fictional-old', undefined],
  ] as const)
    store.create({
      id,
      provider: 'claude',
      cwd: '/fictional/fern',
      profileId: 'fern',
      approvalMode: 'ask',
      ...(connectionId === undefined ? {} : { connectionId }),
    })
  const before = db.prepare('SELECT * FROM provider_session ORDER BY id').all()
  expect(select('codex', 'codex:sign-in')).toBe(true)
  expect(store.providerOf('fern')).toBe('codex')
  expect(db.prepare('SELECT * FROM provider_session ORDER BY id').all()).toEqual(before)
})
it('refuses missing, foreign, disabled and unsaved-key choices atomically', () => {
  const before = row()
  for (const id of ['missing', 'codex:sign-in', 'claude:api-key']) {
    expect(() => select('claude', id)).toThrow()
    expect(row()).toEqual(before)
  }
  db.prepare("UPDATE provider_connection SET enabled=0 WHERE id='claude:sign-in'").run()
  expect(() => select('claude', 'claude:sign-in')).toThrow()
  expect(row()).toEqual(before)
})
it('cannot create an identity by configuring it', () => {
  expect(select('claude', 'claude:sign-in', 'willow')).toBe(false)
  expect(db.prepare("SELECT * FROM agent_identity WHERE slug='willow'").get()).toBeUndefined()
})
it('clears a model for another provider in the same act and leaves its other fields exact', () => {
  store.setModelChoice('fern', { provider: 'claude', model: 'fictional-small', effort: null })
  const before = row() as Record<string, unknown>
  select('codex', 'codex:sign-in')
  expect(row()).toEqual({
    ...before,
    provider: 'codex',
    model_choice: null,
    connection_id: 'codex:sign-in',
  })
})
it('rolls model and connection back together if the enclosing default save fails', () => {
  const before = row()
  expect(() =>
    store.atomically(() => {
      select('claude', 'claude:sign-in')
      store.setModelChoice('fern', { provider: 'claude', model: 'fictional-small', effort: null })
      throw new Error('fictional failed save')
    }),
  ).toThrow('fictional failed save')
  expect(row()).toEqual(before)
})
it('a legacy provider change clears a contradictory connection without touching conversations', () => {
  select('claude', 'claude:sign-in')
  store.setAgentProvider('fern', 'codex')
  expect(held()).toBeNull()
  expect(store.providerOf('fern')).toBe('codex')
})
it('an unavailable saved-key binding stays recorded rather than silently becoming a sign-in', () => {
  db.prepare('INSERT INTO provider_api_key(provider,sealed,updated_at) VALUES(?,?,?)').run(
    'claude',
    'fictional-sealed',
    1,
  )
  select('claude', 'claude:api-key')
  db.prepare("DELETE FROM provider_api_key WHERE provider='claude'").run()
  expect(held()).toBe('claude:api-key')
  expect(select('claude', null)).toBe(true)
  expect(held()).toBeNull()
})
