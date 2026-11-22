import { observeDatabaseMemory } from '../database-memory'
import Database from 'better-sqlite3'
import type { Provider } from '@brobot2/shared'
import { z } from 'zod'
import {
  clippedWorkText,
  searchWords,
  WORK_SEARCH_BOUNDS,
  WORK_SEARCH_GROUP_BOUNDS,
  workSearchQuery,
  type ConversationSearchHit,
  type GroupedWorkSearchPreview,
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
import { LimitsReadUnavailable } from './limits-read-protocol'
import { matchingWorkTitles, type WorkSearchTitleMatch } from './work-search-titles'
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
    titleAfter: point.nullable().optional(),
    titleDetails: z.object({ after: point.nullable(), through: point }).strict().optional(),
    within: point
      .extend({ offset: z.number().int().positive().max(WORK_SEARCH_BOUNDS.ledgerRows) })
      .optional(),
    groupOffset: z.int().positive().max(WORK_SEARCH_BOUNDS.candidates).optional(),
    groupScan: z.literal(true).optional(),
  })
  .strict()
type Point = z.infer<typeof point>
const before = (one: Point, other: Point): boolean =>
  one.at < other.at || (one.at === other.at && one.id < other.id)
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
  root: boolean
  piece: PieceRow | null
}

type ConversationMatch = {
  hit: ConversationSearchHit
  taskLabels: readonly string[]
}

class SearchGroups {
  readonly counts = new Map<string | null, number>()
  private readonly previews = new Map<string | null, GroupedWorkSearchPreview[]>()
  matched = 0

  constructor(readonly offset: number) {}

  wantsPreview(profile: string | null): boolean {
    const previews = this.previews.get(profile)
    if (previews !== undefined) return previews.length < WORK_SEARCH_GROUP_BOUNDS.previews
    return (
      !this.counts.has(profile) &&
      this.counts.size >= this.offset &&
      this.previews.size < WORK_SEARCH_GROUP_BOUNDS.groups
    )
  }

  add({ hit, taskLabels }: ConversationMatch): void {
    if (this.wantsPreview(hit.profile)) {
      const { conversation, address, title, last_active_at, status, metadata } = hit
      const page = this.previews.get(hit.profile) ?? []
      page.push({
        conversation,
        address,
        title,
        last_active_at,
        status,
        metadata,
        matched_task_labels: taskLabels,
        tasks_omitted: hit.tasks_omitted - taskLabels.length,
      })
      this.previews.set(hit.profile, page)
    }
    this.counts.set(hit.profile, (this.counts.get(hit.profile) ?? 0) + 1)
    this.matched++
  }

