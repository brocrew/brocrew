import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

type Entry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean }
type Journal = { version: string; dialect: string; entries: Entry[] }

const journal = (): Journal =>
  JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as Journal

const skippable = (stamps: readonly number[]): readonly number[] =>
  stamps.filter((when, at) => at > 0 && when <= (stamps[at - 1] ?? 0))

describe('a stamp that skips', () => {
  let dir = ''
  let db: AppDatabase

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-stamp-'))
    db = openDatabase(join(dir, 'test.sqlite'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('the stamp exists in exactly one file', () => {
    const asData = (path: string, text: string): string =>
      path.endsWith('.sql') ? text.replace(/^\s*--.*$/gm, '') : text

    const holding = (root: string, needle: string): string[] => {
      const found: string[] = []
      const walk = (at: string): void => {
        for (const item of readdirSync(at, { withFileTypes: true })) {
          const path = join(at, item.name)
          if (item.isDirectory()) walk(path)
          else if (asData(path, readFileSync(path, 'utf8')).includes(needle))
            found.push(relative(root, path))
        }
      }
      walk(root)
      return found
    }

    it('no snapshot carries a timestamp, so there is no second copy to keep in agreement', () => {
      const entries = journal().entries
      expect(entries.length).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(holding(migrationsFolder, String(entry.when)), entry.tag).toEqual([
          join('meta', '_journal.json'),
        ])
      }
    })

    it('…and the search would have found one — the control plants a stamp in a snapshot', () => {
      const staged = join(dir, 'planted')
      mkdirSync(join(staged, 'meta'), { recursive: true })
      const head = journal().entries.at(-1)
      expect(head).toBeDefined()
      const stamp = String(head?.when)
      writeFileSync(join(staged, 'meta', '_journal.json'), JSON.stringify({ entries: [head] }))
      writeFileSync(
        join(staged, 'meta', '0032_snapshot.json'),
        JSON.stringify({ version: '6', dialect: 'sqlite', when: head?.when }),
      )
      writeFileSync(
        join(staged, '0033_planted.sql'),
        `INSERT INTO thing (created_at) VALUES (${stamp});`,
      )
      writeFileSync(join(staged, '0034_prose.sql'), `-- corrected by hand from ${stamp}\nSELECT 1;`)
      expect(holding(staged, stamp).sort()).toEqual([
        '0033_planted.sql',
        join('meta', '0032_snapshot.json'),
        join('meta', '_journal.json'),
      ])
    })
  })

  describe('the disk and the journal describe the same tree', () => {
    const disagreements = (folder: string): string[] => {
      const one = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal
      const onDisk = readdirSync(folder)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => name.slice(0, -'.sql'.length))
      const inJournal = one.entries.map((entry) => entry.tag)
      return [
        ...onDisk
          .filter((tag) => !inJournal.includes(tag))
          .map((tag) => `on disk and not in the journal: ${tag}`),
        ...inJournal
          .filter((tag) => !onDisk.includes(tag))
          .map((tag) => `in the journal and not on disk: ${tag}`),
        ...one.entries.flatMap((entry, at) =>
          entry.idx === at && entry.tag.startsWith(`${String(at).padStart(4, '0')}_`)
            ? []
            : [`entry ${String(at)} is numbered ${String(entry.idx)} and tagged ${entry.tag}`],
        ),
      ].sort()
    }

    const wholeFolder = (): string => {
      const at = join(dir, `folder-${String(readdirSync(dir).length)}`)
      mkdirSync(join(at, 'meta'), { recursive: true })
      for (const name of readdirSync(migrationsFolder).filter((one) => one.endsWith('.sql'))) {
        copyFileSync(join(migrationsFolder, name), join(at, name))
      }
      copyFileSync(
        join(migrationsFolder, 'meta', '_journal.json'),
        join(at, 'meta', '_journal.json'),
      )
      return at
    }

    const rows = (): number =>
      (db.prepare('SELECT created_at FROM __drizzle_migrations').all() as unknown[]).length

    it('every migration on disk is in the journal, and every entry in the journal is on disk', () => {
      expect(disagreements(migrationsFolder)).toEqual([])
    })

    it('…and the control is the tree the merge actually produces — two files, one entry', () => {
      const at = wholeFolder()
      const orphan = '0034_the_other_one'
      writeFileSync(join(at, `${orphan}.sql`), 'CREATE TABLE `never_reached` (`x` integer);')

      expect(disagreements(at)).toEqual([`on disk and not in the journal: ${orphan}`])

      expect(() => {
        applyMigrations(db, at)
      }).not.toThrow()
      expect(rows()).toBe(journal().entries.length)
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'never_reached'")
          .all(),
      ).toEqual([])
    })

    it('…and the other half of the same resolve: an entry whose file the merge dropped', () => {
      const at = wholeFolder()
      const head = journal().entries.at(-1)
      expect(head).toBeDefined()
      rmSync(join(at, `${String(head?.tag)}.sql`))
      expect(disagreements(at)).toEqual([`in the journal and not on disk: ${String(head?.tag)}`])
    })

    it('every stamp in the committed journal is strictly above the one before it', () => {
      const stamps = journal().entries.map((entry) => entry.when)
      expect(stamps.length).toBeGreaterThan(0)
      expect(skippable(stamps)).toEqual([])
    })

    it('…and the device can fail: a TIE is skipped, one millisecond past it is not', () => {
      expect(skippable([1_000, 3_000, 3_000])).toEqual([3_000])
      expect(skippable([1_000, 3_000, 3_001])).toEqual([])
    })
  })
})
