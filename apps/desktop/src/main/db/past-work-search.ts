import { observeDatabaseMemory } from '../database-memory'
import type { UserTurnEvent } from '../../shared/human-answer-contracts'
import Database from 'better-sqlite3'
import type { AppDatabase } from './connection'
import type { WorkLedgerRead } from './work-ledger-read'
import { agentIdentityRowId } from './identity'
import { describeConversationForRead } from './conversation-address'
import { rowsUnreadOnce } from './rows-unread'
import { conversationLink, pieceLink } from '../../shared/links'
import { aPersonsOwnWords } from '../../shared/a-persons-own-words'
import { theMessagesOf } from '../../shared/runtime-ipc'
import { WORK_SEARCH_BOUNDS } from '../../shared/work-search'
import {
  pastWorkNext,
  type PastWorkAfter,
  type PastWorkPosition,
  pastWorkRecentNext,
  type PastWorkRecentPoint,
  pastWorkStart,
  pastWorkSearchQuery,
  type PastWorkField,
  type PastWorkHit,
  type PastWorkSearchResult,
  type PastWorkSource,
  type PastWorkTranscriptScope,
} from '../../shared/past-work-search'

const CELL_LIMIT = 1024 * 1024
const DOCUMENT_LIMIT = 1_000_000
const CAPACITY_BATCH = 256
const PROFILE_LIMIT = 1
const PAST_WORK_MESSAGE_LIMIT = 4096
const MIXED_RANK_HEAD = 1024
const RECENT_INDEX_MS = 4_000
const PREVIEW_DEADLINE = Symbol('past-work preview deadline')
type Source = PastWorkRecentPoint & { version: number }
type Document = {
  rowid: number
  conversation: string
  piece: string | null
  field: PastWorkField
  turn_id: string | null
  recorded_at: number | null
  generation: number | null
  ordinal: number | null
}
type Recording = { turnId: string | null; at: number; generation: number; ordinal: number }
type SearchReads = WorkLedgerRead & Parameters<typeof describeConversationForRead>[0]
type Index = {
  db: Database.Database
  versions: Map<string, { version: number | null; count: number }>
}
type IndexedPage = {
  versions: Index['versions']
  nextPage: PastWorkAfter
  scanned: Map<string, PastWorkRecentPoint>
  recentAfter: PastWorkRecentPoint | null
  moreRecent: boolean
  completedConversations: number
}
const searches = new WeakMap<AppDatabase, ProfilePastWorkSearch>()

function indexIsFull(error: unknown): boolean {
  return error instanceof Database.SqliteError && error.code === 'SQLITE_FULL'
}

export function searchPastWork(
  db: AppDatabase,
  store: SearchReads,
  caller: string,
  words: string,
  revision?: PastWorkSource,
  profile?: string,
  cursor?: string,
  transcript?: PastWorkTranscriptScope,
): PastWorkSearchResult {
  if (db.inTransaction) return { ok: false, reason: 'unavailable' }
  try {
    let search = searches.get(db)
    if (search === undefined) {
      search = new ProfilePastWorkSearch(db)
      searches.set(db, search)
    }
    return search.read(store, caller, words, revision, profile, cursor, transcript)
  } catch {
    closePastWorkSearch(db)
    return { ok: false, reason: 'unavailable' }
  }
}

export function pastWorkSource(
  db: AppDatabase,
  caller: string,
  profile?: string,
  after?: PastWorkAfter,
  recent?: PastWorkSource['recent'],
): PastWorkSource | null {
  if (db.inTransaction || db.name === ':memory:') return null
  try {
    let search = searches.get(db)
    if (search === undefined) {
      search = new ProfilePastWorkSearch(db)
      searches.set(db, search)
    }
    return search.sourceRevision(caller, profile, after, recent)
  } catch {
    return null
  }
}

export function closePastWorkSearch(db: AppDatabase): void {
  searches.get(db)?.close()
  searches.delete(db)
}

export class ProfilePastWorkSearch {
  private readonly profiles = new Map<string | null, Index>()
  private dataVersion: unknown

