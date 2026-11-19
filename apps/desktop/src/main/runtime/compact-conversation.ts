import type { ProviderCommandSet, SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

export interface CompactionRequest {
  readonly agent: string
  readonly reason: string
}

export interface CompactConversationInput extends CompactionRequest {
  readonly conversation: string
}

export type CompactConversationOutcome =
  | { readonly ok: true; readonly conversation: string; readonly display: string }
  | { readonly ok: false; readonly refusal: 'no-such-agent'; readonly conversation: string }
  | {
      readonly ok: false
      readonly refusal: 'compaction-target-not-running' | 'compaction-target-busy'
      readonly conversation: string
      readonly display: string
    }
  | {
      readonly ok: false
      readonly refusal: 'compaction-unavailable' | 'compaction-request-failed'
      readonly conversation: string
      readonly display: string
      readonly provider: Provider
    }

interface CompactionTarget {
  readonly provider: Provider
  readonly handle: Pick<SessionHandle, 'compact' | 'send'>
}

export interface CompactConversationDependencies<Target extends CompactionTarget> {
  currentConversation(conversation: string): string
  running(conversation: string): Target | null
  recorded(conversation: string): boolean
  display(conversation: string): string
  idle(target: Target): boolean
  checkSignIn(target: Target): Promise<void>
  providerCommands(target: Target): Promise<ProviderCommandSet | null>
  request(target: Target, requestedBy: CompactionRequest, run: () => Promise<void>): Promise<void>
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
  if (target === null) return { ok: false, refusal: 'compaction-target-not-running', ...said }
  if (!deps.idle(target)) return { ok: false, refusal: 'compaction-target-busy', ...said }

  try {
    await deps.checkSignIn(target)
    const run = await nativeCompaction(target, deps)
    if (deps.running(conversation) !== target) {
      return { ok: false, refusal: 'compaction-target-not-running', ...said }
    }
    if (!deps.idle(target)) return { ok: false, refusal: 'compaction-target-busy', ...said }
    if (run === null) {
      return { ok: false, refusal: 'compaction-unavailable', provider: target.provider, ...said }
    }
    await deps.request(target, { agent: input.agent, reason: input.reason }, run)
    return { ok: true, ...said }
  } catch (error) {
    deps.reportFailure(conversation, error)
    return { ok: false, refusal: 'compaction-request-failed', provider: target.provider, ...said }
  }
}

async function nativeCompaction<Target extends CompactionTarget>(
  target: Target,
  deps: Pick<CompactConversationDependencies<Target>, 'providerCommands'>,
): Promise<(() => Promise<void>) | null> {
  const { handle } = target
  if (handle.compact !== undefined) return handle.compact.bind(handle)
  if (target.provider !== 'claude') return null

  const catalogue = await deps.providerCommands(target)
  if (
    catalogue?.prefix !== '/' ||
    !catalogue.commands.some((command) => command.name === 'compact' && command.skill === undefined)
  ) {
    return null
  }
  // The app invokes the listed built-in as a command. Its caller is reported after confirmation.
  return () => handle.send('/compact')
}
