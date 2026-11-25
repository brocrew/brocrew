import {
  pastWorkRecentStart,
  pastWorkStart,
  type PastWorkSearchResult,
  type PastWorkSource,
  type PastWorkTranscriptScope,
} from '../../shared/past-work-search'
import { conversationLink, pieceLink } from '../../shared/links'
import type { WorkSearchQuery, WorkSearchResult } from '../../shared/work-search'
import type { ArchivedConversations } from '../archived-file'
import { agentIdentityRowId } from '../db/identity'
import type { PastWorkSearchReader } from '../db/past-work-search-reader'
import type { SessionStore } from '../db/session-store'
import type { WorkSearchReader } from '../db/work-search-reader'

interface WorkSearchDependencies {
  readonly store: Pick<SessionStore, 'conversationBinding' | 'pastWorkSearchSource'>
  readonly workSearchReader?: Pick<WorkSearchReader, 'read'>
  readonly pastWorkSearchReader?: Pick<PastWorkSearchReader, 'read'>
}

export class WorkSearch {
  constructor(
    private readonly deps: WorkSearchDependencies,
    private readonly launches: { readonly closed: boolean },
    private readonly archived: Pick<ArchivedConversations, 'has'>,
  ) {}

  async searchWork(asAgent: string, input: WorkSearchQuery): Promise<WorkSearchResult> {
    if (
      this.deps.store.conversationBinding(asAgent) === null ||
      this.deps.workSearchReader === undefined
    )
      return { ok: false, reason: 'unavailable' }
    try {
      return await this.deps.workSearchReader.read(asAgent, input)
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  }

  async searchPastWork(
    asAgent: string,
    words: string,
    profile?: string,
    cursor?: string,
    transcript?: PastWorkTranscriptScope,
  ): Promise<PastWorkSearchResult> {
    const workCursor = cursor !== undefined && /^work:[01]:/u.test(cursor)
    const combined = transcript === undefined || transcript.includeWork === true
    const dates = { from: transcript?.from, to: transcript?.to }
    const preview = combined && cursor === undefined
    if (preview || (combined && workCursor)) {
      const work = await this.searchWork(asAgent, {
        words,
        profile,
        ...dates,
        cursor: cursor?.slice(7),
        limit: 5,
        titlesAndBriefs: true,
      })
      if (!work.ok && (work.reason === 'invalid' || work.reason === 'cursor-invalid'))
        return { ok: false, reason: 'invalid' }
      if (!preview && !work.ok) return { ok: false, reason: 'unavailable' }

      const page = work.ok ? work.page : undefined
      const workUnread =
        cursor?.startsWith('work:1:') === true ||
        page === undefined ||
        page.rows_unread > 0 ||
        page.ledgers_skipped > 0 ||
        (page.next_cursor === null && !page.complete)
      const recorded: PastWorkSearchResult = preview
        ? await this.readPastWork(asAgent, words, profile, undefined, dates, {
            after: null,
            preview: true,
          })
        : { ok: true, hits: [], complete: true, next_cursor: null }
      if (this.launches.closed || (!recorded.ok && page === undefined))
        return { ok: false, reason: 'unavailable' }
      const transcriptCursor = recorded.ok ? recorded.next_cursor : null
      const workHits =
        page?.hits.map((hit) => {
          const task = hit.matched_tasks[0]
          return {
            conversation: hit.conversation,
            piece: task?.piece ?? null,
            label: task?.label ?? hit.address,
            line: hit.line,
            link:
              task === undefined
                ? conversationLink(hit.conversation, hit.address)
                : pieceLink(task.piece, task.label, task.title ?? ''),
            title: task === undefined ? hit.title : task.title,
            state: task?.state ?? '',
            last_active: new Date(hit.last_active_at).toISOString(),
            archived: this.archived.has(hit.conversation),
            matched_field: 'work title or brief' as const,
            snippet: task?.title ?? hit.title,
          }
        }) ?? []
      return {
        ok: true,
        complete: !workUnread && page?.complete === true && recorded.ok && recorded.complete,
        next_cursor:
          page?.next_cursor == null ? null : `work:${workUnread ? 1 : 0}:${page.next_cursor}`,
        ...(transcriptCursor === null ? {} : { transcript_next_cursor: transcriptCursor }),
        ...(recorded.ok && recorded.preview_counts !== undefined
          ? { preview_counts: recorded.preview_counts }
          : {}),
        ...(recorded.ok ? {} : { transcript_unread: true as const }),
        ...(workUnread ? { work_unread: true as const } : {}),
        hits: [...workHits, ...(recorded.ok ? recorded.hits : [])],
      }
    }

    const recentCursor = cursor?.startsWith('recent:') === true
    if (recentCursor) {
      if (combined) return { ok: false, reason: 'invalid' }
      const identity = profile === undefined ? null : agentIdentityRowId(profile)
      const point = pastWorkRecentStart(cursor!, words, identity, dates)
      if (point === undefined) return { ok: false, reason: 'invalid' }
      return this.readPastWork(asAgent, words, profile, undefined, dates, { after: point })
    }
    return this.readPastWork(asAgent, words, profile, cursor, transcript)
  }

  private async readPastWork(
    asAgent: string,
    words: string,
    profile?: string,
    cursor?: string,
    transcript?: PastWorkTranscriptScope,
    recent?: PastWorkSource['recent'],
  ): Promise<PastWorkSearchResult> {
    const wanted = profile === undefined ? null : agentIdentityRowId(profile)
    const after = pastWorkStart(words, wanted, cursor, transcript)
    if (after === undefined) return { ok: false, reason: 'invalid' }
    const source = this.deps.store.pastWorkSearchSource(asAgent, profile, after, recent)
    if (source === null || this.deps.pastWorkSearchReader === undefined || this.launches.closed)
      return { ok: false, reason: 'unavailable' }
    const found = await this.deps.pastWorkSearchReader.read(
      transcript === undefined ? source : { ...source, transcript },
      asAgent,
      words,
    )
    if (this.launches.closed) return { ok: false, reason: 'unavailable' }
    if (!found.ok) return found
    if (this.deps.store.conversationBinding(asAgent) === null)
      return { ok: false, reason: 'unavailable' }
    const sent = new Set(source.versions.map(([conversation]) => conversation))
    const allowed = (conversation: string) => {
      const binding = this.deps.store.conversationBinding(conversation)
      return (
        binding !== null &&
        (wanted === null ||
          (binding.identity !== null && agentIdentityRowId(binding.identity) === wanted))
      )
    }
    if (found.hits.some((hit) => !sent.has(hit.conversation) || !allowed(hit.conversation)))
      return { ok: false, reason: 'unavailable' }
    return {
      ...found,
      hits: found.hits.map((hit) => ({ ...hit, archived: this.archived.has(hit.conversation) })),
    }
  }
}
