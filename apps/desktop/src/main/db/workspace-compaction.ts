import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { closeDatabase } from './close-database'

export interface CompactionFacts {
  readonly bytes: number
  readonly keptBytes: number
  readonly neededBytes: number
  readonly eligible: boolean
}

export function inspectCompaction(file: string): CompactionFacts | null {
  if (!existsSync(file)) return null
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 0 })
  try {
    const size = Number(db.pragma('page_size', { simple: true }))
    const pages = Number(db.pragma('page_count', { simple: true }))
    const free = Number(db.pragma('freelist_count', { simple: true }))
    const keptBytes = (pages - free) * size
    return {
      bytes: pages * size,
      keptBytes,
      neededBytes: Math.ceil(keptBytes * 1.1) + 64 * 1024 * 1024,
      eligible: free * 2 > pages,
    }
  } finally {
    db.close()
  }
}

/** The app has not opened its database yet. This worker never installs its output. */
export function writeCompactedWorkspace(file: string, output: string): void {
  const db = new Database(file, { fileMustExist: true, timeout: 0 })
  try {
    const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
    if (checkpoint?.busy !== 0) throw new Error('The workspace database is still in use.')
    db.pragma('synchronous = FULL')
    db.pragma('auto_vacuum = INCREMENTAL')
    db.prepare('VACUUM INTO ?').run(output)
  } finally {
    try {
      closeDatabase(db)
    } finally {
      if (db.open) db.close()
    }
  }
  const compacted = new Database(output, { readonly: true, fileMustExist: true, timeout: 0 })
  try {
    if (Number(compacted.pragma('auto_vacuum', { simple: true })) !== 2)
      throw new Error('The smaller database does not support incremental compaction.')
  } finally {
    compacted.close()
  }
}
