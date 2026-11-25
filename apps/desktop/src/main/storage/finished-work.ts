import Database from 'better-sqlite3'
import { createSessionStore } from '../db/session-store'
import { TASK_IS_OPEN } from '../../shared/tasks'
import type { PieceRow } from '../../shared/task-contracts'
import {
  FINISHED_WORK_NAME,
  type StorageDirectory,
  type StorageFinishedWork,
} from '../../shared/storage'

/**
 * The worker folders, among `names`, that nothing open uses any more: the piece each is named after
 * has ended, no conversation that has not ended works inside it, and no open piece names it as its
 * folder. Each comes with that piece's label and title. Folders and conversations are matched by
 * the folder's own name as a path part, so every spelling of the same folder counts.
 */
export function finishedWorkIn(
  file: string,
  names: readonly string[],
  progressed: () => void = () => {},
): Map<string, StorageFinishedWork> {
  const finished = new Map<string, StorageFinishedWork>()
  const candidates = names.filter((name) => FINISHED_WORK_NAME.test(name))
  if (candidates.length === 0) return finished
  // A read-only reader rarely meets a lock under WAL; when it does it answers busy or unavailable
  // after 1 s and is asked again, rather than holding a worker behind the writer.
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
  try {
    db.pragma('query_only = ON')
    const store = createSessionStore(db)
    const owned = new Map<string, readonly PieceRow[]>()
    const piecesOf = (owner: string): readonly PieceRow[] => {
      let pieces = owned.get(owner)
      if (pieces === undefined) {
        pieces = store.piecesOwnedBy(owner)
        owned.set(owner, pieces)
      }
      return pieces
    }
    const isOpen = (piece: string, owner: string): boolean =>
      piecesOf(owner).some((row) => row.piece === piece && TASK_IS_OPEN[row.state])
    const isPartOf = (path: string, name: string): boolean => path.split(/[\\/]/u).includes(name)
    const working = store.recorded().filter((session) => session.status !== 'ended')
    const naming = db.prepare(
      'SELECT id, owner_session_id AS owner FROM work WHERE instr(folder, ?) > 0',
    )
    for (const name of candidates) {
      progressed()
      const work = store.workById(name)
      const piece = work && piecesOf(work.owner).find((row) => row.piece === name)
      if (!piece || TASK_IS_OPEN[piece.state]) continue
      if (working.some((session) => isPartOf(session.cwd, name))) continue
      const named = naming.all(name) as { id: string; owner: string }[]
      if (named.some((row) => isOpen(row.id, row.owner))) continue
      finished.set(name, { label: piece.label, title: piece.title })
    }
  } finally {
    db.close()
  }
  return finished
}

/** Agent output's own folders, each marked when it is finished work. */
export function withFinishedWork(
  directory: StorageDirectory,
  file: string,
  progressed: () => void,
): StorageDirectory {
  const folders = directory.entries.filter((entry) => entry.isDirectory && !entry.isLink)
  const finished = finishedWorkIn(
    file,
    folders.map((entry) => entry.name),
    progressed,
  )
  return {
    ...directory,
    entries: directory.entries.map((entry) => {
      const work = entry.isLink ? undefined : finished.get(entry.name)
      return work ? { ...entry, finished: work } : entry
    }),
  }
}
