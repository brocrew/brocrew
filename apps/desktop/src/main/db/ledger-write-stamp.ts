import { resolve } from 'node:path'
import type { AppDatabase } from './connection'

export interface LedgerWriteStamp {
  readonly ordinal: number | null
  readonly generation: number
}

type LedgerWrites = Map<string, LedgerWriteStamp>
const connections = new WeakMap<AppDatabase, LedgerWrites>()
const files = new Map<string, WeakRef<LedgerWrites>>()
const released = new FinalizationRegistry<{ file: string; ref: WeakRef<LedgerWrites> }>(
  ({ file, ref }) => {
    if (files.get(file) === ref) files.delete(file)
  },
)

/** Main-process stores on one file share write invalidations, without polling SQLite. */
export function ledgerWritesFor(db: AppDatabase): LedgerWrites {
  const known = connections.get(db)
  if (known !== undefined) return known
  const file =
    typeof db.name !== 'string' || db.name === '' || db.name === ':memory:'
      ? null
      : resolve(db.name)
  let writes = file === null ? undefined : files.get(file)?.deref()
  if (writes === undefined) {
    writes = new Map()
    if (file !== null) {
      const ref = new WeakRef(writes)
      files.set(file, ref)
      released.register(writes, { file, ref })
    }
  }
  connections.set(db, writes)
  return writes
}
