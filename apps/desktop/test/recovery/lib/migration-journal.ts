import { readFileSync } from 'node:fs'
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
