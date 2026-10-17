import type Database from 'better-sqlite3'

type Fence = <T>(write: () => T) => T
const fences = new WeakMap<Database.Database, Fence>()

export function setWindowWriteFence(db: Database.Database, fence: Fence): void {
  fences.set(db, fence)
}

/** A synchronous bulk write is fenced once instead of updating every watcher per row. */
export function withWindowWriteFence<T>(db: Database.Database, write: () => T): T {
  const fence = fences.get(db)
  return fence === undefined ? write() : fence(write)
}
