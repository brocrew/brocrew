import Database from 'better-sqlite3'
import type { AppDatabase } from './connection'
import { rowsUnreadOnce, type SessionStore } from './session-store'
import { conversationLink, pieceLink } from '../../shared/links'
import { aPersonsOwnWords } from '../../shared/a-persons-own-words'
import { theMessagesOf, type UserTurnEvent } from '../../shared/runtime-ipc'
import {
  pastWorkSearchQuery,
  type PastWorkField,
  type PastWorkHit,
  type PastWorkSearchResult,
  type PastWorkSource,
} from '../../shared/past-work-search'

const CELL_LIMIT = 1024 * 1024
const DOCUMENT_LIMIT = 1_000_000
const PROFILE_LIMIT = 1
export const PAST_WORK_MESSAGE_LIMIT = 4096
type Source = { id: string; updated_at: number; version: number }
type Document = {
  conversation: string
  piece: string | null
  field: PastWorkField
  snippet: string
}
type Index = { db: Database.Database; versions: Map<string, number> }
const searches = new WeakMap<AppDatabase, ProfilePastWorkSearch>()

export function searchPastWork(
  db: AppDatabase,
  store: SessionStore,
  caller: string,
  words: string,
  revision?: PastWorkSource,
): PastWorkSearchResult {
  if (db.inTransaction) return { ok: false, reason: 'unavailable' }
  try {
    let search = searches.get(db)
    if (search === undefined) {
      search = new ProfilePastWorkSearch(db)
      searches.set(db, search)
    }
    return search.read(store, caller, words, revision)
  } catch {
    closePastWorkSearch(db)
    return { ok: false, reason: 'unavailable' }
  }
}

export function pastWorkSource(db: AppDatabase, caller: string): PastWorkSource | null {
  if (db.inTransaction || db.name === ':memory:') return null
  try {
    let search = searches.get(db)
    if (search === undefined) {
      search = new ProfilePastWorkSearch(db)
      searches.set(db, search)
    }
    return search.sourceRevision(caller)
  } catch {
    return null
  }
}

export function closePastWorkSearch(db: AppDatabase): void {
  searches.get(db)?.close()
  searches.delete(db)
}

class ProfilePastWorkSearch {
  private readonly profiles = new Map<string, Index>()
  private dataVersion: unknown

  constructor(private readonly source: AppDatabase) {
    source.exec(
      'CREATE TEMP TABLE IF NOT EXISTS past_work_dirty (session TEXT PRIMARY KEY, version INTEGER NOT NULL)',
    )
    const mark = (
      session: string,
    ) => `INSERT INTO past_work_dirty(session, version) SELECT ${session}, 1 WHERE ${session} IS NOT NULL
      ON CONFLICT(session) DO UPDATE SET version = version + 1;`
    for (const [table, column] of [
      ['provider_session', 'id'],
      ['events', 'session_id'],
      ['work', 'owner_session_id'],
      ['work_resource', 'added_by_session_id'],
      ['derived_generation', 'session_id'],
    ]) {
      source.exec(`CREATE TEMP TRIGGER IF NOT EXISTS past_work_${table}_insert AFTER INSERT ON main.${table}
        BEGIN ${mark(`NEW.${column}`)} END;
        CREATE TEMP TRIGGER IF NOT EXISTS past_work_${table}_delete AFTER DELETE ON main.${table}
        BEGIN ${mark(`OLD.${column}`)} END;
        CREATE TEMP TRIGGER IF NOT EXISTS past_work_${table}_update AFTER UPDATE ON main.${table}
        BEGIN ${mark(`OLD.${column}`)} ${mark(`NEW.${column}`)} END;`)
    }
  }

  close(): void {
    for (const index of this.profiles.values()) index.db.close()
    this.profiles.clear()
  }

  sourceRevision(caller: string): PastWorkSource | null {
    const profile = this.source
      .prepare('SELECT agent_identity_id AS profile FROM provider_session WHERE id = ?')
      .get(caller) as { profile: string | null } | undefined
    if (!profile?.profile) return null
    const rows = this.source
      .prepare(
        `SELECT s.id, coalesce(d.version, 0) AS version
      FROM provider_session s LEFT JOIN temp.past_work_dirty d ON d.session = s.id
      WHERE s.agent_identity_id = ? LIMIT 10001`,
      )
      .all(profile.profile) as { id: string; version: number }[]
    if (rows.length > 10000) return null
    return {
      file: this.source.name,
      profile: profile.profile,
      externalVersion: Number(this.source.pragma('data_version', { simple: true })),
      versions: rows.map((row) => [row.id, row.version] as const),
    }
  }

