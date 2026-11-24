import { randomUUID } from 'node:crypto'
import {
  libraryUnavailable,
  type FilesLibraryReader,
  type FilesLibraryRequest,
  type FilesLibraryResult,
} from '../../shared/files-library'
import { committedChangesOf, type Committed } from './committed-changes'
import type { AppDatabase } from './connection'

/**
 * The tables whose writes can change a Files reading. A conversation's own row is left out: Files
 * reads only its id and identity, both written when the row is made (the session store's
 * `writeIdentityOnSession`), and its removal is a whole `deleted` change. Every ordinary append
 * rewrites that row's status.
 */
const READ_TABLES = new Set(['work', 'work_resource', 'agent_identity', 'derived_generation'])
const READ_ROWS = new Set<string>(['work_retitled', 'replaced_by'])

const changesWhatFilesRead = (change: Committed): boolean =>
  change.resync ||
  [...change.tables].some((table) => READ_TABLES.has(table)) ||
  change.rows.some((row) => READ_ROWS.has(row.rowType)) ||
  // Trimming never removes the rows Files reads.
  [...change.whole.values()].some((why) => why !== 'trimmed')

/**
 * A revision that moves when a commit on `db` changes what Files reads, or when another
 * connection commits; `null` while no fresh snapshot can be read.
 */
export function filesLibraryRevision(db: AppDatabase, canRead: () => boolean): () => string | null {
  let changes = 0
  committedChangesOf(db).listen((change) => {
    if (changesWhatFilesRead(change)) changes++
  })
  return () => {
    if (!canRead()) return null
    return `${changes}:${String(db.pragma('data_version', { simple: true }))}`
  }
}

/** Dedicated caches and native permits belong to one window in this workspace. */
export class FilesLibraryWindows {
  private readonly workspace = randomUUID()
  private readonly windows = new Map<
    string,
    { reader: FilesLibraryReader; givers: string[]; closing?: Promise<void> }
  >()
  private closed = false
  private nextAdmission = 0
  private readonly admissions = new Map<string, number>()
  constructor(private readonly start: () => FilesLibraryReader) {}

  admit(owner: string): number {
    const ticket = ++this.nextAdmission
    this.admissions.set(owner, ticket)
    return ticket
  }
  isCurrent(owner: string, ticket: number): boolean {
    return !this.closed && this.admissions.get(owner) === ticket
  }

  async read(
    owner: string,
    request: FilesLibraryRequest,
    revision: string,
    givers?: readonly string[],
  ): Promise<FilesLibraryResult> {
    if (this.closed) return libraryUnavailable('closed')
    let window = this.windows.get(owner)
    if (window?.closing !== undefined) {
      await window.closing
      if (this.closed) return libraryUnavailable('closed')
      window = this.windows.get(owner)
    }
    if (window === undefined) {
      window = { reader: this.start(), givers: [] }
      this.windows.set(owner, window)
    }
    if (request.operation === 'query') window.givers = [...(givers ?? [])]
    return window.reader.read(request, {
      workspace: this.workspace,
      givers: [...window.givers],
      hostRevision: revision,
    })
  }
  async closeWindow(owner: string): Promise<void> {
    const window = this.windows.get(owner)
    if (window?.closing !== undefined) {
      await window.closing
      return
    }
    const admission = this.admit(owner)
    if (window === undefined) {
      this.admissions.delete(owner)
      return
    }
    window.closing ??= window.reader.close().finally(() => {
      if (this.windows.get(owner) === window) this.windows.delete(owner)
      if (this.admissions.get(owner) === admission) this.admissions.delete(owner)
    })
    await window.closing
  }
  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.windows.keys()].map((owner) => this.closeWindow(owner)))
  }
}
