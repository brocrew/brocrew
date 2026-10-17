import { providerSchema } from '@brobot2/shared'
import Database from 'better-sqlite3'
import { MAX_CAPABILITY_COUNT } from '../../shared/capabilities'
import { pieceCalled, pieceLine } from '../../shared/piece-called'
import type { HistoryConversation, HistoryEvent, HistoryReader } from '../../shared/recovery'
import { agentName } from '../../shared/runtime-ipc'
import { PIECE_EVENT_TYPES } from '../../shared/tasks'
import { toPersistedEvents, type EventRow } from '../db/session-store'
import { errorCode, nodeFs, pathExists, type RecoveryFs } from './files'
import { SIDECARS } from './layout'

/**
 * Reads the conversations and transcripts of a restored copy of a workspace's database, for the
 * recovery window, without writing to the file or beside it.
 *
 * It opens the file read-only and runs SELECTs only. A read-only connection still creates `-wal`
 * and `-shm` beside a database in WAL mode, and cannot read one with a `-wal` or `-journal` beside
 * it without recovering it, so only a rollback-mode file with neither is opened, as a checkpoint's
 * copy is. Any other file is refused, unopened.
 *
 * Events are decoded by the session store's own row decoder, so each row reads here as it reads in
 * the main window: bounded the same way, and skipped the same way when it cannot be parsed. The
 * store itself is never constructed.
 */

export interface HistoryReaderOptions {
  readonly fs?: RecoveryFs
}

/** A {@link HistoryReader} over one file, and the connection it holds once it has read. */
export interface ClosableHistoryReader extends HistoryReader {
  /** The folder a conversation worked in, for the paths its messages wrote; `null` for none. */
  workingFolder(id: string): Promise<string | null>
  /**
   * Closes the connection. Reads after it are refused rather than reopening the file, so the file
   * can be moved once this returns. Closing again does nothing.
   */
  close(): void
}

/** The sidecars that hold data the main file does not; `-shm` is only an index of a `-wal`. */
const DATA_SIDECARS = SIDECARS.filter((suffix) => suffix !== '-shm')
const HEADER_BYTES = 100
const SQLITE_MAGIC = 'SQLite format 3\u0000'
const CLOSED = 'the history reader is closed'

/**
 * The longest chain of pieces walked up to spell a label. No piece is given deeper than the widest
 * depth a person may grant below a root, so a longer chain is a database edited by hand.
 */
const MAX_PIECE_DEPTH = MAX_CAPABILITY_COUNT + 2

/** The piece event types, as the partial index over them lists them. */
const PIECE_TYPES_SQL = PIECE_EVENT_TYPES.map((type) => `'${type}'`).join(', ')

interface ConversationRow {
  readonly id: string
  readonly provider: string
  readonly profile_id: string | null
  readonly adopted_at: number | null
  readonly restored_at: number | null
  readonly created_at: number
  readonly updated_at: number
  readonly display_name: string | null
}

interface PieceRow {
  readonly id: string
  readonly parent_id: string | null
  readonly number: number
  readonly title: string | null
}

interface Connection {
  readonly db: Database.Database
  readonly conversations: Database.Statement
  readonly generation: Database.Statement
  readonly cwd: Database.Statement
  readonly events: Database.Statement
  readonly root: Database.Statement
  readonly newestHeld: Database.Statement
  readonly piece: Database.Statement
  readonly newestRetitle: Database.Statement
}

/**
 * A reader over `file`. Nothing is opened until the first read, which checks the file and opens
 * it; a read that fails is refused and the next one checks again.
 */
