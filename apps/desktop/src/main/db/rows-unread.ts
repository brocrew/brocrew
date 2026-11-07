export interface RowsUnread {
  in(sessionId: string): SkipNote
  readonly count: number
  readonly ledgersSkipped: number
}

export const THE_WHOLE_LEDGER = 'the-whole-ledger'
export type SkipNote = (ordinal: number | typeof THE_WHOLE_LEDGER) => void

export function rowsUnreadOnce(): RowsUnread {
  const seen = new Set<string>()
  const skipped = new Set<string>()
  return {
    // Separate the ledger id and ordinal so distinct rows cannot share a key.
    in: (sessionId) => (ordinal) => {
      if (ordinal === THE_WHOLE_LEDGER) {
        skipped.add(sessionId)
        return
      }
      seen.add(`${sessionId}\u0000${String(ordinal)}`)
    },
    get count() {
      return seen.size
    },
    get ledgersSkipped() {
      return skipped.size
    },
  }
}
