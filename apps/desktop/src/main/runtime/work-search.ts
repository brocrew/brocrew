import { pastWorkStart, type PastWorkSearchResult } from '../../shared/past-work-search'
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
  ): Promise<PastWorkSearchResult> {
    const wanted = profile === undefined ? null : agentIdentityRowId(profile)
    const after = pastWorkStart(words, wanted, cursor)
    if (after === undefined) return { ok: false, reason: 'invalid' }
    const source = this.deps.store.pastWorkSearchSource(asAgent, profile, after)
    if (source === null || this.deps.pastWorkSearchReader === undefined || this.launches.closed)
      return { ok: false, reason: 'unavailable' }
    const found = await this.deps.pastWorkSearchReader.read(source, asAgent, words)
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
