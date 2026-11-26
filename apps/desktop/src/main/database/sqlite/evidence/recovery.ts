import Database from 'better-sqlite3'
import { observeDatabaseMemory } from '../../../database-memory'
import { gzipCheckpoint, type PlainDatabaseFacts } from '../../../recovery/checkpoint-compression'
import { CheckpointFailed, checkFreeSpace } from '../../../recovery/checkpoint-space'
import type { Migration } from '../../../recovery/contract'
import type { VerifyCopy } from '../../../recovery/copy-check'
import {
  migrationsRecordedIn,
  sameMigrations,
  type MigrationsOnDisk,
} from '../../../recovery/database-facts'
import { nodeFs, type RecoveryFs } from '../../../recovery/files'

interface DatabaseSnapshotPlan {
  readonly bytes: number
  copyTo(copy: string): Promise<PlainDatabaseFacts & { migrations: readonly Migration[] }>
}

export function prepareDatabaseSnapshot(
  file: string,
  options: {
    readonly fs?: RecoveryFs
    readonly signal?: AbortSignal
    readonly expectedMigrations?: readonly Migration[]
    readonly userData: string
    readonly freeBytes: (path: string) => number | null
    readonly verifySource?: VerifyCopy
  },
): DatabaseSnapshotPlan {
  const fs = options.fs ?? nodeFs
  const verifySource = options.verifySource
  const readonlySource = new Database(file, { readonly: true, fileMustExist: true })
  observeDatabaseMemory(readonlySource, 'recovery-source')
  let bytes: number
  let wasWal: boolean
  try {
    bytes =
      Number(readonlySource.pragma('page_count', { simple: true })) *
      Number(readonlySource.pragma('page_size', { simple: true }))
    wasWal = String(readonlySource.pragma('journal_mode', { simple: true })) === 'wal'
  } finally {
    readonlySource.close()
  }
  return {
    bytes,
    copyTo: async (copy) => {
      options.signal?.throwIfAborted()
      const checked = await verifySource?.(file, true)
      if (checked?.kind === 'damaged')
        throw new CheckpointFailed(
          `The live database did not pass SQLite's own check (${checked.check}).`,
          false,
        )
      if (checked?.kind === 'failed') throw new Error(checked.message)
      try {
        const source = new Database(file, { fileMustExist: true })
        observeDatabaseMemory(source, 'recovery-source')
        let recorded: MigrationsOnDisk
        try {
          if (String(source.pragma('journal_mode = DELETE', { simple: true })) !== 'delete')
            throw new Error(
              'The live database must be closed before its recovery copy is compressed.',
            )
          recorded = migrationsRecordedIn(source)
        } finally {
          source.close()
        }
        if (recorded.kind !== 'recorded')
          throw new Error('The live database has no readable migration record.')
        if (
          options.expectedMigrations &&
          !sameMigrations(recorded.migrations, options.expectedMigrations)
        )
          throw new Error('The live database does not record the migrations admitted at startup.')
        checkFreeSpace(options.userData, bytes, options.freeBytes)
        const plain = await gzipCheckpoint(file, copy, fs, options.signal)
        if (plain.bytes !== bytes)
          throw new Error(
            'The closed database changed size while its recovery copy was compressed.',
          )
        return { ...plain, migrations: recorded.migrations }
      } finally {
        if (wasWal) {
          const source = new Database(file, { fileMustExist: true })
          observeDatabaseMemory(source, 'recovery-source')
          try {
            source.pragma('journal_mode = WAL')
          } finally {
            source.close()
          }
        }
      }
    },
  }
}