  page(complete: boolean): NonNullable<WorkSearchPage['grouped']> {
    const groups = [...this.previews].map(([profile, previews]) => ({
      profile,
      matched: complete ? this.counts.get(profile)! : null,
      previews: [...previews],
    }))
    while (JSON.stringify(groups).length > WORK_SEARCH_BOUNDS.responseUnits - 2200) groups.pop()
    return { matched: complete ? this.matched : null, groups }
  }
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
      observeDatabaseMemory(this.db, 'work-search')
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
      ...(query.grouped === true ? ['grouped'] : []),
      ...(query.titlesAndBriefs === true ? ['titles-and-briefs'] : []),
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
          (cursor.titleDetails !== undefined &&
            (cursor.titleAfter === undefined ||
              cursor.after !== null ||
              before(cursor.high, cursor.titleDetails.through) ||
              (cursor.titleDetails.after !== null &&
                !before(cursor.titleDetails.through, cursor.titleDetails.after)))) ||
          (query.grouped === true
            ? cursor.groupScan === true
              ? cursor.groupOffset !== undefined
              : cursor.after !== null || cursor.groupOffset === undefined
            : cursor.groupOffset !== undefined || cursor.groupScan !== undefined) ||
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
    const titleFirst =
      words.length > 0 &&
      query.profile === undefined &&
      query.from === undefined &&
      query.to === undefined &&
      query.scope === undefined &&
      query.state === undefined &&
      query.grouped !== true &&
      (through === null || cursor?.titleAfter !== undefined)
    const includeMetadata = query.includeConversationMetadata === true || query.grouped === true
    let titleThrough = cursor?.titleAfter
    let titleDetails = cursor?.titleDetails
    const detailsPage = titleDetails !== undefined
    let detailsRead = 0
    let within = cursor?.within
    const unread = rowsUnreadOnce()
    const hits: ConversationSearchHit[] = []
    const groups = query.grouped === true ? new SearchGroups(cursor?.groupOffset ?? 0) : null
    let groupPrefix: { after: Point; grouped: NonNullable<WorkSearchPage['grouped']> } | undefined
    let searched = 0
    let matchedTasks = 0
    let tooLarge = 0
    let titleDetailsUnread = 0
    const result = (finished: boolean): WorkSearchPage => {
      const visibleHits = detailsPage ? hits.slice(0, detailsRead) : [...hits]
      const unreadDetails = titleDetailsUnread - (hits.length - visibleHits.length)
      const complete =
        finished && unread.count === 0 && unread.ledgersSkipped === 0 && unreadDetails === 0
      if (groups !== null) {
        const countIsExact = complete && cursor?.groupScan !== true
        const prefix = countIsExact ? undefined : groupPrefix
        const grouped = prefix?.grouped ?? groups.page(countIsExact)
        const groupOffset = groups.offset + grouped.groups.length
        const next =
          countIsExact && grouped.groups.length > 0 && groupOffset < groups.counts.size
            ? { after: null, groupOffset }
            : !finished || prefix !== undefined
              ? { after: prefix?.after ?? through, groupScan: true }
              : null
        return {
          hits: [],
          searched,
          rows_unread: unread.count,
          ledgers_skipped: unread.ledgersSkipped,
          ...(tooLarge === 0 ? {} : { candidates_too_large: tooLarge }),
          complete: complete && prefix === undefined,
          next_cursor:
            next === null
              ? null
              : Buffer.from(
                  JSON.stringify({ version: 2, query: queryKey, high, ...next }),
                ).toString('base64url'),
          grouped,
        }
      }
      return {
        hits: visibleHits,
        searched,
        rows_unread: unread.count,
        ledgers_skipped: unread.ledgersSkipped,
        ...(tooLarge === 0 ? {} : { candidates_too_large: tooLarge }),
        ...(unreadDetails === 0 ? {} : { title_details_unread: unreadDetails }),
        ...(titleDetails === undefined ? {} : { title_details_pending: true as const }),
        complete,
        next_cursor: finished
          ? null
          : Buffer.from(
              JSON.stringify({
                version: 2,
                query: queryKey,
                high,
                after: through,
                ...(titleThrough === undefined ? {} : { titleAfter: titleThrough }),
                ...(titleDetails === undefined ? {} : { titleDetails }),
                ...(within === undefined ? {} : { within }),
              }),
            ).toString('base64url'),
      }
    }
    if (high === undefined) return result(true)
    checkpoint?.({ ok: true, page: result(false) })

    const titles = titleFirst
      ? matchingWorkTitles(this.db, high, includeMetadata, (title) => matches(words, [title]))
      : []
    const titleIds = new Set(titles.map(({ id }) => id))
    const toEnrich: { candidate: Candidate; titleIndex: number }[] = []
    let titleCandidates = 0
    if (titleFirst && (detailsPage || titleThrough !== null)) {
      const store = createSessionStore(this.db, this.now)
      const range = titleDetails
      const titleStart = detailsPage ? range?.after : titleThrough
      const remaining = titles.filter(
        (title) =>
          (titleStart == null || before(title, titleStart)) &&
          (range === undefined || !before(title, range.through)),
      )
      titleCandidates = remaining.length
      let lastTitle: Point | undefined
      for (const title of remaining) {
        if (hits.length >= query.limit) break
        const hit = this.titleHit(title, store, this.db)
        if (JSON.stringify([...hits, hit]).length > WORK_SEARCH_BOUNDS.responseUnits - 2200) break
        toEnrich.push({
          candidate: {
            id: title.id,
            at: title.at,
            profile: title.profile,
            provider: title.provider,
            archivedAt: title.archivedAt,
          },
          titleIndex: hits.length,
        })
        hits.push(hit)
        titleDetailsUnread++
        lastTitle = { id: title.id, at: title.at }
      }
      if (!detailsPage) {
        const more = toEnrich.length < titleCandidates
        titleThrough = more ? (lastTitle ?? titleThrough) : null
        if (lastTitle !== undefined && (hits.length === query.limit || more)) {
          titleDetails = { after: titleStart ?? null, through: lastTitle }
          return result(false)
        }
      }
      checkpoint?.({ ok: true, page: result(false) })
    }

