import type { AppDatabase } from '../../db/connection'

export function sqliteStarredConversations(db: AppDatabase) {
  const setStarredLibraryId = db.transaction(
    (libraryId: string, starred: boolean, previousId?: string): boolean => {
      const remove = db.prepare('DELETE FROM starred_conversation WHERE library_id = ?')
      const changed = starred
        ? db
            .prepare('INSERT OR IGNORE INTO starred_conversation (library_id) VALUES (?)')
            .run(libraryId)
        : remove.run(libraryId)
      const previous = previousId === undefined ? 0 : remove.run(previousId).changes
      return changed.changes + previous > 0
    },
  )

  return {
    starredLibraryIds(): ReadonlySet<string> {
      const rows = db
        .prepare<[], { library_id: string }>('SELECT library_id FROM starred_conversation')
        .all()
      return new Set(rows.map(({ library_id }) => library_id))
    },
    setStarredLibraryId,
  }
}
