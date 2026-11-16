import { metadataEditBaseline } from './lib/connection-metadata-fixture'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { listProviderConnections, resolveProviderConnection } from '../src/main/connections/records'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let folder: string
let file: string
let db: AppDatabase
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'fictional-connection-description-'))
  file = join(folder, 'workspace.db')
  db = openDatabase(file)
  applyMigrations(db, migrations)
})
afterEach(() => {
  if (db.open) db.close()
  rmSync(folder, { recursive: true, force: true })
})

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: returns an empty description on existing compatibility metadata`, () => {
    const rows = listProviderConnections(db, provider)
    expect(rows).toHaveLength(2)
    expect(rows).toEqual([
      expect.objectContaining({ id: `${provider}:sign-in`, description: null }),
      expect.objectContaining({ id: `${provider}:api-key`, description: null }),
    ])
  })

  it(`${provider}: keeps the name and description across reopen without retargeting recorded or legacy conversations`, () => {
    const selected = `${provider}:sign-in`
    const store = createSessionStore(db, () => 100)
    store.create({
      id: 'fictional-recorded',
      provider,
      cwd: '/fictional/fern',
      approvalMode: 'ask',
      profileId: 'fern',
      model: 'fictional-small',
      connectionId: selected,
    })
    store.create({
      id: 'fictional-legacy',
      provider,
      cwd: '/fictional/fern',
      approvalMode: 'ask',
      profileId: 'fern',
      model: 'fictional-small',
    })
    const { sessions, defaults } = metadataEditBaseline(db, store, provider, selected)
    db.prepare('UPDATE provider_connection SET name=?, description=? WHERE id=?').run(
      'Fictional work account',
      'Writing and research',
      selected,
    )
    db.close()
    db = openDatabase(file)
    applyMigrations(db, migrations)
    expect(
      resolveProviderConnection(db, {
        provider,
        connectionId: 'fictional WORK account',
        keySaved: true,
      }),
    ).toMatchObject({
      id: selected,
      name: 'Fictional work account',
      description: 'Writing and research',
    })
    expect(db.prepare('SELECT * FROM provider_session ORDER BY id').all()).toEqual(sessions)
    expect(db.prepare('SELECT * FROM agent_identity ORDER BY slug').all()).toEqual(defaults)
    expect(createSessionStore(db).connectionOf('fictional-legacy')).toBeNull()
  })

  it(`${provider}: keeps omitted legacy key precedence when a connection is renamed`, () => {
    db.prepare('UPDATE provider_connection SET name=? WHERE id=?').run(
      'Fictional renamed account',
      `${provider}:sign-in`,
    )
    expect(resolveProviderConnection(db, { provider, keySaved: false }).id).toBe(
      `${provider}:sign-in`,
    )
    expect(resolveProviderConnection(db, { provider, keySaved: true }).id).toBe(
      `${provider}:api-key`,
    )
    expect(listProviderConnections(db, provider)).toHaveLength(2)
  })
}
