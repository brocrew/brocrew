import type { SendReceipt } from '../../shared/tool-outcome'
import { describeConversation } from './conversation-address'

export const THE_ANSWER_ARRIVES_AS_A_MESSAGE = 'The answer arrives as a message.'

type ConversationReads = Parameters<typeof describeConversation>[0]

type DeliveryFacts = Pick<SendReceipt, 'attachments'> & {
  readonly to: string
  readonly state: SendReceipt['recipient']['state']
}

type Recorded = SendReceipt['recorded']
export type SendFacts = DeliveryFacts &
  (
    | { readonly recorded: Recorded & { readonly kind: 'task' }; readonly profile: string }
    | {
        readonly recorded: Recorded & { readonly kind: 'message' | 'question' }
        readonly waitsFor?: string | null
        readonly heldBehindTurn?: boolean
      }
  )

export function sendReceipt(
  facts: SendFacts,
  reads: ConversationReads,
  service: boolean,
): { readonly receipt: SendReceipt; readonly said: string } {
  const { address, title, line: conversation } = describeConversation(reads, facts.to, service)
  const receipt: SendReceipt = {
    recorded: facts.recorded,
    recipient: { id: facts.to, address, title, state: facts.state },
    attachments: facts.attachments,
  }
  const { recorded, state } = facts
  if (!('profile' in facts)) {
    return { receipt, said: outboundReceiptSaid(facts, address, conversation) }
  }
  const recipient = `${facts.profile} at ${conversation}`
  const task = `Task ${recorded.taskLabel}`
  if (state.kind === 'started') return { receipt, said: `${task} sent to ${recipient}.` }
  if (state.kind === 'queued') return { receipt, said: `${task} held for ${recipient}.` }
  const cause = state.cause.reason
    .replace(/^This conversation did not start: /, '')
    .replace(/\.$/, '')
  if (state.cause.code === 'provider-file-missing') {
    return {
      receipt,
      said: `${task} is recorded in ${conversation}, but that conversation can't run: its session file is missing. Its record is still readable with read_transcript. To have the work done, give it with to: "new" and a brief pointing at ${address}, then close task ${facts.recorded.taskLabel}.`,
    }
  }
  const person = state.needsPerson === true ? ' Ask the person to fix it, with request_action.' : ''
  return {
    receipt,
    said: `${task} is recorded in ${conversation}, but it could not start: ${cause}. The work is kept. Once the cause is fixed, send a message to this address to try starting it again.${person}`,
  }
}

function outboundReceiptSaid(
  facts: Exclude<SendFacts, { readonly profile: string }>,
  address: string,
  conversation: string,
): string {
  const { recorded, state, waitsFor, heldBehindTurn } = facts
  const isQuestion = recorded.kind === 'question'
  const subject = isQuestion ? `Question ${recorded.id}` : 'Your message'
  if (state.kind === 'cannot-run') {
    if (state.cause.code === 'provider-file-missing') {
      const recovery = isQuestion
        ? ` To get an answer, withdraw ${recorded.id} and ask elsewhere, or read its record.`
        : ''
      return `${subject} is recorded for ${conversation}, but that conversation can't run: its session file is missing. Its record is still readable with read_transcript.${recovery}`
    }
    const cause = state.cause.reason.replace(/^This conversation did not start: /, '').replace(/\.$/, '')
    const person = state.needsPerson === true ? ' Ask the person to fix it, with request_action.' : ''
    return `${subject} is recorded for ${conversation}, but it could not start: ${cause}. Once the cause is fixed, send a message to ${address} to try starting it again.${person}`
  }
  if (isQuestion) {
    const went = state.kind === 'started' ? 'sent to' : 'queued for'
    return `${subject} ${went} ${conversation}. ${THE_ANSWER_ARRIVES_AS_A_MESSAGE}`
  }
  if (state.kind === 'started') return `Delivered to ${conversation}.`
  const held = `Held for ${conversation}`
  if (waitsFor != null) return `${held}. ${waitsFor}`
  return heldBehindTurn === true ? `${held}: it is working; it goes out when it is free.` : `${held}.`
}
