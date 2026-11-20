import { derivePieces } from '../../shared/tasks'
import type { PieceFold } from '../../shared/piece-fold'
import type { PieceRow } from '../../shared/task-contracts'
import type { EventRow } from './ledger-row-types'
import type { SkipNote } from './rows-unread'
import { persistedEventsFrom } from './stored-event-codec'

/** Read the exclusive turn cut and the present from one ordered ledger iterator. */
export function piecesAtTheCutAndNow(
  owner: string,
  rows: Iterable<EventRow>,
  before: number,
  options: Parameters<typeof derivePieces>[2],
  noteSkip: SkipNote,
  atTheCut: (pieces: readonly PieceRow[] | null) => void,
): readonly PieceRow[] {
  const cursor = rows[Symbol.iterator]()
  let next: IteratorResult<EventRow>
  let complete = true
  const skipped: SkipNote = (ordinal, cause) => {
    complete = false
    noteSkip(ordinal, cause)
  }
  function* through(bound: number): IterableIterator<EventRow> {
    while (!next.done && next.value.ordinal < bound) {
      const row = next.value
      yield row
      next = cursor.next()
    }
  }
  try {
    next = cursor.next()
    let from: PieceFold | undefined
    const earlier = derivePieces(owner, persistedEventsFrom(through(before), skipped), {
      ...options,
      keep: (fold) => {
        from = fold
      },
    })
    atTheCut(complete ? earlier : null)
    return derivePieces(owner, persistedEventsFrom(through(Number.POSITIVE_INFINITY), skipped), {
      ...options,
      from,
    })
  } finally {
    cursor.return?.()
  }
}
