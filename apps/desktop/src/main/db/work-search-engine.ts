import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  clippedWorkText,
  searchWords,
  WORK_SEARCH_BOUNDS,
  workSearchQuery,
  type WorkSearchHit,
  type WorkSearchPage,
  type WorkSearchQuery,
  type WorkSearchResult,
} from '../../shared/work-search'
import { formOfName } from '../../shared/documents'
import { workFileGroup } from '../../shared/work-file-groups'
import type { PieceRow } from '../../shared/tasks'
import { createSessionStore, rowsUnreadOnce, type SessionStore } from './session-store'
import {
  WorkSearchPageBudget,
  workSearchMaterialization,
  workSearchUnread,
} from './bounded-work-search'

const point = z.object({ at: z.number().finite(), id: z.string().min(1).max(200) }).strict()
const cursorSchema = z
  .object({
    version: z.literal(1),
    query: z.string().length(64),
    high: point,
    after: point.nullable(),
  })
  .strict()
type Point = z.infer<typeof point>
type Candidate = {
  id: string
  owner_session_id: string
  parent_id: string | null
  created_at: number
}

export class WorkSearchEngine {
  private readonly db: Database.Database
  constructor(
    file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
    try {
      this.db.pragma('query_only = ON')
      this.db.pragma('cache_size = -4096')
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  read(
    caller: string,
    input: WorkSearchQuery,
    checkpoint?: (result: WorkSearchResult) => void,
  ): WorkSearchResult {
    const parsed = workSearchQuery.safeParse(input)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    const query = parsed.data
    const words = searchWords(query.words)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([caller, query.scope, query.state ?? null, words, query.limit]))
      .digest('hex')
    let cursor: z.infer<typeof cursorSchema> | null = null
    if (query.cursor !== undefined) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        )
        if (
          cursor.query !== fingerprint ||
          (cursor.after !== null &&
            (cursor.after.at > cursor.high.at ||
              (cursor.after.at === cursor.high.at && cursor.after.id > cursor.high.id)))
        )
          throw new Error('cursor')
      } catch {
        return { ok: false, reason: 'cursor-invalid' }
      }
    }
    this.db.exec('BEGIN')
    try {
      const page = this.page(caller, query, words, fingerprint, cursor, checkpoint)
      this.db.exec('COMMIT')
      return { ok: true, page }
    } catch {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      return { ok: false, reason: 'unavailable' }
    }
  }

  private page(
    caller: string,
    query: z.output<typeof workSearchQuery>,
    words: readonly string[],
    fingerprint: string,
    cursor: z.infer<typeof cursorSchema> | null,
    checkpoint?: (result: WorkSearchResult) => void,
  ): WorkSearchPage {
    const started = this.now()
    const identity = this.db
      .prepare('SELECT agent_identity_id FROM provider_session WHERE id = ?')
      .get(caller) as { agent_identity_id: string | null } | undefined
    if (identity === undefined) throw new Error('no caller')
    const scope =
      query.scope === 'all'
        ? '1'
        : query.scope === 'this-conversation'
          ? '(w.owner_session_id = @caller OR w.given_by_session_id = @caller)'
          : `EXISTS (SELECT 1 FROM provider_session s WHERE s.id IN (w.owner_session_id, w.given_by_session_id) AND s.agent_identity_id = @profile)`
    const parameters = { caller, profile: identity.agent_identity_id }
    const head =
      cursor?.high ??
      (this.db
        .prepare(
          `SELECT created_at AS at, id FROM work w WHERE ${scope} ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(parameters) as Point | undefined)
    if (head === undefined)
      return {
        hits: [],
        searched: 0,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: true,
        next_cursor: null,
      }
    const after = cursor?.after ?? null
    const continuation = (through: Point | null) =>
      Buffer.from(
        JSON.stringify({ version: 1, query: fingerprint, high: head, after: through }),
      ).toString('base64url')
    checkpoint?.({
      ok: true,
      page: {
        hits: [],
        searched: 0,
        rows_unread: 0,
        ledgers_skipped: 0,
        complete: false,
        next_cursor: continuation(after),
      },
    })
    const candidates = this.db
      .prepare(
        `SELECT id, owner_session_id, parent_id, created_at FROM work w
      WHERE ${scope} AND (created_at < @highAt OR (created_at = @highAt AND id <= @highId))
      AND (@afterId IS NULL OR created_at < @afterAt OR (created_at = @afterAt AND id < @afterId))
      ORDER BY created_at DESC, id DESC LIMIT @cap`,
      )
      .all({
        ...parameters,
        highAt: head.at,
        highId: head.id,
        afterAt: after?.at ?? null,
        afterId: after?.id ?? null,
        cap: WORK_SEARCH_BOUNDS.candidates + 1,
      }) as Candidate[]
    const unread = rowsUnreadOnce()
    const owners = new Map<
      string,
      {
        store: SessionStore
        pieces: ReadonlyMap<string, PieceRow>
        measure: ReturnType<typeof workSearchMaterialization>
        readable: boolean
      }
    >()
    // The page clock stops between pieces; a fold already running gets most of the worker bound.
    const pageBudget = new WorkSearchPageBudget(
      () => this.now() - started >= WORK_SEARCH_BOUNDS.workerMs - WORK_SEARCH_BOUNDS.pageMs,
    )
    const hits: WorkSearchHit[] = []
    let searched = 0
    let through = after
    let index = 0
    // Publish only completed candidates; an interrupted fold is retried by the next page.
    const publish = () =>
      checkpoint?.({
        ok: true,
        page: {
          hits: [...hits],
          searched,
          rows_unread: unread.count,
          ledgers_skipped: unread.ledgersSkipped,
          complete: false,
          next_cursor: continuation(through),
        },
      })
    for (; index < Math.min(candidates.length, WORK_SEARCH_BOUNDS.candidates); index++) {
      if (
        hits.length === query.limit ||
        (searched > 0 &&
          (this.now() - started >= WORK_SEARCH_BOUNDS.pageMs ||
            pageBudget.returnedRows >= WORK_SEARCH_BOUNDS.pageRows))
      )
        break
      const candidate = candidates[index]!
      if (query.state !== undefined && candidate.parent_id === null) {
        searched++
        through = { at: candidate.created_at, id: candidate.id }
        publish()
        continue
      }
      let owned = owners.get(candidate.owner_session_id)
      if (owned === undefined) {
        try {
          const measure = workSearchMaterialization(pageBudget)
          const store = createSessionStore(measure.database(this.db), this.now)
          const localUnread = workSearchUnread(unread)
          const folded = store.piecesWithTheirWaits(candidate.owner_session_id, localUnread)
          if (pageBudget.overflowed) break
          let readable = localUnread.count === 0 && localUnread.ledgersSkipped === 0
          try {
            measure.assert()
          } catch {
            readable = false
            unread.in(candidate.owner_session_id)('the-whole-ledger')
          }
          owned = {
            store,
            pieces: new Map(folded.map((piece) => [piece.piece, piece])),
            measure,
            readable,
          }
          owners.set(candidate.owner_session_id, owned)
        } catch {
          if (pageBudget.overflowed) break
          unread.in(candidate.owner_session_id)('the-whole-ledger')
          searched++
          through = { at: candidate.created_at, id: candidate.id }
          publish()
          continue
        }
      }
      let hit: WorkSearchHit | null = null
      if (owned.readable) {
        try {
          const row = owned.store.workById(candidate.id)
          const piece = owned.pieces.get(candidate.id)
          const root =
            candidate.parent_id === null ? owned.store.turnBlockRootLines(candidate.id) : null
          if (row === null || (candidate.parent_id === null ? root === null : piece === undefined))
            throw new Error('unread work')
          if (
            [row.piece, row.label, row.owner, row.givenBy].some(
              (value) => value !== null && value.length > 200,
            )
          )
            throw new Error('unread work identity')
          const title = candidate.parent_id === null ? root!.title : piece!.title
          const summary = piece?.summary ?? null
          const definitionOfDone =
            candidate.parent_id === null
              ? owned.store.rootDoneCondition(candidate.id)
              : (piece?.definitionOfDone ?? null)
          if (definitionOfDone !== null && typeof definitionOfDone !== 'string')
            throw new Error('unread done condition')
          if (
            (query.state === undefined || piece?.state === query.state) &&
            words.every((word) =>
              `${title ?? ''}\n${definitionOfDone ?? ''}\n${summary ?? ''}`
                .toLocaleLowerCase('en')
                .includes(word),
            )
          ) {
            const titleText = clippedWorkText(title, WORK_SEARCH_BOUNDS.titleUnits)
            const resultText = clippedWorkText(summary, WORK_SEARCH_BOUNDS.resultUnits)
            const statusText = clippedWorkText(
              candidate.parent_id === null
                ? (root!.statusLine?.text ?? null)
                : (piece!.statusLine?.text ?? null),
              WORK_SEARCH_BOUNDS.statusUnits,
            )
            const name = (id: string) => {
              const named = owned!.measure
                .database(this.db)
                .prepare(
                  'SELECT a.display_name, a.slug FROM provider_session s LEFT JOIN agent_identity a ON a.id = s.agent_identity_id WHERE s.id = ?',
                )
                .get(id) as { display_name: string | null; slug: string | null } | undefined
              if ((named?.display_name?.length ?? 0) > 200 || (named?.slug?.length ?? 0) > 200)
                throw new Error('unread identity')
              return {
                conversation: id,
                name: named?.display_name ?? null,
                profile: named?.slug ?? null,
              }
            }
            const bounded = owned.measure.database(this.db)
            const resources = bounded
              .prepare(
                'SELECT id, role, name FROM work_resource WHERE work_id = ? ORDER BY created_at, id LIMIT ?',
              )
              .all(candidate.id, WORK_SEARCH_BOUNDS.resourceIds) as {
              id: string
              role: 'input' | 'made'
              name: string
            }[]
            const totalResources = (
              bounded
                .prepare('SELECT count(*) AS count FROM work_resource WHERE work_id = ?')
                .get(candidate.id) as { count: number }
            ).count
            const resource_ids = {
              brief: [] as string[],
              result: [] as string[],
              attachments: [] as string[],
              working: [] as string[],
            }
            const returned = new Set(piece?.resources ?? [])
            for (const resource of resources) {
              const group = workFileGroup(
                { role: resource.role, form: formOfName(resource.name) },
                returned.has(resource.id),
              )
              if (group !== null) resource_ids[group].push(resource.id)
            }
            hit = {
              definition_of_done: clippedWorkText(definitionOfDone, 512).text,
              kind: candidate.parent_id === null ? 'root' : 'piece',
              piece: row.piece,
              label: row.label,
              title: titleText.text,
              state: piece?.state ?? null,
              ...(candidate.parent_id === null
                ? { conversation_state: owned.store.recordedOne(row.owner)?.status ?? 'unknown' }
                : {}),
              owner: name(row.owner),
              giver: row.givenBy === null ? null : name(row.givenBy),
              result:
                piece?.outcome == null
                  ? null
                  : { outcome: piece.outcome, summary: resultText.text },
              status: statusText.text,
              resource_ids,
              clipped: {
                title: titleText.clipped,
                result: resultText.clipped,
                status: statusText.clipped,
              },
              resources_omitted: Math.max(0, totalResources - WORK_SEARCH_BOUNDS.resourceIds),
            }
          }
          owned.measure.assert()
        } catch {
          if (pageBudget.overflowed) break
          unread.in(candidate.owner_session_id)('the-whole-ledger')
          owned.readable = false
          hit = null
        }
      }
      if (pageBudget.overflowed) break
      if (
        hit !== null &&
        JSON.stringify({
          hits: [...hits, hit],
          searched,
          rows_unread: unread.count,
          ledgers_skipped: unread.ledgersSkipped,
          next_cursor: 'x'.repeat(2048),
        }).length > WORK_SEARCH_BOUNDS.responseUnits
      )
        break
      if (hit !== null) hits.push(hit)
      searched++
      through = { at: candidate.created_at, id: candidate.id }
      publish()
    }
    const exhausted = index >= candidates.length
    return {
      hits,
      searched,
      rows_unread: unread.count,
      ledgers_skipped: unread.ledgersSkipped,
      complete: exhausted && unread.count === 0 && unread.ledgersSkipped === 0,
      next_cursor: exhausted ? null : continuation(through),
    }
  }

  close(): void {
    this.db.close()
  }
}
