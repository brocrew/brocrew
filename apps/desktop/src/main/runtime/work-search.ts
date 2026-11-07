import type { PastWorkSearchResult } from '../../shared/past-work-search'
import type { WorkSearchQuery, WorkSearchResult } from '../../shared/work-search'
import type { ArchivedConversations } from '../archived-file'
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

  async searchPastWork(asAgent: string, words: string): Promise<PastWorkSearchResult> {
    const source = this.deps.store.pastWorkSearchSource(asAgent)
    if (source === null || this.deps.pastWorkSearchReader === undefined || this.launches.closed)
      return { ok: false, reason: 'unavailable' }
    const found = await this.deps.pastWorkSearchReader.read(source, asAgent, words)
    if (this.launches.closed) return { ok: false, reason: 'unavailable' }
    if (!found.ok) return found
    const current = this.deps.store.pastWorkSearchSource(asAgent)
    if (current === null || current.profile !== source.profile)
      return { ok: false, reason: 'unavailable' }
    const allowed = new Set(current.versions.map(([conversation]) => conversation))
    if (found.hits.some((hit) => !allowed.has(hit.conversation)))
      return { ok: false, reason: 'unavailable' }
    return {
      ok: true,
      hits: found.hits.map((hit) => ({ ...hit, archived: this.archived.has(hit.conversation) })),
    }
  }
}
