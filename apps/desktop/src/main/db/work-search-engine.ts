import Database from 'better-sqlite3'
import type { Provider } from '@brobot2/shared'
import { z } from 'zod'
import {
  clippedWorkText,
  searchWords,
  WORK_SEARCH_BOUNDS,
  workSearchQuery,
  type ConversationSearchHit,
  type WorkSearchHit,
  type WorkSearchPage,
  type WorkSearchQuery,
  type WorkSearchResult,
} from '../../shared/work-search'
import type { PieceRow, StatusLine } from '../../shared/task-contracts'
import { formOfName } from '../../shared/documents'
import { workFileGroup } from '../../shared/work-file-groups'
import {
  describeConversationForRead,
  isRecordedServiceConversation,
} from '../runtime/conversation-address'
import { createSessionStore, type SessionStore } from './session-store'
import { agentIdentityRowId } from './identity'
import { rowsUnreadOnce, type RowsUnread } from './rows-unread'
import {
  WorkSearchPageBudget,
  workSearchMaterialization,
  workSearchUnread,
} from './bounded-work-search'

const point = z.object({ at: z.number().finite(), id: z.string().min(1).max(200) }).strict()
const cursorSchema = z
  .object({
    version: z.literal(2),
    query: z.string().min(1).max(1024),
    high: point,
    after: point.nullable(),
    within: point
      .extend({ offset: z.number().int().positive().max(WORK_SEARCH_BOUNDS.ledgerRows) })
      .optional(),
  })
  .strict()
type Point = z.infer<typeof point>
type Cursor = z.infer<typeof cursorSchema>
type Search = z.output<typeof workSearchQuery>
type Candidate = Point & {
  profile: string | null
  provider: Provider | null
  archivedAt: number | null
}
type MatchedTask = {
  id: string
  label: string
  title: string | null
  brief: string | null
  giver: string | null
  givenAt: number
  status: StatusLine | null
  done: string | null
  piece: PieceRow | null
}

const CANDIDATES =
  'FROM provider_session s LEFT JOIN agent_identity a ON a.id = s.agent_identity_id'
const DATE_SCOPE =
  '(@profile IS NULL OR a.slug = @profile) AND s.updated_at >= @from AND s.updated_at <= @to'
