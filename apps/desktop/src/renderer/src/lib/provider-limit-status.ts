import type {
  ConversationProviderBlock,
  LastKnownProviderBlock,
  QueuedMessageDisclosure,
} from '../../../shared/runtime-ipc'
import { providerName } from '../../../shared/runtime-ipc'
import type { AgentState } from '../../../shared/agent-state'
import { fullTime } from './clock'
import { resetWords } from './usage-limit'
import { limitsDisplayWords } from './limits-display'

export interface ProviderBlockFacts {
  readonly providerBlock?: ConversationProviderBlock | null
  readonly providerBlockStatus?: 'current' | 'unavailable'
  readonly providerBlockLastKnown?: LastKnownProviderBlock | null
}

export interface ProviderLimitDisplay {
  readonly word: string
  readonly short: string
  readonly detail: string
  readonly history?: string
}

/** Omission is no update; an unavailable reading is never renewed by a retained value. */
export function mergeProviderBlock(
  before: ProviderBlockFacts | null | undefined,
  update: ProviderBlockFacts | null | undefined,
): ProviderBlockFacts {
  const status =
    update?.providerBlockStatus === 'current' && update.providerBlock === undefined
      ? before?.providerBlockStatus
      : (update?.providerBlockStatus ?? before?.providerBlockStatus)
  return {
    ...(before?.providerBlock !== undefined ? { providerBlock: before.providerBlock } : {}),

    ...(update?.providerBlock !== undefined ? { providerBlock: update.providerBlock } : {}),
    ...(status !== undefined ? { providerBlockStatus: status } : {}),
    ...(before?.providerBlockLastKnown !== undefined
      ? { providerBlockLastKnown: before.providerBlockLastKnown }
      : {}),
    ...(update?.providerBlockLastKnown !== undefined
      ? { providerBlockLastKnown: update.providerBlockLastKnown }
      : {}),
  }
}

function historicalStop(facts: ProviderBlockFacts, now: number): string | null {
  const block = facts.providerBlockLastKnown
  if (block == null || !Number.isFinite(now) || !Number.isFinite(block.asOf) || now < block.asOf)
    return null
  const until = block.resetsAt ?? block.asOf + 5 * 60_000
  if (!Number.isFinite(until) || now >= until) return null
  return limitsDisplayWords.lastKnown(block)
}

function resetDetail(block: ConversationProviderBlock, now: number): string | null {
  if (block.resetsAt === null) return null
  const at = fullTime(block.resetsAt)
  if (!at) return null
  return block.resetsAt > now ? `Reported reset: ${at}` : `Reported reset: ${at} (passed)`
}

/** A reset passing is not a host clear. Only future resets add a countdown. */
function countdown(block: ConversationProviderBlock, now: number): string | null {
  return block.resetsAt !== null && block.resetsAt > now ? resetWords(block.resetsAt, now) : null
}

export function providerLimitDisplay(
  facts: ProviderBlockFacts | null | undefined,
  state: AgentState,
  now: number,
): ProviderLimitDisplay | null {
  if (state.is !== 'idle' && state.is !== 'scheduled') return null
  if (facts?.providerBlockStatus === 'unavailable') {
    const history = historicalStop(facts, now)
    return {
      word: 'Current limit status unavailable',
      short: 'Limit unavailable',
      detail: ['The current limit status could not be read.', history].filter(Boolean).join(' · '),
      ...(history === null ? {} : { history }),
    }
  }
  const block = facts?.providerBlock
  if (facts?.providerBlockStatus !== 'current' || block == null) return null
  const stopped = `Stopped: ${providerName(block.provider)}’s limit`
  const reset = countdown(block, now)
  return {
    word: reset === null ? stopped : `${stopped} · ${reset}`,
    short: `${providerName(block.provider)} limit`,
    detail: [stopped, resetDetail(block, now)].filter(Boolean).join(' · '),
  }
}

export interface MessageLimitDisplay extends ProviderLimitDisplay {
  readonly heldWord: string
  readonly heldShort: string
}

/** The full snapshot owns membership; omitted hold fields retain facts only for that same ID. */
export function mergeHeldMessages(
  before: readonly QueuedMessageDisclosure[] | null | undefined,
  incoming: readonly QueuedMessageDisclosure[],
): readonly QueuedMessageDisclosure[]
export function mergeHeldMessages(
  before: readonly QueuedMessageDisclosure[] | null | undefined,
  incoming: null,
): null
export function mergeHeldMessages(
  before: readonly QueuedMessageDisclosure[] | null | undefined,
  incoming: readonly QueuedMessageDisclosure[] | null,
): readonly QueuedMessageDisclosure[] | null
export function mergeHeldMessages(
  before: readonly QueuedMessageDisclosure[] | null | undefined,
  incoming: readonly QueuedMessageDisclosure[] | null,
): readonly QueuedMessageDisclosure[] | null {
  if (incoming === null) return null
  const retained = new Map(before?.map((one) => [one.id, one]))
  return incoming.map((one) => {
    const old = retained.get(one.id)
    const status =
      one.holdReasonStatus === 'current' && one.holdReason === undefined
        ? old?.holdReasonStatus
        : (one.holdReasonStatus ?? old?.holdReasonStatus)
    const reason = one.holdReason !== undefined ? one.holdReason : old?.holdReason
    return {
      ...one,
      holdReason: reason,
      holdReasonStatus: status,
    }
  })
}

/** Reasons belong to live message IDs, never to every message in a stopped conversation. */
export function messageLimitDisplay(
  disclosure: QueuedMessageDisclosure | null | undefined,
  now: number,
): MessageLimitDisplay | null {
  if (disclosure?.holdReasonStatus === 'unavailable') {
    return {
      word: 'not sent · limit status unavailable',
      short: 'not sent · limit unavailable',
      detail: 'The current limit status for this message could not be read.',
      heldWord: 'limit status unavailable',
      heldShort: 'limit unavailable',
    }
  }
  const reason = disclosure?.holdReason
  if (disclosure?.holdReasonStatus !== 'current' || reason == null) return null
  const wait = `not sent · waiting for ${providerName(reason.provider)}’s limit to reset`
  const reset = countdown(reason, now)
  return {
    word: reset === null ? wait : `${wait} · ${reset}`,
    short: `not sent · ${providerName(reason.provider)} limit`,
    heldWord: `waiting for ${providerName(reason.provider)}’s limit to reset${reset === null ? '' : ` · ${reset}`}`,
    heldShort: `${providerName(reason.provider)} limit`,
    detail: [wait, resetDetail(reason, now)].filter(Boolean).join(' · '),
  }
}
