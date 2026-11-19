import type { ContextReading } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { PROVIDER_NAME } from '../../shared/runtime-ipc'
import { howLongAgo } from './what-this-app-adds-to-a-turn'
import type { SendReceipt } from '../../shared/tool-outcome'
import {
  canonicalAddressOf,
  conversationDisplayTitle,
  conversationLine,
} from './conversation-address'

export const THE_ANSWER_ARRIVES_AS_A_MESSAGE = 'The answer arrives as a message.'

type ConversationReads = Parameters<typeof conversationLine>[0]
export interface SendDestination {
  readonly id: string
  readonly address: string
  readonly title: string
  readonly line: string
}

export interface GiveReceiptFacts {
  readonly under: string
  readonly lastActive: number | null
  readonly at: number
  readonly context: ContextReading | null
}

export type SendFacts = Pick<SendReceipt, 'recorded' | 'attachments'> & {
  readonly to: string | SendDestination
  readonly state: SendReceipt['recipient']['state']
  readonly waitsFor?: string | null
  readonly give?: GiveReceiptFacts & {
    readonly startedOn: { provider: Provider; model: string | null; effort: string | null } | null
  }
}

export function sendDestination(reads: ConversationReads, id: string): SendDestination {
  return {
    id,
    address: canonicalAddressOf(reads, id),
    title: conversationDisplayTitle(reads, id),
    line: conversationLine(reads, id),
  }
}

export function sendReceipt(
  facts: SendFacts,
  reads: ConversationReads,
  heldBehindTurn: boolean,
): { readonly receipt: SendReceipt; readonly said: string } {
  const { line, ...to } = typeof facts.to === 'string' ? sendDestination(reads, facts.to) : facts.to
  const receipt: SendReceipt = {
    recorded: facts.recorded,
    recipient: { ...to, state: facts.state },
    attachments: facts.attachments,
  }
  return {
    receipt,
    said: sendReceiptSaid(receipt, line, facts.give, facts.waitsFor ?? null, heldBehindTurn),
  }
}

function sendReceiptSaid(
  receipt: SendReceipt,
  conversation: string,
  give: SendFacts['give'],
  waitsFor: string | null,
  heldBehindTurn: boolean,
): string {
  const { recorded, recipient } = receipt
  const { address, state } = recipient
  if (give !== undefined && state.kind !== 'cannot-run') {
    const parent = `under your ${give.under}`
    const start = give.startedOn
    if (start !== null) {
      const pair = [PROVIDER_NAME[start.provider], start.model, start.effort]
        .filter((part) => part !== null)
        .join(', ')
      return `New task ${recorded.taskLabel} in a new ${conversation}, ${parent}. It started on ${pair}.`
    }
    const active =
      give.lastActive === null ? '' : ` (last active ${howLongAgo(give.lastActive, give.at)})`
    const delivery =
      state.kind === 'started'
        ? 'It started.'
        : (waitsFor ?? 'It is queued: the conversation is working.')
    return `New task ${recorded.taskLabel} in ${conversation}${active}, ${parent}. ${delivery} ${contextSaid(give.context)}`
  }
  if (recorded.kind === 'question' && state.kind !== 'cannot-run') {
    const delivery = state.kind === 'started' ? 'sent to' : 'queued for'
    return `Question ${recorded.id} ${delivery} ${conversation}. ${THE_ANSWER_ARRIVES_AS_A_MESSAGE}`
  }
  if (state.kind === 'started') return `Delivered to ${conversation}.`
  if (state.kind === 'queued') {
    const held = `Held for ${conversation}`
    if (waitsFor !== null) return `${held}. ${waitsFor}`
    return heldBehindTurn ? `${held}: it is working; it goes out when it is free.` : `${held}.`
  }
  const subject = {
    task: `Task ${recorded.taskLabel}`,
    question: `Question ${recorded.id}`,
    message: 'Your message',
    reply: 'Your reply',
  }[recorded.kind]
  if (state.cause.code === 'provider-file-missing') {
    const recovery =
      recorded.kind === 'task'
        ? ` To have the work done, give it with to: "new" and a brief pointing at ${address}, then close task ${recorded.taskLabel}.`
        : recorded.kind === 'question'
          ? ` To get an answer, withdraw ${recorded.id} and ask elsewhere, or read its record.`
          : ''
    const goes = recorded.kind === 'task' ? 'in' : 'for'
    return `${subject} is recorded ${goes} ${conversation}, but that conversation can't run: its session file is missing. Its record is still readable with read_transcript.${recovery}`
  }
  const cause = state.cause.reason
    .replace(/^This conversation did not start: /, '')
    .replace(/\.$/, '')
  const kept = recorded.kind === 'task' ? ' The work is kept.' : ''
  const person = state.needsPerson === true ? ' Ask the person to fix it, with request_action.' : ''
  return `${subject} is recorded in ${conversation}, but it could not start: ${cause}.${kept} Once the cause is fixed, send a message to this address to try starting it again.${person}`
}

function contextSaid(reading: ContextReading | null): string {
  if (reading?.kind === 'proportional') {
    const rounded = Math.round((reading.used / reading.window) * 100)
    return `Context: ${rounded === 0 && reading.used > 0 ? '<1' : String(rounded)}% used.`
  }
  return reading?.kind === 'tokens'
    ? `Context: ${reading.used} tokens used (window size not reported).`
    : 'Context: no current reading.'
}
