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

/**
 * The stamps that would be SKIPPED — each one at or below its predecessor — in list order.
 *
 * ⚑ **One derivation, called by the row that reads the committed journal and by the row that proves
 * the device can go red**, so the control is trapped the way the subject is.
 */
const skippable = (stamps: readonly number[]): readonly number[] =>
  stamps.filter((when, at) => at > 0 && when <= (stamps[at - 1] ?? 0))

/**
 * 🔴 **522 · the failure a monotonic journal is only a PROXY for** — from `516` F3.
 *
 * ## ⛔ What is actually being prevented
 *
 * `drizzle-orm`'s SQLite dialect takes the single newest row of `__drizzle_migrations`
 * (`ORDER BY created_at DESC LIMIT 1`) and runs a migration only while
 * `Number(lastDbMigration[2]) < migration.folderMillis`, where `folderMillis` **is** the journal's
 * `when`. ⛔ **So a migration stamped at or below that row is skipped, in a transaction that
 * commits, with no error and nothing in any log.** ⚑ `scripts/db-generate.mjs` is the repair, and
 * `scripts/test/db-generate.test.mjs` measures its arithmetic.
 *
 * ## ⚑ D-016 · one migration, and what that left this file
 *
 * The folder now holds `0000_the_tree.sql` and a journal of ONE entry. ⛔ **There is no database one
 * migration behind**, so §2 (the upgrade path, derived from the journal's last pair) went with the
 * history it measured. ⚑ What stays is what is true of the folder AS IT IS and of every migration a
 * person adds to it: the stamp lives in exactly one file (§1, the fact `scripts/db-generate.mjs` Q3
 * cites), the disk and the journal describe the same tree (§3), and every stamp in the journal is
 * strictly above the one before it (§3's census). ⚠️ **That census is not history**: the journal,
 * drizzle's `created_at < folderMillis` skip rule and the next migration all still exist, and
 * `refuseIfSkippable` runs only when somebody generates — so it is the one guard `ci` has on the
 * next stamp. With one entry it passes on the committed journal by construction, which is why its
 * device control stays beside it.
 *
 * ## 🔴 §3 · the second way a migration goes missing, added by `533` relay 1
 *
 * ⛔ **`532` and `533` branched from one base and both generated `0034`.** `522`'s wrapper stamps
 * `max(now, previous + 1)` and **is deterministic**, so two dispatches reading the same last entry
 * are handed the same number *and the same stamp*. ⚠️ **The two `.sql` files have different names,
 * so git merges BOTH of them in with no conflict at all** — only `meta/_journal.json` collides, and
 * a careless resolve keeps one entry beside two files.
 *
 * 🔴 **What that leaves is a migration ON DISK that no longer exists as far as anything is
 * concerned.** `applyMigrations` walks the JOURNAL and copies `${entry.tag}.sql`, which makes a file
 * with no entry invisible to it. ⚠️ **So §3 measures the FOLDER against the journal**, and its
 * control stages exactly the tree the merge produces.
 */