  read(
    store: SessionStore,
    caller: string,
    words: string,
    revision?: PastWorkSource,
  ): PastWorkSearchResult {
    const query = pastWorkSearchQuery.safeParse({ words })
    if (!query.success) return { ok: false, reason: 'invalid' }
    const match = query.data.words
      .split(/\s+/u)
      .map((word) => `"${word.replaceAll('"', '""')}"`)
      .join(' AND ')
    const db = this.source
    db.exec('BEGIN')
    try {
      const callerRow = db
        .prepare('SELECT agent_identity_id AS profile FROM provider_session WHERE id = ?')
        .get(caller) as { profile: string | null } | undefined
      if (!callerRow?.profile) throw new Error('no recorded profile')
      if (revision !== undefined && revision.profile !== callerRow.profile)
        throw new Error('profile changed')
      const version = revision?.externalVersion ?? db.pragma('data_version', { simple: true })
      if (version !== this.dataVersion) this.close()
      this.dataVersion = version
      const profile = callerRow.profile
      let index = this.profiles.get(profile)
      if (index === undefined) {
        if (this.profiles.size >= PROFILE_LIMIT) {
          const oldest = this.profiles.keys().next().value!
          this.profiles.get(oldest)!.db.close()
          this.profiles.delete(oldest)
        }
        const memory = new Database(':memory:')
        try {
          memory.pragma('max_page_count = 65536')
          memory.exec(`CREATE VIRTUAL TABLE documents USING fts5(conversation UNINDEXED, piece UNINDEXED, field UNINDEXED, text);
            CREATE TABLE document_sources(document INTEGER PRIMARY KEY, conversation TEXT NOT NULL);
            CREATE INDEX document_sources_conversation ON document_sources(conversation);`)
        } catch (error) {
          memory.close()
          throw error
        }
        index = { db: memory, versions: new Map() }
      }
      this.profiles.delete(profile)
      this.profiles.set(profile, index)
      const sessions = db
        .prepare(
          `SELECT s.id, s.updated_at, coalesce(d.version, 0) AS version
        FROM provider_session s LEFT JOIN temp.past_work_dirty d ON d.session = s.id
        WHERE s.agent_identity_id = ?`,
        )
        .all(profile) as Source[]
      if (revision !== undefined) {
        const versions = new Map(revision.versions)
        for (const session of sessions) session.version = versions.get(session.id) ?? -1
      }
      const current = new Set(sessions.map((session) => session.id))
      const next = new Map(index.versions)
      index.db.transaction(() => {
        const remove = index.db.prepare(
          'DELETE FROM documents WHERE rowid IN (SELECT document FROM document_sources WHERE conversation = ?)',
        )
        const removeSources = index.db.prepare(
          'DELETE FROM document_sources WHERE conversation = ?',
        )
        for (const previous of next.keys()) {
          if (!current.has(previous)) {
            remove.run(previous)
            removeSources.run(previous)
            next.delete(previous)
          }
        }
        for (const session of sessions) {
          if (next.get(session.id) === session.version) continue
          if (next.has(session.id)) {
            remove.run(session.id)
            removeSources.run(session.id)
          }
          this.indexConversation(index!, store, session)
          next.set(session.id, session.version)
        }
        if (
          (index!.db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number }).n >
          DOCUMENT_LIMIT
        )
          throw new Error('past-work index is too large')
      })()
      const hits: PastWorkHit[] = []
      const seen = new Set<string>()
      const results = index.db
        .prepare(
          `SELECT conversation, piece, field,
        snippet(documents, 3, '[', ']', ' … ', 24) AS snippet
        FROM documents WHERE documents MATCH ? ORDER BY rank`,
        )
        .iterate(match)
      for (const value of results) {
        const doc = value as Document
        const key = doc.piece ?? doc.conversation
        if (seen.has(key)) continue
        seen.add(key)
        const live = db
          .prepare(
            'SELECT status, updated_at FROM provider_session WHERE id = ? AND agent_identity_id = ?',
          )
          .get(doc.conversation, profile) as { status: string; updated_at: number } | undefined
        if (live === undefined) continue
        const work = doc.piece === null ? null : store.workById(doc.piece)
        if (doc.piece !== null && (work === null || work.owner !== doc.conversation)) continue
        const unread = rowsUnreadOnce()
        const piece =
          work?.parent === null || work === null
            ? undefined
            : store
                .piecesWithTheirWaits(doc.conversation, unread)
                .find((one) => one.piece === doc.piece)
        if (
          unread.count ||
          unread.ledgersSkipped ||
          (work !== null && work.parent !== null && piece === undefined)
        )
          throw new Error('unread work')
        const root = work?.parent === null ? store.turnBlockRootLines(work.piece) : null
        if (work?.parent === null && root === null) throw new Error('unread root')
        const title = (root?.title ?? piece?.title ?? null)?.slice(0, 200) ?? null
        const label = work?.label ?? doc.conversation
        hits.push({
          conversation: doc.conversation,
          piece: doc.piece,
          label,
          title,
          link:
            work === null
              ? conversationLink(doc.conversation, label)
              : pieceLink(work.piece, label, title ?? ''),
          state: piece?.state ?? live.status,
          last_active: new Date(live.updated_at).toISOString(),
          archived: false,
          matched_field: doc.field,
          snippet: doc.snippet.slice(0, 320),
        })
        if (hits.length === 5) break
      }
      db.exec('COMMIT')
      index.versions = next
      return { ok: true, hits }
    } catch (error) {
      if (db.inTransaction) db.exec('ROLLBACK')
      this.close()
      throw error
    }
  }

  private indexConversation(index: Index, store: SessionStore, session: Source): void {
    const insert = index.db.prepare(
      'INSERT INTO documents(conversation, piece, field, text) VALUES (?, ?, ?, ?)',
    )
    const source = index.db.prepare(
      'INSERT INTO document_sources(document, conversation) VALUES (?, ?)',
    )
    let documents = 0
    const add = (piece: string | null, field: PastWorkField, text: unknown) => {
      if (text === null || text === undefined || text === '') return
      if (typeof text !== 'string' || text.length > CELL_LIMIT || ++documents > DOCUMENT_LIMIT)
        throw new Error('unread past-work field')
      const written = insert.run(session.id, piece, field, text)
      source.run(written.lastInsertRowid, session.id)
    }
    const rows = this.source
      .prepare('SELECT id, parent_id FROM work WHERE owner_session_id = ?')
      .all(session.id) as { id: string; parent_id: string | null }[]
    const unread = rowsUnreadOnce()
    const pieces = rows.some((row) => row.parent_id !== null)
      ? store.piecesOwnedBy(session.id, unread)
      : []
    const byPiece = new Map(pieces.map((piece) => [piece.piece, piece]))
    if (unread.count || unread.ledgersSkipped) throw new Error('unread pieces')
    const root = rows.find((row) => row.parent_id === null)
    const conversationPiece = root?.id ?? pieces[0]?.piece ?? null
    const buffers = new Map<PastWorkField, { parts: string[]; length: number }>()
    const collect = (field: PastWorkField, value: unknown) => {
      if (typeof value !== 'string') {
        add(conversationPiece, field, value)
        return
      }
      const text = value.slice(0, PAST_WORK_MESSAGE_LIMIT)
      let buffer = buffers.get(field)
      if (buffer === undefined) {
        buffer = { parts: [], length: 0 }
        buffers.set(field, buffer)
      }
      if (buffer.length + text.length + 1 > 65536) {
        add(conversationPiece, field, buffer.parts.join('\n'))
        buffer.parts = []
        buffer.length = 0
      }
      buffer.parts.push(text)
      buffer.length += text.length + 1
    }
    for (const row of rows) {
      const piece = byPiece.get(row.id)
      const lines = row.parent_id === null ? store.turnBlockRootLines(row.id) : null
      if (row.parent_id === null ? lines === null : piece === undefined)
        throw new Error('unread piece')
      add(row.id, 'title', lines?.title ?? piece?.title)
      add(
        row.id,
        'done condition',
        row.parent_id === null ? store.rootDoneCondition(row.id) : piece?.definitionOfDone,
      )
      add(row.id, 'result', piece?.summary)
      add(row.id, 'status', (lines?.statusLine ?? piece?.statusLine)?.text)
    }
    const events = this.source
      .prepare(
        `SELECT type, substr(payload, 1, ?) AS payload FROM events
      WHERE session_id = ? AND generation = ? AND type IN ('user_turn', 'assistant_message') ORDER BY ordinal`,
      )
      .iterate(CELL_LIMIT + 1, session.id, store.theActiveGeneration(session.id))
    for (const value of events) {
      const event = value as { type: string; payload: string }
      if (event.payload.length > CELL_LIMIT) throw new Error('past-work text is too large')
      const text: unknown = JSON.parse(event.payload)
      if (typeof text !== 'object' || text === null) throw new Error('unread conversation text')
      const message = text as Record<string, unknown>
      if (event.type === 'assistant_message') {
        if (message.parentToolCallId == null) collect('agent reply', message.text)
      } else {
        for (const part of theMessagesOf(message as unknown as UserTurnEvent)) {
          if (aPersonsOwnWords(part) || part.attribution === 'provider_transcript')
            collect('person message', part.text)
        }
      }
    }
    for (const [field, buffer] of buffers) add(conversationPiece, field, buffer.parts.join('\n'))
    const resources = this.source
      .prepare(
        `SELECT r.work_id, r.name, w.owner_session_id FROM work_resource r
      JOIN work w ON w.id = r.work_id WHERE r.added_by_session_id = ? AND r.role = 'made'`,
      )
      .iterate(session.id)
    for (const value of resources) {
      const resource = value as { work_id: string; name: string; owner_session_id: string }
      add(
        resource.owner_session_id === session.id ? resource.work_id : conversationPiece,
        'made-file name',
        resource.name,
      )
    }
  }
}
