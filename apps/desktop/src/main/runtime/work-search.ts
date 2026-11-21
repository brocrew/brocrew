import {
  pastWorkStart,
  type PastWorkSearchResult,
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
    const workCursor = cursor !== undefined && /^work:[0-3]:/u.test(cursor)
    if (transcript === undefined && (cursor === undefined || workCursor)) {
      const found = await this.searchWork(asAgent, {
        words,
        profile,
        cursor: cursor?.slice(7),
        limit: 5,
        titlesAndBriefs: true,
      })
      if (this.launches.closed) return { ok: false, reason: 'unavailable' }
      if (!found.ok)
        return {
          ok: false,
          reason:
            found.reason === 'invalid' || found.reason === 'cursor-invalid'
              ? 'invalid'
              : 'unavailable',
        }

      const { page } = found
      const prior = cursor === undefined ? 0 : Number(cursor[5])
      const matched = (prior & 1) !== 0 || page.hits.length > 0
      const unread =
        (prior & 2) !== 0 ||
        page.rows_unread > 0 ||
        page.ledgers_skipped > 0 ||
        (page.next_cursor === null && !page.complete)
      if (page.next_cursor !== null || matched || unread) {
        return {
          ok: true,
          complete: page.complete && !unread,
          next_cursor:
            page.next_cursor === null
              ? null
              : `work:${(matched ? 1 : 0) + (unread ? 2 : 0)}:${page.next_cursor}`,
          hits: page.hits.map((hit) => {
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
              title: hit.title,
              state: task?.state ?? '',
              last_active: new Date(hit.last_active_at).toISOString(),
              archived: this.archived.has(hit.conversation),
              matched_field: 'work title or brief',
              snippet: task?.title ?? hit.title,
            }
          }),
        }
      }
      // The metadata pass finished without a hit or a missing record on any page.
      cursor = undefined
    }

    const wanted = profile === undefined ? null : agentIdentityRowId(profile)
    const after = pastWorkStart(words, wanted, cursor, transcript)
    if (after === undefined) return { ok: false, reason: 'invalid' }
    const source = this.deps.store.pastWorkSearchSource(asAgent, profile, after)
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
