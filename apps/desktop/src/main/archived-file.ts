import { join } from 'node:path'
import type { AppDatabase } from './db/connection'
import { importSideFile, objectIn } from './db/side-file-import'

/** The file older builds kept the archived set in, imported once into `archived_conversation`. */
export const ARCHIVED_FILE = 'archived.json'

export interface ArchivedConversations {
  /** Whether `id` is archived. */
  has(id: string): boolean
  /** Every archived id. */
  ids(): ReadonlySet<string>
  /** When `id` was archived, epoch ms, or null. */
  archivedAt(id: string): number | null
  /** Archives `ids` at `at`, and keeps it. Throws, changing nothing, when it cannot be kept. */
  add(ids: readonly string[], at: number): void
  /** Takes `ids` out of the set, and keeps it. Throws, changing nothing, when it cannot be kept. */
  remove(ids: readonly string[]): void
}

const INSERT =
  'INSERT OR IGNORE INTO archived_conversation (conversation_id, archived_at) VALUES (?, ?)'

/** The archived set kept in `database`, read once; this process is its only writer. */
export function archivedConversationsIn(database: AppDatabase): ArchivedConversations {
  const rows = database
    .prepare('SELECT conversation_id AS id, archived_at AS at FROM archived_conversation')
    .all() as { id: string; at: number }[]
  const insert = database.prepare(INSERT)
  const remove = database.prepare('DELETE FROM archived_conversation WHERE conversation_id = ?')
  return keptIn(
    new Map(rows.map(({ id, at }) => [id, at])),
    database.transaction((ids: readonly string[], at: number) => {
      for (const id of ids) insert.run(id, at)
    }),
    database.transaction((ids: readonly string[]) => {
      for (const id of ids) remove.run(id)
    }),
  )
}

/** An archived set kept nowhere: what a host made without a database starts with. */
export function archivedInMemory(): ArchivedConversations {
  return keptIn(
    new Map(),
    () => undefined,
    () => undefined,
  )
}

/** Imports `archived.json` (`{version, archived: {id: {at}}}`) from `userData`, once. */
export function importArchivedFile(database: AppDatabase, userData: string): void {
  importSideFile(database, join(userData, ARCHIVED_FILE), (said) => {
    const insert = database.prepare(INSERT)
    for (const [id, entry] of Object.entries(objectIn(objectIn(said)['archived']))) {
      const at = objectIn(entry)['at']
      if (typeof at === 'number' && Number.isFinite(at)) insert.run(id, at)
    }
  })
}

function keptIn(
  archived: Map<string, number>,
  add: (ids: readonly string[], at: number) => void,
  remove: (ids: readonly string[]) => void,
): ArchivedConversations {
  return {
    has: (id) => archived.has(id),
    ids: () => new Set(archived.keys()),
    archivedAt: (id) => archived.get(id) ?? null,
    add(ids, at) {
      add(ids, at)
      for (const id of ids) if (!archived.has(id)) archived.set(id, at)
    },
    remove(ids) {
      remove(ids)
      for (const id of ids) archived.delete(id)
    },
  }
}
