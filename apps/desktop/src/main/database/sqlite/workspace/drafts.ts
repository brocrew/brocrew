import { join } from 'node:path'
import type { SavedDrafts } from '../../../../shared/saved-drafts'
import type { AppDatabase } from '../../../db/connection'
import type { DraftStorage } from '../../drafts'
import { importSideFile, objectIn } from './side-file-import'

/** The file older builds kept the drafts in, imported once into `draft`. */
export const SAVED_DRAFTS_FILE = 'drafts.json'

/** The kept drafts as one book (`{ version, drafts }`), for `saved-drafts.ts` to read. */
function savedDraftsBook(database: AppDatabase): unknown {
  const rows = database.prepare('SELECT entry FROM draft ORDER BY rowid').all() as {
    entry: string
  }[]
  return { version: 1, drafts: rows.map(({ entry }) => JSON.parse(entry) as unknown) }
}

/** Imports `drafts.json` from `userData` once, each entry with a slot kept as it was written. */
export function importDraftsFile(database: AppDatabase, userData: string): void {
  importSideFile(database, join(userData, SAVED_DRAFTS_FILE), (said) => {
    const insert = database.prepare('INSERT OR IGNORE INTO draft (slot, entry) VALUES (?, ?)')
    const listed = objectIn(said)['drafts']
    for (const entry of Array.isArray(listed) ? listed : []) {
      const slot = objectIn(entry)['slot']
      if (typeof slot === 'string') insert.run(slot, JSON.stringify(entry))
    }
  })
}

export function createSqliteDraftStorage(database: AppDatabase): DraftStorage {
  const keep = (packet: SavedDrafts): void => {
    const was = database.prepare('SELECT entry FROM draft WHERE slot = ?')
    const upsert = database.prepare(
      'INSERT INTO draft (slot, entry) VALUES (?, ?) ON CONFLICT(slot) DO UPDATE SET entry = excluded.entry',
    )
    const remove = database.prepare('DELETE FROM draft WHERE slot = ?')
    database.transaction(() => {
      for (const slot of packet.cleared ?? []) remove.run(slot)
      for (const draft of packet.drafts) {
        const row = was.get(draft.slot) as { entry: string } | undefined
        const entry = row === undefined ? {} : objectIn(JSON.parse(row.entry))
        upsert.run(draft.slot, JSON.stringify({ ...entry, ...draft }))
      }
    })()
  }

  return {
    get open() {
      return database.open
    },
    read: () => savedDraftsBook(database),
    async persist(packet) {
      if (!database.open) return 'closed'
      keep(packet)
      return 'saved'
    },
  }
}