const matches = (words: readonly string[], fields: readonly (string | null)[]): boolean => {
  const text = fields.join('\n').toLocaleLowerCase('en')
  return words.every((word) => text.includes(word))
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
    if (query.from !== undefined && query.to !== undefined && query.from > query.to)
      return { ok: false, reason: 'invalid' }
    const words = searchWords(query.words)
    const profile = query.profile?.toLocaleLowerCase('en') ?? null
    if (
      profile !== null &&
      this.db.prepare('SELECT 1 FROM agent_identity WHERE slug = ?').get(profile) === undefined
    )
      return { ok: false, reason: 'invalid' }
    const queryKey = JSON.stringify([
      caller,
      query.scope,
      query.state,
      profile,
      query.from,
      query.to,
      words,
      query.limit,
      ...(query.includeConversationMetadata === true ? [true] : []),
    ])
    let cursor: Cursor | null = null
    if (query.cursor !== undefined) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        )
        if (
          cursor.query !== queryKey ||
          (cursor.within !== undefined && query.scope === undefined) ||
          (cursor.after !== null &&
            (cursor.after.at > cursor.high.at ||
              (cursor.after.at === cursor.high.at && cursor.after.id > cursor.high.id)))
        )
          return { ok: false, reason: 'cursor-invalid' }
      } catch {
        return { ok: false, reason: 'cursor-invalid' }
      }
    }

    this.db.exec('BEGIN')
    try {
      const page = this.page(caller, query, words, profile, queryKey, cursor, checkpoint)
      this.db.exec('COMMIT')
      return { ok: true, page }
    } catch {
      if (this.db.inTransaction) this.db.exec('ROLLBACK')
      return { ok: false, reason: 'unavailable' }
    }
  }

  private page(
    caller: string,
    query: Search,
    words: readonly string[],
    profile: string | null,
    queryKey: string,
    cursor: Cursor | null,
    checkpoint?: (result: WorkSearchResult) => void,
  ): WorkSearchPage {
    const started = this.now()
    const identity = this.db
      .prepare('SELECT agent_identity_id AS id FROM provider_session WHERE id = ?')
      .get(caller) as { id: string | null } | undefined
    if (identity === undefined) throw new Error('no caller')
    const params = {
      profile,
      from: query.from === undefined ? Number.MIN_SAFE_INTEGER : Date.parse(query.from),
      to: query.to === undefined ? Number.MAX_SAFE_INTEGER : Date.parse(query.to) + 86_399_999,
    }
    const high =
      cursor?.high ??
      (this.db
        .prepare(
          'SELECT s.id, s.updated_at AS at ' +
            CANDIDATES +
            ' WHERE ' +
            DATE_SCOPE +
            ' ORDER BY s.updated_at DESC, s.id DESC LIMIT 1',
        )
        .get(params) as Point | undefined)
    let through = cursor?.after ?? null
    let within = cursor?.within
    const unread = rowsUnreadOnce()
    const hits: ConversationSearchHit[] = []
    let searched = 0
    let matchedTasks = 0
    const result = (finished: boolean): WorkSearchPage => ({
      hits: [...hits],
      searched,
      rows_unread: unread.count,
      ledgers_skipped: unread.ledgersSkipped,
      complete: finished && unread.count === 0 && unread.ledgersSkipped === 0,
      next_cursor: finished
        ? null
        : Buffer.from(
            JSON.stringify({
              version: 2,
              query: queryKey,
              high,
              after: through,
              ...(within === undefined ? {} : { within }),
            }),
          ).toString('base64url'),
    })
    if (high === undefined) return result(true)
    checkpoint?.({ ok: true, page: result(false) })

    const includeMetadata = query.includeConversationMetadata === true
    const candidates = this.db
      .prepare(
        'SELECT s.id, s.updated_at AS at, a.slug AS profile, ' +
          (includeMetadata
            ? 's.provider AS provider, archived.archived_at AS archivedAt '
            : 'NULL AS provider, NULL AS archivedAt ') +
          CANDIDATES +
          (includeMetadata
            ? ' LEFT JOIN archived_conversation archived ON archived.conversation_id = s.id'
            : '') +
          ' WHERE ' +
          DATE_SCOPE +
          ' AND (s.updated_at, s.id) <= (@highAt, @highId)' +
          ' AND (@afterId IS NULL OR (s.updated_at, s.id) < (@afterAt, @afterId))' +
          ' ORDER BY s.updated_at DESC, s.id DESC LIMIT @cap',
      )
      .all({
        ...params,
        highAt: high.at,
        highId: high.id,
        afterAt: through?.at ?? null,
        afterId: through?.id ?? null,
        cap: WORK_SEARCH_BOUNDS.candidates + 1,
      }) as Candidate[]
    const pageBudget = new WorkSearchPageBudget(
      () => this.now() - started >= WORK_SEARCH_BOUNDS.workerMs - WORK_SEARCH_BOUNDS.pageMs,
    )
    for (const candidate of candidates.slice(0, WORK_SEARCH_BOUNDS.candidates)) {
      if (
        (query.scope === undefined ? hits.length : matchedTasks) >= query.limit ||
        (searched > 0 &&
          (this.now() - started >= WORK_SEARCH_BOUNDS.pageMs ||
            pageBudget.returnedRows >= WORK_SEARCH_BOUNDS.pageRows))
      )
        break
      const measure = workSearchMaterialization(pageBudget)
      const localUnread = workSearchUnread(unread)
      let hit: ConversationSearchHit | null
      const offset = within?.id === candidate.id && within.at === candidate.at ? within.offset : 0
      const taskLimit = query.scope === undefined ? 50 : query.limit - matchedTasks
      try {
        const db = measure.database(this.db)
        const store = createSessionStore(db, this.now)
        hit = this.conversationHit(
          candidate,
          caller,
          identity.id,
          query,
          words,
          store,
          db,
          localUnread,
          offset,
          taskLimit,
        )
        measure.assert()
        if (localUnread.count > 0 || localUnread.ledgersSkipped > 0) hit = null
      } catch {
        if (pageBudget.overflowed) break
        unread.in(candidate.id)('the-whole-ledger')
        hit = null
      }
      if (
        hit !== null &&
        JSON.stringify([...hits, hit]).length > WORK_SEARCH_BOUNDS.responseUnits - 2200
      )
        break
      if (hit !== null) {
        hits.push(hit)
        matchedTasks += hit.matched_tasks.length
      }
      searched++
      if (
        query.scope !== undefined &&
        hit !== null &&
        hit.tasks_omitted > 0 &&
        hit.matched_tasks.length > 0
      ) {
        within = { at: candidate.at, id: candidate.id, offset: offset + hit.matched_tasks.length }
        checkpoint?.({ ok: true, page: result(false) })
        return result(false)
      }
      within = undefined
      through = { at: candidate.at, id: candidate.id }
      checkpoint?.({ ok: true, page: result(false) })
    }
    return result(searched === candidates.length)
  }

  private conversationHit(
    candidate: Candidate,
    caller: string,
    identity: string | null,
    query: Search,
    words: readonly string[],
    store: SessionStore,
    db: Database.Database,
    unread: RowsUnread,
    offset: number,
    taskLimit: number,
  ): ConversationSearchHit | null {
    const { id } = candidate
    const root = store.rootOf(id)
    const service = isRecordedServiceConversation(store, id, root)
    const savedTitle = candidate.provider === null ? undefined : store.conversationTitle(id)
    const { address, title, line } = describeConversationForRead(store, id, service, savedTitle)
    const rootLines = root === null ? null : store.turnBlockRootLines(root.piece)
    if (root !== null && rootLines === null) throw new Error('unread conversation task')
    const tasks: MatchedTask[] = store.piecesWithTheirWaits(id, unread).map((piece) => ({
      id: piece.piece,
      label: piece.label,
      title: piece.title,
      brief: piece.brief,
      giver: piece.giver,
      givenAt: piece.givenAt,
      status: piece.statusLine,
      done: piece.definitionOfDone ?? null,
      piece,
    }))
    if (root !== null && rootLines !== null) {
      tasks.push({
        id: root.piece,
        label: root.label,
        title: rootLines.title,
        brief: root.brief,
        giver: root.givenBy,
        givenAt: root.createdAt,
        status: rootLines.statusLine,
        done: store.rootDoneCondition(root.piece),
        piece: null,
      })
    }
    let latest: StatusLine | null = null
    for (const task of tasks)
      if (task.status !== null && (latest === null || task.status.at > latest.at))
        latest = task.status

    const identityOf = db.prepare(
      'SELECT agent_identity_id AS id FROM provider_session WHERE id = ?',
    )
    const identityFor = (conversation: string) =>
      (identityOf.get(conversation) as { id: string | null } | undefined)?.id ?? null
    const eligible = (task: MatchedTask): boolean => {
      if (query.state !== undefined && task.piece?.state !== query.state) return false
      if (query.scope === 'this-conversation') return id === caller || task.giver === caller
      if (query.scope === 'mine')
        return (
          identity !== null &&
          (identityFor(id) === identity ||
            (task.giver !== null && identityFor(task.giver) === identity))
        )
      return true
    }
    const matched = tasks
      .filter(
        (task) =>
          eligible(task) &&
          matches(
            words,
            query.scope === undefined
              ? [
                  task.label,
                  task.title,
                  task.brief,
                  task.done,
                  task.status?.text ?? null,
                  task.piece?.summary ?? null,
                ]
              : [task.title, task.done, task.piece?.summary ?? null],
          ),
      )
      .sort((left, right) => right.givenAt - left.givenAt || right.id.localeCompare(left.id))
      .slice(offset)
    const matchesConversation =
      query.scope === undefined &&
      query.state === undefined &&
      matches(words, [address, title, candidate.profile, latest?.text ?? null])
    if (!matchesConversation && matched.length === 0) return null

    const matched_tasks: WorkSearchHit[] = []
    let units = 0
    for (const task of matched.slice(0, taskLimit)) {
      const one = this.taskHit(task, id, store, db)
      units += JSON.stringify(one).length
      if (units > (WORK_SEARCH_BOUNDS.responseUnits - 2200) / 2) break
      matched_tasks.push(one)
    }
    return {
      conversation: id,
      address,
      title: clippedWorkText(title, WORK_SEARCH_BOUNDS.titleUnits).text ?? '',
      line,
      profile: candidate.profile,
      last_active_at: candidate.at,
      status: clippedWorkText(latest?.text ?? null, WORK_SEARCH_BOUNDS.statusUnits).text,
      matched_tasks,
      tasks_omitted: matched.length - matched_tasks.length,
      ...(candidate.provider === null
        ? {}
        : {
            metadata: {
              provider: candidate.provider,
              archived_at: candidate.archivedAt,
              title_author: savedTitle?.author ?? null,
            },
          }),
    }
  }

  private taskHit(
    task: MatchedTask,
    owner: string,
    store: SessionStore,
    db: Database.Database,
  ): WorkSearchHit {
    const name = (conversation: string) => {
      const identity = store.conversationBinding(conversation)?.identity
      const profile =
        identity == null ? null : store.agentIdentityNameById(agentIdentityRowId(identity))
      return { conversation, name: profile?.displayName ?? null, profile: profile?.slug ?? null }
    }
    const resources = db
      .prepare(
        'SELECT id, role, name FROM work_resource WHERE work_id = ? ORDER BY created_at, id LIMIT ?',
      )
      .all(task.id, WORK_SEARCH_BOUNDS.resourceIds) as {
      id: string
      role: 'input' | 'made'
      name: string
    }[]
    const { count } = db
      .prepare('SELECT count(*) AS count FROM work_resource WHERE work_id = ?')
      .get(task.id) as { count: number }
    const resource_ids = {
      brief: [] as string[],
      result: [] as string[],
      attachments: [] as string[],
      working: [] as string[],
    }
    const returned = new Set(task.piece?.resources ?? [])
    for (const resource of resources) {
      const group = workFileGroup(
        { role: resource.role, form: formOfName(resource.name) },
        returned.has(resource.id),
      )
      if (group !== null) resource_ids[group].push(resource.id)
    }
    const title = clippedWorkText(task.title, WORK_SEARCH_BOUNDS.titleUnits)
    const status = clippedWorkText(task.status?.text ?? null, WORK_SEARCH_BOUNDS.statusUnits)
    const summary = clippedWorkText(task.piece?.summary ?? null, WORK_SEARCH_BOUNDS.resultUnits)
    const outcome = task.piece?.outcome ?? null
    return {
      kind: task.piece === null ? 'root' : 'piece',
      piece: task.id,
      label: task.label,
      title: title.text,
      given_at: task.givenAt,
      definition_of_done: clippedWorkText(task.done, 512).text,
      state: task.piece?.state ?? null,
      ...(task.piece === null
        ? { conversation_state: store.recordedOne(owner)?.status ?? 'unknown' }
        : {}),
      owner: name(owner),
      giver: task.giver === null ? null : name(task.giver),
      result: outcome === null ? null : { outcome, summary: summary.text },
      status: status.text,
      resource_ids,
      clipped: { title: title.clipped, result: summary.clipped, status: status.clipped },
      resources_omitted: Math.max(0, count - WORK_SEARCH_BOUNDS.resourceIds),
    }
  }

  close(): void {
    this.db.close()
  }
}
