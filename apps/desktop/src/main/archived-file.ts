import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The conversations a person archived, kept in `<userData>/archived.json` beside the database.
 *
 * A file rather than a column, so archiving needs no change to the database; and rather than a row
 * in each ledger, so a start reads one small file instead of scanning every ledger for the set. Its
 * ids name rows of the database, so a restore of an older database brings back the set that matches
 * it (`recovery/state-files.ts`).
 *
 * A file this build cannot read (another version, or not readable) is left as it is: nothing reads
 * as archived, and nothing is archived or restored until it can be read again, so a set nobody saw
 * is never written over.
 */

export const ARCHIVED_FILE = 'archived.json'

/** The shape this build writes, and the only one it reads. */
export const ARCHIVED_FILE_VERSION = 1

export interface ArchivedConversations {
  /** Whether `id` is archived. */
  has(id: string): boolean
  /** Every archived id. */
  ids(): ReadonlySet<string>
  /** When `id` was archived, epoch ms, or null. */
  archivedAt(id: string): number | null
  /** Archives `ids` at `at`, and keeps it. Throws, changing nothing, when it cannot be kept. */
  add(ids: readonly string[], at: number): void
  /** Takes `ids` out of the set, and keeps it. Throws, changing nothing, when it cannot be kept. */
  remove(ids: readonly string[]): void
}

export function archivedFilePath(userData: string): string {
  return join(userData, ARCHIVED_FILE)
}

/**
 * The archived set kept in `userData`, read now; a file that could not be read is read again before
 * a change, so one moved aside or repaired is taken up without a restart.
 */
export function archivedConversationsIn(userData: string): ArchivedConversations {
  const file = archivedFilePath(userData)
  let read = readArchived(file)
  return keptIn(
    read.kind === 'set' ? read.archived : new Map(),
    (current) => {
      if (read.kind === 'set') return current
      read = readArchived(file)
      if (read.kind === 'set') return read.archived
      throw new Error(
        `BroCrew can’t read its list of archived conversations (${ARCHIVED_FILE} in its data ` +
          `folder: ${read.why}), so it changed nothing. Move that file out of the data folder, ` +
          'then try again: the conversations it listed show in your lists again, and can be ' +
          'archived again.',
      )
    },
    (next) => {
      try {
        writeWhole(file, `${JSON.stringify(fileText(next), null, 2)}\n`)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'an error'
        throw new Error(
          `BroCrew couldn’t save its list of archived conversations (${ARCHIVED_FILE} in its data ` +
            `folder: ${code}), so it changed nothing. Check that BroCrew may write to its data ` +
            'folder, then try again.',
          { cause: error },
        )
      }
    },
  )
}

/** An archived set kept nowhere: what a host made without a data folder starts with. */
export function archivedInMemory(): ArchivedConversations {
  return keptIn(
    new Map(),
    (current) => current,
    () => undefined,
  )
}

type Read =
  | { readonly kind: 'set'; readonly archived: Map<string, number> }
  | { readonly kind: 'unreadable'; readonly why: string }

function readArchived(file: string): Read {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { kind: 'set', archived: new Map() }
    return { kind: 'unreadable', why: code ?? 'it could not be read' }
  }
  let said: unknown
  try {
    said = JSON.parse(text)
  } catch {
    return { kind: 'unreadable', why: 'it is not JSON' }
  }
  const record = typeof said === 'object' && said !== null ? (said as Record<string, unknown>) : {}
  if (record['version'] !== ARCHIVED_FILE_VERSION) {
    return { kind: 'unreadable', why: 'another version of BroCrew wrote it' }
  }
  const archived = new Map<string, number>()
  const entries = record['archived']
  if (typeof entries === 'object' && entries !== null) {
    for (const [id, entry] of Object.entries(entries as Record<string, unknown>)) {
      const at = typeof entry === 'object' && entry !== null ? (entry as { at?: unknown }).at : null
      if (typeof at === 'number' && Number.isFinite(at)) archived.set(id, at)
    }
  }
  return { kind: 'set', archived }
}

function fileText(archived: ReadonlyMap<string, number>): unknown {
  return {
    version: ARCHIVED_FILE_VERSION,
    archived: Object.fromEntries([...archived].map(([id, at]) => [id, { at }])),
  }
}

/**
 * A set that `readable` hands the set to change from, or throws for, and `keep` keeps; a change
 * that either throws for is not made.
 */
function keptIn(
  start: Map<string, number>,
  readable: (current: ReadonlyMap<string, number>) => ReadonlyMap<string, number>,
  keep: (next: ReadonlyMap<string, number>) => void,
): ArchivedConversations {
  let archived = start
  const change = (edit: (next: Map<string, number>) => void): void => {
    const next = new Map(readable(archived))
    edit(next)
    keep(next)
    archived = next
  }
  return {
    has: (id) => archived.has(id),
    ids: () => new Set(archived.keys()),
    archivedAt: (id) => archived.get(id) ?? null,
    add(ids, at) {
      change((next) => {
        for (const id of ids) if (!next.has(id)) next.set(id, at)
      })
    },
    remove(ids) {
      change((next) => {
        for (const id of ids) next.delete(id)
      })
    },
  }
}

/** Writes `content` whole: through a temporary file renamed over it, readable by this user only. */
function writeWhole(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, content, { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