  constructor(
    private readonly source: AppDatabase,
    private readonly documentLimit = DOCUMENT_LIMIT,
  ) {
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

  private sessionPage(
    profile: string | null,
    after: PastWorkAfter,
    recent?: PastWorkSource['recent'],
  ) {
    const partial = typeof after === 'object' && after !== null ? after : undefined
    const resume = recent?.after?.position === undefined ? undefined : recent.after
    const seek =
      recent === undefined
        ? `s.id ${partial === undefined ? '>' : '>='} @after`
        : '(@at IS NULL OR (s.updated_at, s.id) < (@at, @after))'
    const order = recent === undefined ? 's.id' : 's.updated_at DESC, s.id DESC'

    const rows = this.source
      .prepare(
        `SELECT s.id, s.updated_at AS at, coalesce(d.version, 0) AS version
        FROM provider_session s LEFT JOIN temp.past_work_dirty d ON d.session = s.id
        WHERE ${seek} ${resume === undefined ? '' : 'AND s.id <> @after'}
        ${profile === null ? '' : 'AND s.agent_identity_id = @profile'}
        ORDER BY ${order} LIMIT @limit`,
      )
      .all({
        after: recent?.after?.id ?? partial?.id ?? (typeof after === 'string' ? after : ''),
        at: recent?.after?.at ?? null,
        profile,
        limit: WORK_SEARCH_BOUNDS.candidates + 1,
      }) as Source[]
    if (resume !== undefined) {
      const resumed = this.source
        .prepare(
          `SELECT s.id, @at AS at, coalesce(d.version, 0) AS version
        FROM provider_session s LEFT JOIN temp.past_work_dirty d ON d.session = s.id
        WHERE s.id = @id ${profile === null ? '' : 'AND s.agent_identity_id = @profile'}`,
        )
        .get({ id: resume.id, at: resume.at, profile }) as Source | undefined
      if (resumed !== undefined) rows.unshift(resumed)
    }
    const sessions = rows.slice(0, WORK_SEARCH_BOUNDS.candidates)
    return {
      sessions,
      next: rows.length > sessions.length ? (sessions.at(-1)?.id ?? null) : null,
    }
  }

  sourceRevision(
    caller: string,
    profile?: string,
    after: PastWorkAfter = null,
    recent?: PastWorkSource['recent'],
  ): PastWorkSource | null {
    if (!this.source.prepare('SELECT 1 FROM provider_session WHERE id = ?').get(caller)) return null
    const identity = profile === undefined ? null : agentIdentityRowId(profile)
    const { sessions, next } = this.sessionPage(identity, after, recent)
    return {
      file: this.source.name,
      profile: identity,
      externalVersion: Number(this.source.pragma('data_version', { simple: true })),
      versions: sessions.map((row) =>
        recent === undefined
          ? ([row.id, row.version] as const)
          : ([row.id, row.version, row.at] as const),
      ),
      next,
      ...(typeof after === 'object' && after !== null ? { partial: after } : {}),
      ...(recent === undefined ? {} : { recent }),
    }
  }

  read(
    store: SearchReads,
    caller: string,
    words: string,
    revision?: PastWorkSource,
    chosenProfile?: string,
    cursor?: string,
    chosenTranscript?: PastWorkTranscriptScope,
  ): PastWorkSearchResult {
    const transcript = revision?.transcript ?? chosenTranscript
    const query = pastWorkSearchQuery.safeParse({
      words,
      profile: chosenProfile,
      cursor,
      ...(transcript === undefined ? {} : { in: 'transcripts', ...transcript }),
    })
    if (!query.success) return { ok: false, reason: 'invalid' }
    const wanted = query.data.profile
    const profile =
      revision === undefined
        ? wanted === undefined
          ? null
          : agentIdentityRowId(wanted)
        : revision.profile
    const after = pastWorkStart(query.data.words, profile, cursor, transcript)
    if (after === undefined) return { ok: false, reason: 'invalid' }
    const match = query.data.words
      .split(/\s+/u)
      .map((word) => `"${word.replaceAll('"', '""')}"`)
      .join(' AND ')
    const db = this.source
    db.exec('BEGIN')
    try {
      if (!db.prepare('SELECT 1 FROM provider_session WHERE id = ?').get(caller))
        throw new Error('no recorded conversation')
      const version = revision?.externalVersion ?? db.pragma('data_version', { simple: true })
      if (version !== this.dataVersion) this.close()
      this.dataVersion = version
      let index = this.indexFor(profile)
      const recent = revision?.recent
      const stopAt = recent?.preview === true ? performance.now() + RECENT_INDEX_MS : Infinity
      const page =
        revision === undefined
          ? this.sessionPage(profile, after)
          : {
              next: revision.next,
              sessions: db
                .prepare(
                  `
          SELECT s.id, coalesce(json_extract(page.value, '$[2]'), s.updated_at) AS at,
            json_extract(page.value, '$[1]') AS version
          FROM json_each(@versions) page
          JOIN provider_session s ON s.id = json_extract(page.value, '$[0]')
          WHERE (@profile IS NULL OR s.agent_identity_id = @profile)
          ${recent === undefined ? '' : 'ORDER BY page.key'}
        `,
                )
                .all({ versions: JSON.stringify(revision.versions), profile }) as Source[],
            }
      const { sessions } = page
      const resume =
        recent?.after?.position !== undefined
          ? { id: recent.after.id, position: recent.after.position }
          : (revision?.partial ?? (typeof after === 'object' && after !== null ? after : undefined))
      const current = new Set(sessions.map((session) => session.id))
      const fill = (searchIndex: Index, recoverCapacity: boolean): IndexedPage => {
        let nextPage: PastWorkAfter = page.next
        const scanned = new Map<string, PastWorkRecentPoint>()
        let recentAfter: PastWorkRecentPoint | null = recent?.after ?? null
        let moreRecent = recent !== undefined && page.next !== null
        let completedConversations = 0
        const versions = new Map(searchIndex.versions)
        const write = () => {
          const remove = searchIndex.db.prepare(
            'DELETE FROM documents WHERE rowid IN (SELECT document FROM document_sources WHERE conversation = ?)',
          )
          const removeSources = searchIndex.db.prepare(
            'DELETE FROM document_sources WHERE conversation = ?',
          )
          for (const previous of versions.keys()) {
            if (!current.has(previous)) {
              remove.run(previous)
              removeSources.run(previous)
              versions.delete(previous)
            }
          }
          let remaining = this.documentLimit
          const refresh = (session: Source) => {
            const position = resume?.id === session.id ? resume.position : undefined
            const cached = versions.get(session.id)
            if (
              position === undefined &&
              cached?.version === session.version &&
              cached.count <= remaining
            )
              return { count: cached.count }
            if (cached !== undefined) {
              remove.run(session.id)
              removeSources.run(session.id)
            }
            return recoverCapacity
              ? this.indexConversationInBatches(
                  searchIndex,
                  store,
                  session,
                  stopAt,
                  remaining,
                  position,
                )
              : this.indexConversation(searchIndex, store, session, stopAt, remaining, position)
          }
          const refreshPreview = searchIndex.db.transaction(refresh)
          const processed = new Set<string>()
          for (const session of sessions) {
            if (recent?.preview === true && performance.now() >= stopAt) {
              moreRecent = true
              break
            }
            try {
              const { count, position } =
                recent?.preview === true && !recoverCapacity
                  ? refreshPreview(session)
                  : refresh(session)
              remaining -= count
              processed.add(session.id)
              versions.set(session.id, {
                version:
                  position === undefined && resume?.id !== session.id ? session.version : null,
                count,
              })
              if (recent !== undefined) {
                recentAfter = { id: session.id, at: session.at }
                scanned.set(session.id, recentAfter)
              }
              if (position !== undefined) {
                nextPage = { id: session.id, position }
                if (recentAfter !== null) recentAfter = { ...recentAfter, position }
                moreRecent = true
                break
              }
              completedConversations++
            } catch (error) {
              if (error !== PREVIEW_DEADLINE) throw error
              moreRecent = true
              break
            }
          }
          for (const previous of versions.keys()) {
            if (!processed.has(previous)) {
              remove.run(previous)
              removeSources.run(previous)
              versions.delete(previous)
            }
          }
        }
        if (recoverCapacity) write()
        else searchIndex.db.transaction(write)()
        return { versions, nextPage, scanned, recentAfter, moreRecent, completedConversations }
      }
      const fillWithinCapacity = () => {
        try {
          const filled = fill(index, false)
          return { ...filled, recoveredCapacity: false }
        } catch (error) {
          if (!indexIsFull(error)) throw error
          // SQLITE_FULL can discard the whole FTS transaction. Rebuild the same
          // source snapshot with independently committed batches.
          this.close()
          index = this.indexFor(profile)
          return { ...fill(index, true), recoveredCapacity: true }
        }
      }
      const filled = fillWithinCapacity()
      let { nextPage, recentAfter, moreRecent } = filled
      const { scanned } = filled
      const hits: (Omit<PastWorkHit, 'snippet'> & { rowid: number })[] = []
      const seen = new Set<string>()
      const fields =
        'documents.rowid, conversation, piece, field, turn_id, recorded_at, generation, ordinal'
      const matching = `SELECT ${fields} FROM documents WHERE documents MATCH @match`
      const indexDb = index.db
      function* matchingDocuments(): Generator<Document> {
        if (recent !== undefined) {
          yield* indexDb
            .prepare(
              `WITH recent AS MATERIALIZED (SELECT key, value FROM json_each(@scanned))
              SELECT ${fields} FROM documents JOIN recent ON recent.value = conversation
              WHERE documents MATCH @match AND recorded_at BETWEEN @from AND @to
              ORDER BY recent.key, rank, ordinal DESC`,
            )
            .iterate({
              match,
              scanned: JSON.stringify([...scanned.keys()]),
              from:
                transcript?.from === undefined
                  ? Number.MIN_SAFE_INTEGER
                  : Date.parse(transcript.from),
              to:
                transcript?.to === undefined
                  ? Number.MAX_SAFE_INTEGER
                  : Date.parse(transcript.to) + 86_399_999,
            }) as Iterable<Document>
          return
        }
        if (transcript !== undefined) {
          yield* indexDb
            .prepare(
              `${matching} AND recorded_at BETWEEN @from AND @to
                ORDER BY conversation, rank, ordinal DESC`,
            )
            .iterate({
              match,
              from:
                transcript.from === undefined
                  ? Number.MIN_SAFE_INTEGER
                  : Date.parse(transcript.from),
              to:
                transcript.to === undefined
                  ? Number.MAX_SAFE_INTEGER
                  : Date.parse(transcript.to) + 86_399_999,
            }) as Iterable<Document>
          return
        }
        // An ordinary LIMIT on FTS rank still sorts every match. The scalar form
        // lets SQLite retain only the best rows, with FTS row order for tied ranks.
        const head = indexDb
          .prepare(`${matching} ORDER BY rank + 0, rowid LIMIT @limit`)
          .all({ match, limit: MIXED_RANK_HEAD }) as Document[]
        yield* head
        if (head.length === MIXED_RANK_HEAD) {
          // Many messages can belong to one conversation. Continue past the head
          // when it did not yield five distinct live results.
          yield* indexDb
            .prepare(`${matching} ORDER BY rank`)
            .iterate({ match }) as Iterable<Document>
        }
      }
      for (const doc of matchingDocuments()) {
        const pieceId = transcript === undefined ? doc.piece : null
        const key = pieceId ?? doc.conversation
        if (seen.has(key)) continue
        seen.add(key)
        const live = db
          .prepare(
            'SELECT status, updated_at FROM provider_session WHERE id = @id AND (@profile IS NULL OR agent_identity_id = @profile)',
          )
          .get({ id: doc.conversation, profile }) as
          { status: string; updated_at: number } | undefined
        if (live === undefined) continue
        if (transcript !== undefined && hits.length === 5) {
          nextPage = hits[4]!.conversation
          if (recent !== undefined) {
            recentAfter = scanned.get(nextPage)!
            moreRecent = true
          }
          break
        }
        const work = pieceId === null ? null : store.workById(pieceId)
        if (pieceId !== null && (work === null || work.owner !== doc.conversation)) continue
        const unread = rowsUnreadOnce()
        const piece =
          work?.parent === null || work === null
            ? undefined
            : store
                .piecesWithTheirWaits(doc.conversation, unread)
                .find((one) => one.piece === pieceId)
        if (
          unread.count ||
          unread.ledgersSkipped ||
          (work !== null && work.parent !== null && piece === undefined)
        )
          throw new Error('unread work')
        const root = work?.parent === null ? store.turnBlockRootLines(work.piece) : null
        if (work?.parent === null && root === null) throw new Error('unread root')
        const described = describeConversationForRead(store, doc.conversation)
        const title =
          (
            root?.title ??
            piece?.title ??
            (transcript === undefined ? null : described.title)
          )?.slice(0, 200) ?? null
        const label =
          work?.label ?? (transcript === undefined ? doc.conversation : described.address)
        hits.push({
          rowid: doc.rowid,
          conversation: doc.conversation,
          piece: pieceId,
          label,
          line: described.line,
          title,
          link:
            work === null
              ? conversationLink(doc.conversation, label)
              : pieceLink(work.piece, label, title ?? ''),
          state: piece?.state ?? live.status,
          last_active: new Date(live.updated_at).toISOString(),
          archived: false,
          matched_field: doc.field,
          ...(doc.recorded_at === null || doc.ordinal === null || doc.generation === null
            ? {}
            : {
                turn: {
                  id: doc.turn_id,
                  at: new Date(doc.recorded_at).toISOString(),
                  generation: doc.generation,
                  ordinal: doc.ordinal,
                },
              }),
        })
        if (transcript === undefined && hits.length === 5) break
      }
      // FTS5 can ignore rowid equality with MATCH; equal bounds keep the excerpt on its row.
      const snippetFor = indexDb.prepare(
        `SELECT snippet(documents, 3, '[', ']', ' … ', 24) AS snippet
         FROM documents WHERE documents MATCH ? AND rowid >= ? AND rowid <= ?`,
      )
      const withExcerpts = hits.map(({ rowid, ...hit }) => {
        const excerpt = snippetFor.get(match, rowid, rowid) as { snippet: string }
        return { ...hit, snippet: excerpt.snippet.slice(0, 320) }
      })
      const previewCounts =
        recent?.preview === true && moreRecent
          ? {
              scanned: filled.completedConversations,
              total: (
                db
                  .prepare(
                    `SELECT count(*) AS total FROM provider_session
                   ${profile === null ? '' : 'WHERE agent_identity_id = @profile'}`,
                  )
                  .get({ profile }) as { total: number }
              ).total,
            }
          : undefined
      db.exec('COMMIT')
      if (filled.recoveredCapacity) this.close()
      else index.versions = filled.versions
      return {
        ok: true,
        hits: withExcerpts,
        ...(previewCounts === undefined ? {} : { preview_counts: previewCounts }),
        complete: recent === undefined ? nextPage === null : !moreRecent,
        next_cursor:
          recent === undefined
            ? nextPage === null
              ? null
              : pastWorkNext(query.data.words, profile, nextPage, transcript)
            : moreRecent
              ? pastWorkRecentNext(query.data.words, profile, recentAfter, transcript ?? {})
              : null,
      }
    } catch (error) {
      if (db.inTransaction) db.exec('ROLLBACK')
      this.close()
      throw error
    }
  }

  private indexFor(profile: string | null): Index {
    let index = this.profiles.get(profile)
    if (index === undefined) {
      if (this.profiles.size >= PROFILE_LIMIT) {
        const oldest = this.profiles.keys().next().value!
        this.profiles.get(oldest)!.db.close()
        this.profiles.delete(oldest)
      }
      const memory = new Database(':memory:')
      observeDatabaseMemory(memory, 'past-work-index')
      try {
        memory.pragma('max_page_count = 65536')
        memory.exec(`CREATE VIRTUAL TABLE documents USING fts5(conversation UNINDEXED, piece UNINDEXED, field UNINDEXED, text,
          turn_id UNINDEXED, recorded_at UNINDEXED, generation UNINDEXED, ordinal UNINDEXED);
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
    return index
  }

  private indexConversationInBatches(
    index: Index,
    store: WorkLedgerRead,
    session: Source,
    stopAt: number,
    limit: number,
    position?: PastWorkPosition,
  ): { count: number; position?: PastWorkPosition } {
    const write = index.db.transaction((size: number, after?: PastWorkPosition) =>
      this.indexConversation(index, store, session, stopAt, size, after),
    )
    let count = 0
    let batch = CAPACITY_BATCH
    while (true) {
      const size = Math.min(batch, limit - count)
      try {
        const written = write(size, position)
        count += written.count
        position = written.position
        if (position === undefined || count === limit) return { count, position }
      } catch (error) {
        if (error === PREVIEW_DEADLINE && count > 0) return { count, position }
        if (!indexIsFull(error)) throw error
        if (size === 1) {
          // The cursor returned by the last commit identifies the first unread
          // document. For a new conversation, locate it without any FTS writes.
          position ??= this.indexConversation(index, store, session, stopAt, 0).position
          return { count, position }
        }
        batch = Math.floor(size / 2)
      }
    }
  }

  private indexConversation(
    index: Index,
    store: WorkLedgerRead,
    session: Source,
    stopAt: number,
    limit: number,
    resume?: PastWorkPosition,
  ): { count: number; position?: PastWorkPosition } {
    const insert = index.db.prepare(
      `INSERT INTO documents(conversation, piece, field, text, turn_id, recorded_at, generation, ordinal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const source = index.db.prepare(
      'INSERT INTO document_sources(document, conversation) VALUES (?, ?)',
    )
    let count = 0
    const add = (
      piece: string | null,
      field: PastWorkField,
      text: unknown,
      recording?: Recording,
    ) => {
      if (text === null || text === undefined || text === '') return
      if (typeof text !== 'string' || text.length > CELL_LIMIT)
        throw new Error('unread past-work field')
      if (count === limit) return false
      const written = insert.run(
        session.id,
        piece,
        field,
        text,
        recording?.turnId ?? null,
        recording?.at ?? null,
        recording?.generation ?? null,
        recording?.ordinal ?? null,
      )
      source.run(written.lastInsertRowid, session.id)
      count++
    }
    const conversationPiece =
      (
        this.source
          .prepare('SELECT id FROM work WHERE owner_session_id = ? ORDER BY rowid LIMIT 1')
          .get(session.id) as { id: string } | undefined
      )?.id ?? null
    const generation = store.theActiveGeneration(session.id)
    const events =
      resume?.kind === 'file'
        ? []
        : this.source
            .prepare(
              `SELECT type, substr(payload, 1, ?) AS payload, turn_id, created_at, ordinal FROM events
      WHERE session_id = ? AND generation = ? AND ordinal >= ?
      AND type IN ('user_turn', 'assistant_message') ORDER BY ordinal`,
            )
            .iterate(CELL_LIMIT + 1, session.id, generation, resume?.ordinal ?? 0)
    for (const value of events) {
      if (stopAt !== Infinity && performance.now() >= stopAt) throw PREVIEW_DEADLINE
      const event = value as {
        type: string
        payload: string
        turn_id: string | null
        created_at: number
        ordinal: number
      }
      if (event.payload.length > CELL_LIMIT) throw new Error('past-work text is too large')
      const text: unknown = JSON.parse(event.payload)
      if (typeof text !== 'object' || text === null) throw new Error('unread conversation text')
      const message = text as Record<string, unknown>
      const capture = (field: PastWorkField, value: unknown) => {
        const clipped = typeof value === 'string' ? value.slice(0, PAST_WORK_MESSAGE_LIMIT) : value
        return add(conversationPiece, field, clipped, {
          turnId: event.turn_id,
          at: event.created_at,
          generation,
          ordinal: event.ordinal,
        })
      }
      if (event.type === 'assistant_message') {
        if (message.parentToolCallId == null && capture('agent reply', message.text) === false)
          return { count, position: { kind: 'event', ordinal: event.ordinal, part: 0 } }
      } else {
        const parts = theMessagesOf(message as unknown as UserTurnEvent)
        const start = resume?.kind === 'event' && resume.ordinal === event.ordinal ? resume.part : 0
        for (let i = start; i < parts.length; i++) {
          const part = parts[i]!
          if (
            (aPersonsOwnWords(part) || part.attribution === 'provider_transcript') &&
            capture('person message', part.text) === false
          )
            return { count, position: { kind: 'event', ordinal: event.ordinal, part: i } }
        }
      }
    }
    const resources = this.source
      .prepare(
        `SELECT r.rowid, r.work_id, r.name, w.owner_session_id FROM work_resource r
      JOIN work w ON w.id = r.work_id WHERE r.added_by_session_id = ? AND r.role = 'made'
      AND r.rowid >= ? ORDER BY r.rowid`,
      )
      .iterate(session.id, resume?.kind === 'file' ? resume.row : 1)
    for (const value of resources) {
      if (stopAt !== Infinity && performance.now() >= stopAt) throw PREVIEW_DEADLINE
      const resource = value as {
        rowid: number
        work_id: string
        name: string
        owner_session_id: string
      }
      if (
        add(
          resource.owner_session_id === session.id ? resource.work_id : conversationPiece,
          'made-file name',
          resource.name,
        ) === false
      )
        return { count, position: { kind: 'file', row: resource.rowid } }
    }
    return { count }
  }
}
