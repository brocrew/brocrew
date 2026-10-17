import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

/**
 * # F046 · the store's two doors for the files kept before titles were taken
 *
 * `50a548e2` gave the store `untitledResources(limit)` — the `work_resource` rows whose title is
 * NULL, oldest first, at most `limit` — and `titleResource(id, title)`, which writes only
 * `WHERE title IS NULL`; `3cbc4bf5` made it answer whether it wrote. Together they are what makes
 * the titling pass run once by the data and never replace a title taken as a file was kept.
 *
 * ⚑ Real SQLite, real migrations, no host. A row "kept before titles were taken" is planted as that
 * build wrote it: a raw `INSERT` with no title (the idiom of
 * `a-kept-file-is-titled-by-what-its-own-bytes-say`); a row kept by this build goes through
 * `addResource`, which always carries a title.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('F046 · untitledResources and titleResource', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let clock: number
  let piece: string
  let planted: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f046-store-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 4_600_000
    store = createSessionStore(db, tick)
    planted = 0
    // ⚑ A conversation a person started owns a root: the piece every row below is kept on.
    store.create({
      id: 'sess_keeper',
      provider: 'claude',
      cwd: userData,
      approvalMode: 'auto',
      profileId: 'keeper',
    })
    const root = store.rootOf('sess_keeper')
    if (root === null) throw new Error('the keeper owns no root')
    piece = root.piece
  })

  afterEach(() => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** A row as a build before D-026 wrote it: no title at all. */
  const plantUntitled = (name: string): string => {
    const id = `res_${String(++planted).padStart(32, '0')}`
    db.prepare(
      'INSERT INTO work_resource (id, work_id, role, name, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, piece, 'made', name, 'a'.repeat(64), 1, tick())
    return id
  }

  /** A row kept by this build, through the store's own door: always titled. */
  const keptTitled = (name: string, title: string): string =>
    store.addResource(
      {
        piece,
        role: 'made',
        title,
        summary: null,
        name,
        sha256: 'b'.repeat(64),
        bytes: 1,
        addedBy: null,
      },
      tick(),
    ).resource

  it('untitledResources answers only the rows with no title, oldest first, and no more than it is asked for', () => {
    // ⚑ Untitled and titled rows interleaved, so a read that ignored the title would show.
    const first = plantUntitled('one.md')
    const titledA = keptTitled('kept-a.md', 'Kept A')
    const second = plantUntitled('two.md')
    const third = plantUntitled('three.md')
    const titledB = keptTitled('kept-b.md', 'Kept B')
    const fourth = plantUntitled('four.md')

    // ⚠️ The premise, off the rows: which have a title and which have none.
    expect(store.resource(first)?.title).toBeNull()
    expect(store.resource(titledA)?.title).toBe('Kept A')

    // ⚑ The whole set: the four untitled rows in the order they were kept, and no titled one.
    const all = store.untitledResources(100)
    expect(all.map((row) => row.resource)).toEqual([first, second, third, fourth])
    for (const titled of [titledA, titledB]) {
      expect(
        all.map((row) => row.resource),
        `${titled} has a title`,
      ).not.toContain(titled)
    }
    // ⚑ Each row is the whole row, its title NULL.
    expect(all[0]).toMatchObject({ resource: first, piece, name: 'one.md', title: null })

    // ⚑ Bounded: the OLDEST `limit`, never the newest.
    expect(store.untitledResources(2).map((row) => row.resource)).toEqual([first, second])
    expect(store.untitledResources(1).map((row) => row.resource)).toEqual([first])
  })

  it('titleResource writes a title only while the row has none, and answers whether it wrote', () => {
    const old = plantUntitled('old.md')
    const kept = keptTitled('kept.md', 'Taken as it was kept')

    // ⚑ The positive: a row with no title takes one, and the door says so.
    expect(store.titleResource(old, 'First title')).toBe(true)
    expect(store.resource(old)?.title).toBe('First title')

    // ⛔ A second write to the same row writes nothing, says so, and the first title stands.
    expect(store.titleResource(old, 'Second title')).toBe(false)
    expect(store.resource(old)?.title).toBe('First title')

    // ⛔ A title taken as a file was kept is never replaced.
    expect(store.titleResource(kept, 'Not this')).toBe(false)
    expect(store.resource(kept)?.title).toBe('Taken as it was kept')

    // ⛔ A row that is not there is not written either.
    expect(store.titleResource('res_nobody', 'Nothing')).toBe(false)
    expect(store.resource('res_nobody')).toBeNull()
  })

  it('a row titled leaves the untitled set, and the rest stay in it', () => {
    const a = plantUntitled('a.md')
    const b = plantUntitled('b.md')
    expect(store.untitledResources(10).map((row) => row.resource)).toEqual([a, b])

    expect(store.titleResource(a, 'A')).toBe(true)
    expect(store.untitledResources(10).map((row) => row.resource)).toEqual([b])
    // ⚑ …and with every row titled the set is empty: what makes the pass run once.
    expect(store.titleResource(b, 'B')).toBe(true)
    expect(store.untitledResources(10)).toEqual([])
  })
})
