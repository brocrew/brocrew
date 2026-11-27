import type { AppDatabase } from './db/connection'
import type { CloseMemoryJournal } from './runtime/agent-memory'

/** The root can stop startup before a journal or Host has been returned. */
export function createMemoryJournalLifetime(currentDatabase: () => AppDatabase | null) {
  let closing = false
  let close: CloseMemoryJournal | undefined
  const assertStarting = (database: AppDatabase): void => {
    if (closing || database !== currentDatabase())
      throw new Error('The workspace database is closing')
  }
  return {
    get closing() {
      return closing
    },
    assertStarting,
    stopAdmission(): void {
      closing = true
    },
    acquire(database: AppDatabase, closeJournal: CloseMemoryJournal): void {
      assertStarting(database)
      close = closeJournal
    },
    async stop(step: () => Promise<void>): Promise<void> {
      closing = true
      try {
        await step()
      } finally {
        await close?.()
      }
    },
  }
}