    const moreTitles = titleFirst && titleThrough !== null
    const candidates =
      moreTitles || detailsPage
        ? []
        : (this.db
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
            }) as Candidate[])
    const workerScanMs = WORK_SEARCH_BOUNDS.workerMs - WORK_SEARCH_BOUNDS.pageMs
    const scanMs = groups === null ? WORK_SEARCH_BOUNDS.pageMs : workerScanMs
    const pageBudget = new WorkSearchPageBudget(() => this.now() - started >= workerScanMs)
    const groupedMeasure = groups === null ? null : workSearchMaterialization(pageBudget)
    let groupedRead: { db: Database.Database; store: SessionStore } | undefined
    const scans: { candidate: Candidate; titleIndex?: number }[] = [
      ...toEnrich,
      ...candidates.slice(0, WORK_SEARCH_BOUNDS.candidates).map((candidate) => ({ candidate })),
    ]
    for (const { candidate, titleIndex } of scans) {
      if (
        (titleIndex === undefined &&
          groups === null &&
          (query.scope === undefined ? hits.length : matchedTasks) >= query.limit) ||
        ((searched > 0 || (titleIndex !== undefined && (!detailsPage || detailsRead > 0))) &&
          (this.now() - started >= scanMs ||
            pageBudget.returnedRows >= WORK_SEARCH_BOUNDS.pageRows))
      )
        break
      if (titleIndex === undefined && titleIds.has(candidate.id)) {
        searched++
        through = { at: candidate.at, id: candidate.id }
        continue
      }
      const measure = groupedMeasure ?? workSearchMaterialization(pageBudget)
      groupedMeasure?.resetLedger()
      const localUnread = workSearchUnread(unread)
      let match: ConversationMatch | null
      const offset = within?.id === candidate.id && within.at === candidate.at ? within.offset : 0
      const taskLimit =
        groups !== null ? 0 : query.scope === undefined ? 50 : query.limit - matchedTasks
      try {
        const db = groupedRead?.db ?? measure.database(this.db)
        const store = groupedRead?.store ?? createSessionStore(db, this.now)
        if (groupedMeasure !== null && groupedRead === undefined) groupedRead = { db, store }
        match = this.conversationHit(
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
          groups?.wantsPreview(candidate.profile) ?? false,
        )
        measure.assert()
        if (localUnread.count > 0 || localUnread.ledgersSkipped > 0) match = null
      } catch (error) {
        if (!pageBudget.overflowed) {
          if (error instanceof LimitsReadUnavailable && error.why === 'overflow') tooLarge++
          unread.in(candidate.id)('the-whole-ledger')
        }
        match = null
      }
      if (pageBudget.overflowed && (!detailsPage || detailsRead > 0)) break
      const hit = pageBudget.overflowed ? null : (match?.hit ?? null)
      if (titleIndex !== undefined) {
        if (hit !== null) {
          const updated = [...hits]
          updated[titleIndex] = hit
          if (JSON.stringify(updated).length <= WORK_SEARCH_BOUNDS.responseUnits - 2200) {
            hits[titleIndex] = hit
            titleDetailsUnread--
          }
        }
        if (detailsPage && titleDetails !== undefined) {
          detailsRead++
          titleDetails =
            detailsRead === titleCandidates
              ? undefined
              : { ...titleDetails, after: { id: candidate.id, at: candidate.at } }
        }
        checkpoint?.({ ok: true, page: result(false) })
        continue
      }
      if (
        groups === null &&
        hit !== null &&
        !titleIds.has(candidate.id) &&
        JSON.stringify([...hits, hit]).length > WORK_SEARCH_BOUNDS.responseUnits - 2200
      )
        break
      if (match !== null && !titleIds.has(candidate.id)) {
        if (groups !== null) {
          if (
            groupPrefix === undefined &&
            through !== null &&
            groups.counts.size >= groups.offset + WORK_SEARCH_GROUP_BOUNDS.groups &&
            !groups.counts.has(match.hit.profile)
          ) {
            // If the scan stops, continue before the first profile that could not be shown.
            groupPrefix = { after: through, grouped: groups.page(false) }
          }
          groups.add(match)
        } else {
          hits.push(match.hit)
          matchedTasks += match.hit.matched_tasks.length
        }
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
    if (detailsPage) {
      if (titleCandidates === 0) titleDetails = undefined
      return result(false)
    }
    return result(!moreTitles && searched === candidates.length)
  }

  private titleHit(candidate: WorkSearchTitleMatch, store: SessionStore, db: Database.Database) {
    const { id, profile, at, tasks, provider, archivedAt } = candidate
    const savedTitle = provider === null ? undefined : store.conversationTitle(id)
    const { address, title, line } = describeConversationForRead(store, id, undefined, savedTitle)
    const matched_tasks: WorkSearchHit[] = []
    let units = 0
    for (const task of tasks.slice(0, 50)) {
      const row = store.workById(task.id)
      if (row === null) continue
      const hit = this.taskHit(
        {
          id: row.piece,
          label: row.label,
          title: task.title,
          brief: null,
          giver: row.givenBy,
          givenAt: row.createdAt,
          status: null,
          done: null,
          root: row.parent === null,
          piece: null,
        },
        id,
        store,
        db,
      )
      units += JSON.stringify(hit).length
      if (units > (WORK_SEARCH_BOUNDS.responseUnits - 2200) / 2) break
      matched_tasks.push(hit)
    }
    return {
      conversation: id,
      address,
      title: clippedWorkText(title, WORK_SEARCH_BOUNDS.titleUnits).text ?? '',
      line,
      profile,
      last_active_at: at,
      status: null,
      matched_tasks,
      tasks_omitted: tasks.length - matched_tasks.length,
      ...(provider === null
        ? {}
        : {
            metadata: {
              provider,
              archived_at: archivedAt,
              title_author: savedTitle?.author ?? null,
            },
          }),
    }
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
    collectTaskLabels: boolean,
  ): ConversationMatch | null {
    const { id } = candidate
    const root = store.rootOf(id)
    const service = isRecordedServiceConversation(store, id)
    const savedTitle =
      candidate.provider === null
        ? undefined
        : store.conversationTitle(id, query.grouped === true ? unread : undefined)
    const { address, title, line, profileFallback } = describeConversationForRead(
      store,
      id,
      service,
      savedTitle,
    )
    const rootLines = root === null ? null : store.turnBlockRootLines(root.piece)
    if (root !== null && rootLines === null) throw new Error('unread conversation task')
    const pieces =
      query.state === undefined
        ? store.piecesOwnedBy(id, unread)
        : store.piecesWithTheirWaits(id, unread)
    const tasks: MatchedTask[] = pieces.map((piece) => ({
      id: piece.piece,
      label: piece.label,
      title: piece.title,
      brief: piece.brief,
      giver: piece.giver,
      givenAt: piece.givenAt,
      status: piece.statusLine,
      done: piece.definitionOfDone ?? null,
      root: false,
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
        root: true,
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
            query.titlesAndBriefs === true
              ? [task.title, task.brief]
              : query.scope === undefined
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
      matches(
        words,
        query.titlesAndBriefs === true
          ? [profileFallback ? null : title]
          : [address, title, candidate.profile, latest?.text ?? null],
      )
    if (!matchesConversation && matched.length === 0) return null

    const toShow = matched.slice(0, taskLimit)
    const withWaits =
      query.state === undefined && toShow.length > 0
        ? new Map(
            store
              .piecesWithTheirWaits(
                id,
                unread,
                toShow.flatMap(({ piece }) => (piece === null ? [] : [piece])),
              )
              .map((piece) => [piece.piece, piece]),
          )
        : undefined
    const matched_tasks: WorkSearchHit[] = []
    let units = 0
    for (const task of toShow) {
      const piece = withWaits?.get(task.id)
      const one = this.taskHit(piece === undefined ? task : { ...task, piece }, id, store, db)
      units += JSON.stringify(one).length
      if (units > (WORK_SEARCH_BOUNDS.responseUnits - 2200) / 2) break
      matched_tasks.push(one)
    }
    return {
      taskLabels: collectTaskLabels
        ? matched.slice(0, WORK_SEARCH_GROUP_BOUNDS.taskLabels).map((task) => task.label)
        : [],
      hit: {
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
      },
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
      kind: task.root ? 'root' : 'piece',
      piece: task.id,
      label: task.label,
      title: title.text,
      given_at: task.givenAt,
      definition_of_done: clippedWorkText(task.done, 512).text,
      state: task.piece?.state ?? null,
      ...(task.root ? { conversation_state: store.recordedOne(owner)?.status ?? 'unknown' } : {}),
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