export function createHistoryReader(
  file: string,
  options: HistoryReaderOptions = {},
): ClosableHistoryReader {
  const fs = options.fs ?? nodeFs
  let closed = false
  let connection: Connection | null = null
  let opening: Promise<Connection> | null = null

  const open = (): Promise<Connection> => {
    opening ??= (async () => {
      await mayBeReadInPlace(file, fs)
      if (closed) throw new Error(CLOSED)
      connection = connect(file)
      return connection
    })().catch((error: unknown) => {
      opening = null
      throw error
    })
    return opening
  }

  const read = async <T>(work: (connection: Connection) => T): Promise<T> => {
    if (closed) throw new Error(CLOSED)
    const opened = await open()
    if (closed) throw new Error(CLOSED)
    return work(opened)
  }

  return {
    conversations: () =>
      read((c) =>
        (c.conversations.all() as ConversationRow[]).flatMap((row): HistoryConversation[] => {
          // The column's CHECK admits only the providers this build knows.
          const provider = providerSchema.safeParse(row.provider).data
          if (provider === undefined) return []
          return [
            {
              id: row.id,
              title: titleOf(c, row.id),
              agent: agentOf(row),
              provider,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          ]
        }),
      ),
    transcript: (id) =>
      read((c) =>
        toPersistedEvents(c.events.all(id, activeGeneration(c, id)) as EventRow[]).map(
          ({ event, at }): HistoryEvent => ({ event, at }),
        ),
      ),
    workingFolder: (id) =>
      read((c) => {
        const row = c.cwd.get(id) as { cwd: unknown } | undefined
        return typeof row?.cwd === 'string' && row.cwd !== '' ? row.cwd : null
      }),
    close: () => {
      closed = true
      connection?.db.close()
      connection = null
    },
  }
}

/**
 * Refuses a file that SQLite could not read without writing to it or beside it: one that is not a
 * database, one in WAL mode, or one with a `-wal` or `-journal` beside it.
 */
async function mayBeReadInPlace(file: string, fs: RecoveryFs): Promise<void> {
  const stats = await fs.stat(file).catch((error: unknown) => {
    if (errorCode(error) !== 'ENOENT') throw error
    throw new Error(`there is no database at ${file}`, { cause: error })
  })
  if (!stats.isFile()) throw new Error(`${file} is not a file`)
  const header = await headerOf(file, fs)
  if (header === null || Buffer.from(header.subarray(0, 16)).toString('latin1') !== SQLITE_MAGIC) {
    throw new Error(`${file} is not a database`)
  }
  // Bytes 18 and 19 are 1 in rollback-journal mode and 2 in WAL mode.
  if (header[18] !== 1 || header[19] !== 1) {
    throw new Error(
      `${file} is not in rollback-journal mode, and reading it could write files beside it`,
    )
  }
  for (const suffix of DATA_SIDECARS) {
    if (await pathExists(`${file}${suffix}`, fs)) {
      throw new Error(`${file} has a ${suffix} file beside it, and reading it would change it`)
    }
  }
}

async function headerOf(file: string, fs: RecoveryFs): Promise<Uint8Array | null> {
  const header = new Uint8Array(HEADER_BYTES)
  const handle = await fs.open(file, 'r')
  try {
    let filled = 0
    while (filled < HEADER_BYTES) {
      const { bytesRead } = await handle.read(header, filled, HEADER_BYTES - filled, filled)
      if (bytesRead === 0) return null
      filled += bytesRead
    }
    return header
  } finally {
    await handle.close()
  }
}

function connect(file: string): Connection {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return {
      db,
      // Newest activity first, then the id, so two rows touched in one millisecond cannot swap.
      conversations: db.prepare(
        `SELECT s.id, s.provider, s.profile_id, s.adopted_at, s.restored_at, s.created_at,
                s.updated_at, identity.display_name
           FROM provider_session s
           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id
          ORDER BY s.updated_at DESC, s.id DESC`,
      ),
      // A ledger rebuilt from its provider's file is read in the generation it was switched to;
      // every other ledger has only generation 0.
      generation: db.prepare('SELECT active FROM derived_generation WHERE session_id = ?'),
      cwd: db.prepare('SELECT cwd FROM provider_session WHERE id = ?'),
      events: db.prepare(
        `SELECT ordinal, payload, created_at FROM events
          WHERE session_id = ? AND generation = ? ORDER BY ordinal`,
      ),
      root: db.prepare(
        `SELECT id, parent_id, number, title FROM work
          WHERE parent_id IS NULL AND owner_session_id = ?`,
      ),
      newestHeld: db.prepare(
        `SELECT id, parent_id, number, title FROM work
          WHERE owner_session_id = ? AND parent_id IS NOT NULL
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      ),
      piece: db.prepare('SELECT id, parent_id, number, title FROM work WHERE id = ?'),
      // The piece types are listed beside the one asked for so SQLite reads the owner's piece rows
      // through their partial index, newest first, rather than the whole ledger; `+generation`
      // keeps the unique index out of the choice. A payload that is not JSON names no piece.
      newestRetitle: db.prepare(
        `SELECT payload FROM events
          WHERE session_id = ? AND +generation = ?
            AND type IN (${PIECE_TYPES_SQL})
            AND type = 'work_retitled'
            AND CASE WHEN json_valid(payload) THEN json_extract(payload, '$.piece') END = ?
          ORDER BY ordinal DESC
          LIMIT 1`,
      ),
    }
  } catch (error) {
    db.close()
    throw error
  }
}

function activeGeneration(c: Connection, conversation: string): number {
  return (c.generation.get(conversation) as { active: number } | undefined)?.active ?? 0
}

/**
 * Who is in a conversation, as the main window names them: its identity's chosen name, else the
 * app's name for that identity. `null` for one this app ran as nobody (found in a person's own
 * provider folder, or restored from a bundle), which the window names by its provider instead.
 */
function agentOf(row: ConversationRow): string | null {
  const ranAsNobody =
    row.restored_at !== null || (row.adopted_at !== null && row.profile_id === null)
  if (ranAsNobody) return null
  return row.display_name ?? agentName(row.profile_id, null)
}

/**
 * The line the main window's list names a conversation by, `W1 · Bakery website`: the root it
 * owns, else the newest piece it holds, each with the title it stands under now. `null` when it
 * owns and holds none.
 *
 * The main window folds a conversation's record to prefer an open piece over one that ended and to
 * add how many more it holds; this reads no record, so it names the newest piece and adds nothing.
 */
function titleOf(c: Connection, conversation: string): string | null {
  const titled = (piece: PieceRow, numbers: readonly number[]): string =>
    pieceLine(pieceCalled(numbers), titleNow(c, conversation, piece))
  const root = c.root.get(conversation) as PieceRow | undefined
  if (root !== undefined) return titled(root, [root.number])
  const held = c.newestHeld.get(conversation) as PieceRow | undefined
  if (held === undefined) return null
  const numbers = numbersOf(c, held)
  return numbers === null ? null : titled(held, numbers)
}

/**
 * The title a piece stands under now: the title its newest `work_retitled` says, else its title as
 * given, which is `null` for a root nobody has titled. A piece's retitles are written in its
 * owner's ledger, in that ledger's active generation.
 */
function titleNow(c: Connection, owner: string, piece: PieceRow): string | null {
  const row = c.newestRetitle.get(owner, activeGeneration(c, owner), piece.id) as
    { payload: string } | undefined
  if (row === undefined) return piece.title
  const said = JSON.parse(row.payload) as { title?: unknown }
  return typeof said.title === 'string' ? said.title : piece.title
}

/**
 * The numbers a piece's label spells, from its root down, or `null` when its chain of parents does
 * not reach a root.
 */
function numbersOf(c: Connection, piece: PieceRow): number[] | null {
  const numbers = [piece.number]
  let parent = piece.parent_id
  for (let depth = 0; parent !== null; depth += 1) {
    if (depth >= MAX_PIECE_DEPTH) return null
    const above = c.piece.get(parent) as PieceRow | undefined
    if (above === undefined) return null
    numbers.unshift(above.number)
    parent = above.parent_id
  }
  return numbers
}