describe('522 · a stamp that skips', () => {
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · where the number lives, asked as a search rather than answered from one file
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the stamp exists in exactly one file', () => {
    /**
     * ⛔ **A `--` line in a `.sql` file is prose and is stripped first.**
     * `a-source-census-must-strip-prose-before-it-asserts` — and it fired here before the strip
     * existed: the old `0023_dazzling_kree.sql`'s header quoted `0022`'s stamp while explaining that
     * `383` had to correct it by hand, which is a dispatch's reasoning and not a second copy of the
     * number (`0000_the_tree.sql` carries a hand-written `--` header too). ⚠️ The strip is narrow —
     * a stamp inside a statement is still found, and the control below plants one to prove it.
     */
    const asData = (path: string, text: string): string =>
      path.endsWith('.sql') ? text.replace(/^\s*--.*$/gm, '') : text

    /** Every file under `root`, relative, that holds `needle` as data. */
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

    it('🔴 no snapshot carries a timestamp, so there is no second copy to keep in agreement', () => {
      // ⛔ **Q3, as a search over EVERY stamp and EVERY file** rather than a look at one snapshot
      // (`a-negative-is-only-as-strong-as-the-search-shape`). `meta/<n>_snapshot.json` holds
      // `version`, `dialect`, a UUID `id`, its predecessor's `prevId` and the schema — and if that
      // ever stops being true, `scripts/db-generate.mjs` is writing half of an answer.
      const entries = journal().entries
      // ⚑ D-016: ONE entry, `0000_the_tree` — the search is non-vacuous as long as it has a stamp.
      expect(entries.length).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(holding(migrationsFolder, String(entry.when)), entry.tag).toEqual([
          join('meta', '_journal.json'),
        ])
      }
    })

    it('⚑ …and the search would have found one — the control plants a stamp in a snapshot', () => {
      // ⛔ **A negative needs a shape that could have answered differently** (standing rule 4).
      // The planted copy is put where a real one would be — inside a snapshot, as a number — and
      // the same call reports both files.
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
      // ⚑ **TWO plants, not one** (standing rule 12), and the second is the one that guards the
      // prose strip: a stamp inside a STATEMENT is data, is found, and is not what the header of
      // `0023` contains. The third file plants it in a `--` line and must NOT be reported.
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the folder read against the journal, which is the direction a merge breaks
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the disk and the journal describe the same tree', () => {
    /**
     * Where a folder and its journal disagree, **as a list of sentences rather than a boolean**, so
     * a failure names the file instead of reporting `false`.
     *
     * ⚠️ **Three disagreements and not one**, because the merge can leave any of them: a `.sql` with
     * no entry (the one `532`/`533` actually produced), an entry whose file was dropped by the
     * resolve instead, and an entry whose number no longer matches its own tag — which is what a
     * hand-renumbered file looks like, and the reason `533` regenerated rather than renaming.
     */
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

    /** A copy of the WHOLE real folder — every `.sql` and the journal verbatim — for planting into. */
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

    it('🔴 every migration on disk is in the journal, and every entry in the journal is on disk', () => {
      expect(disagreements(migrationsFolder)).toEqual([])
    })

    it('⛔ …and the control is the tree the merge actually produces — two files, one entry', () => {
      // ⚑ **The plant is a `CREATE TABLE`**, so the claim below is not about bookkeeping: the
      // statement either reached the database or it did not, and `sqlite_master` is asked.
      const at = wholeFolder()
      const orphan = '0034_the_other_one'
      writeFileSync(join(at, `${orphan}.sql`), 'CREATE TABLE `never_reached` (`x` integer);')

      expect(disagreements(at)).toEqual([`on disk and not in the journal: ${orphan}`])

      // 🔴 **It does not throw, and nothing anywhere says a migration was left behind.**
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

    it('⚑ …and the other half of the same resolve: an entry whose file the merge dropped', () => {
      const at = wholeFolder()
      const head = journal().entries.at(-1)
      expect(head).toBeDefined()
      rmSync(join(at, `${String(head?.tag)}.sql`))
      expect(disagreements(at)).toEqual([`in the journal and not on disk: ${String(head?.tag)}`])
    })

    /**
     * ⛔ **The WHOLE journal and not its last pair.** A tie anywhere in the list skips that migration
     * on exactly the databases that stopped at the entry before it, and `scripts/db-generate.mjs`'s
     * `refuseIfSkippable` only runs when somebody GENERATES — never in `ci`, and never over a
     * journal that two branches merged.
     */
    it('🔴 every stamp in the committed journal is strictly above the one before it', () => {
      const stamps = journal().entries.map((entry) => entry.when)
      // ⚑ D-016: ONE entry, `0000_the_tree` — the census guards the NEXT migration a person adds.
      expect(stamps.length).toBeGreaterThan(0)
      expect(skippable(stamps)).toEqual([])
    })

    it('⚑ …and the device can fail: a TIE is skipped, one millisecond past it is not', () => {
      // ⚠️ **A tie and not a smaller number**: drizzle's `<` is strict, so equality is the weakest
      // input that still skips, and an instrument that only caught *lower* would miss it.
      expect(skippable([1_000, 3_000, 3_000])).toEqual([3_000])
      expect(skippable([1_000, 3_000, 3_001])).toEqual([])
    })
  })
})
