import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { deriveProviderHome } from '../src/main/runtime/provider-homes'
import { F093World } from './lib/f093-host'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const folders: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

it('keeps the shared host fixture on the production managed-home layout', async () => {
  const world = new F093World()
  try {
    for (const provider of ['claude', 'codex'] as const)
      for (const profileId of ['brobot', 'fern', 'Fern'])
        expect(world.homeOf(provider, profileId)).toBe(
          deriveProviderHome(world.userData, { provider, profileId }),
        )
  } finally {
    await world.dispose()
  }
})

it.each(['claude', 'codex'] as const)(
  'records and resumes the shared fixture’s %s conversation in the same managed home',
  async (provider) => {
    const world = new F093World()
    try {
      const host = world.buildHost()
      const id = await world.open(host, provider, 'fern')
      expect(world.store.providerLocationOf(id)).toBe(`default/fern/${provider}`)
      const home = world.homeOf(provider, 'fern')
      expect(world.end.newest().options.providerHome).toBe(home)
      await host.close(id, world.window)
      await host.resumeSession(id, world.window)
      expect(world.end.newest().options.providerHome).toBe(home)
      expect(world.store.providerLocationOf(id)).toBe(`default/fern/${provider}`)
    } finally {
      await world.dispose()
    }
  },
)

function olderDatabase(lastIndex: number) {
  const folder = mkdtempSync(join(tmpdir(), 'brocrew-legacy-location-'))
  folders.push(folder)
  const prior = join(folder, 'migrations')
  mkdirSync(join(prior, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  journal.entries = journal.entries.filter((entry) => entry.idx <= lastIndex)
  for (const entry of journal.entries)
    copyFileSync(join(migrations, entry.tag + '.sql'), join(prior, entry.tag + '.sql'))
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify(journal))
  const db = openDatabase(join(folder, 'workspace.sqlite'))
  databases.push(db)
  applyMigrations(db, prior)
  expect(
    (db.pragma('table_info(provider_session)') as { name: string }[]).map((row) => row.name),
  ).not.toContain('provider_home')
  return { db, folder }
}

it.each([12, 15, 16, 17, 19])(
  'keeps unlocated store operations on schema %i and sees the column after migration',
  (lastIndex) => {
    const { db, folder } = olderDatabase(lastIndex)
    let store!: SessionStore
    expect(() => {
      store = createSessionStore(db, () => 100)
    }).not.toThrow()
    store.createAgentIdentity(
      { slug: 'fern', displayName: null, provider: 'codex' },
      { by: 'a-person' },
    )
    expect(store.providerLocationOf('missing')).toBeNull()
    expect(() =>
      store.create({
        id: 'old-fern',
        profileId: 'fern',
        provider: 'codex',
        cwd: folder,
        approvalMode: 'ask',
      }),
    ).not.toThrow()
    expect(store.providerLocationOf('old-fern')).toBeNull()
    expect(store.firstLaunchOf({ id: 'old-fern', model: 'fictional-model' })).toBe(true)
    expect(() =>
      store.adopt({
        id: 'old-adopted',
        profileId: 'fern',
        provider: 'codex',
        sessionId: 'fictional-native-ref',
        cwd: folder,
        createdAt: 20,
        updatedAt: 30,
      }),
    ).not.toThrow()
    expect(store.providerLocationOf('old-adopted')).toBeNull()
    const original = db.prepare('SELECT * FROM provider_session WHERE id = ?').get('old-fern')
    const changes = () => db.prepare('SELECT total_changes() AS count').get()
    const beforeRefusals = changes()
    for (const attempt of [
      () =>
        store.create({
          id: 'premature-location',
          profileId: 'wren',
          provider: 'codex',
          cwd: folder,
          approvalMode: 'ask',
          providerLocation: 'default/wren/codex',
        }),
      () =>
        store.adopt({
          id: 'premature-adoption',
          profileId: 'wren',
          provider: 'codex',
          sessionId: 'fictional-adopted-ref',
          cwd: folder,
          providerLocation: 'default/wren/codex',
          createdAt: 20,
          updatedAt: 30,
        }),
      () =>
        store.firstLaunchOf({
          id: 'old-fern',
          model: 'another-fictional-model',
          providerLocation: 'default/fern/codex',
        }),
    ]) {
      expect(attempt).toThrow()
      expect(changes()).toEqual(beforeRefusals)
    }
    expect(db.prepare('SELECT * FROM provider_session WHERE id = ?').get('old-fern')).toEqual(
      original,
    )
    applyMigrations(db, migrations)
    expect(store.providerLocationOf('old-fern')).toBeNull()
    const migrated = db
      .prepare('SELECT * FROM provider_session WHERE id = ?')
      .get('old-fern') as Record<string, unknown>
    expect(
      Object.fromEntries(Object.entries(migrated).filter(([key]) => key !== 'provider_home')),
    ).toEqual(original)
    store.create({
      id: 'new-fern',
      profileId: 'fern',
      provider: 'codex',
      cwd: folder,
      approvalMode: 'ask',
      providerLocation: 'default/fern/codex',
    })
    expect(store.providerLocationOf('new-fern')).toBe('default/fern/codex')
    expect(store.firstLaunchOf({ id: 'old-fern', providerLocation: 'default/fern/codex' })).toBe(
      true,
    )
    expect(store.providerLocationOf('old-fern')).toBe('default/fern/codex')
    store.adopt({
      id: 'new-adopted',
      profileId: 'fern',
      provider: 'codex',
      sessionId: 'fictional-new-ref',
      cwd: folder,
      providerLocation: 'default/fern/codex',
      createdAt: 40,
      updatedAt: 50,
    })
    expect(store.providerLocationOf('new-adopted')).toBe('default/fern/codex')
  },
)
