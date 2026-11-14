import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATIONS_FOLDER = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/main/db/migrations',
)

interface JournalEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

export const MIGRATION_JOURNAL = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] }
export const BUILD_LINEAGE: readonly number[] = MIGRATION_JOURNAL.entries.map((entry) => entry.when)

export function firstMigrationsIn(root: string, count: number): string {
  const folder = join(root, 'migrations')
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true })
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...MIGRATION_JOURNAL, entries: MIGRATION_JOURNAL.entries.slice(0, count) }),
  )
  return folder
}

export function failingMigrationsIn(root: string, later: number): string {
  const folder = join(root, 'migrations')
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true })
  const tag = '0099_fails'
  writeFileSync(join(folder, `${tag}.sql`), 'CREATE TABLE fails (;\n')
  const entry = {
    idx: MIGRATION_JOURNAL.entries.length,
    version: '6',
    when: later,
    tag,
    breakpoints: true,
  }
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...MIGRATION_JOURNAL, entries: [...MIGRATION_JOURNAL.entries, entry] }),
  )
  return folder
}
