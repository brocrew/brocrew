import type { CompactResult, SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

export interface CompactionRequest {
  readonly agent: string
  /** Why it was asked, when the caller gave a reason. */
  readonly reason?: string
}

export interface CompactConversationInput extends CompactionRequest {
  readonly conversation: string
}

export type CompactConversationOutcome =
  | {
      readonly ok: true
      readonly conversation: string
      readonly display: string
      readonly queued?: true
      readonly afterTurn?: true
      readonly empty?: true
      /** What the provider said about the request, shown as it is. */
      readonly note?: string
    }
  | {
      readonly ok: false
      readonly refusal: 'compaction-not-possible'
      readonly conversation: string
      readonly display: string
      readonly reason: string
    }
  | { readonly ok: false; readonly refusal: 'no-such-agent'; readonly conversation: string }
  | {
      readonly ok: false
      readonly refusal: 'compaction-target-not-running' | 'compaction-target-busy'
      readonly conversation: string
      readonly display: string
    }
  | {
      readonly ok: false
      readonly refusal: 'compaction-request-failed'
      readonly conversation: string
      readonly display: string
      readonly provider?: Provider
    }

interface CompactionTarget {
  readonly provider: Provider
  readonly handle: Pick<SessionHandle, 'compact'>
}

export interface CompactConversationDependencies<Target extends CompactionTarget> {
  currentConversation(conversation: string): string
  running(conversation: string): Target | null
  recorded(conversation: string): boolean
  queue(
    conversation: string,
    request: CompactionRequest,
  ): 'queued' | 'after-turn' | 'empty' | 'unavailable' | false
  deferred(target: Target): boolean
  display(conversation: string): string
  idle(target: Target): boolean
  checkSignIn(target: Target): Promise<void>
  request(
    target: Target,
    requestedBy: CompactionRequest,
    run: () => Promise<CompactResult>,
  ): Promise<CompactResult>
  reportFailure(conversation: string, error: unknown): void
}

export async function compactConversation<Target extends CompactionTarget>(
  input: CompactConversationInput,
  deps: CompactConversationDependencies<Target>,
): Promise<CompactConversationOutcome> {
  const conversation = deps.currentConversation(input.conversation)
  const target = deps.running(conversation)
  if (target === null && !deps.recorded(conversation)) {
    return { ok: false, refusal: 'no-such-agent', conversation }
  }
  const said = { conversation, display: deps.display(conversation) }
  const queue = (): CompactConversationOutcome => {
    try {
      const queued = deps.queue(conversation, {
        agent: input.agent,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      if (queued === 'queued' || queued === 'after-turn')
        return {
          ok: true,
          queued: true,
          ...(queued === 'after-turn' ? { afterTurn: true as const } : {}),
          ...said,
        }
      if (queued === 'empty') return { ok: true, empty: true, ...said }
      if (queued === 'unavailable')
        return { ok: false, refusal: 'compaction-target-not-running', ...said }
    } catch (error) {
      deps.reportFailure(conversation, error)
      return { ok: false, refusal: 'compaction-request-failed', ...said }
    }
    return { ok: false, refusal: 'compaction-target-busy', ...said }
  }
  if (target === null) return queue()
  if (deps.deferred(target)) return queue()
  if (!deps.idle(target)) return queue()

  try {
    await deps.checkSignIn(target)
    if (deps.running(conversation) !== target) {
      return { ok: false, refusal: 'compaction-target-busy', ...said }
    }
    if (!deps.idle(target)) return queue()
    const result = await deps.request(
      target,
      { agent: input.agent, ...(input.reason === undefined ? {} : { reason: input.reason }) },
      () => target.handle.compact(input.reason),
    )
    if (!result.compacted) {
      return { ok: false, refusal: 'compaction-not-possible', reason: result.reason, ...said }
    }
    return { ok: true, ...(result.note === undefined ? {} : { note: result.note }), ...said }
  } catch (error) {
    deps.reportFailure(conversation, error)
    return { ok: false, refusal: 'compaction-request-failed', provider: target.provider, ...said }
  }
}
