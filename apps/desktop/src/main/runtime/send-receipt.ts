import type { ContextReading } from '@brobot2/runtime'
import type { SendReceipt, SendRecipientState } from '../../shared/tool-outcome'
import { conversationLine, describeConversation } from '../db/conversation-address'
import { errorMessage } from './session-disclosures'
import { howLongAgo } from './what-this-app-adds-to-a-turn'

export const THE_ANSWER_ARRIVES_AS_A_MESSAGE = 'The answer arrives as a message.'

type ConversationReads = Parameters<typeof describeConversation>[0]

type DeliveryFacts = Pick<SendReceipt, 'attachments'> & {
  readonly to: string
  readonly senderHistoryUnconfirmed?: true
}

type Recorded = SendReceipt['recorded']
export type SendFacts = DeliveryFacts &
  (
    | {
        readonly recorded: Recorded & { readonly kind: 'task' }
        readonly state: SendRecipientState
        readonly profile: string
        readonly targetKind: 'new' | 'continued'
        readonly lastActiveAt?: number | null
        /** When this receipt is written, to say how long ago the conversation was last active. */
        readonly readAt?: number
        readonly context?: ContextReading | null
      }
    | {
        readonly recorded: Recorded & { readonly kind: 'message' | 'question' | 'reply' }
        readonly state: SendReceipt['recipient']['state']
        readonly waitsFor?: string | null
        readonly heldBehindTurn?: boolean
      }
  )

export function sendReceipt(
  facts: SendFacts,
  reads: ConversationReads,
  service: boolean,
): { readonly receipt: SendReceipt; readonly said: string } {
  return assembleReceipt(facts, describeConversation(reads, facts.to, service))
}

type RecordedMessageFacts = Exclude<SendFacts, { readonly profile: string }> & {
  readonly recorded: Recorded & { readonly kind: 'message' }
}

/** Render a receipt for a Message whose recording and delivery facts are already known. */
export function receiptForRecordedMessage(
  facts: RecordedMessageFacts,
  render: () => ReturnType<typeof sendReceipt>,
): ReturnType<typeof sendReceipt> {
  try {
    return render()
  } catch (error) {
    console.warn(`message_agent: could not describe its recorded receipt: ${errorMessage(error)}`)
    const title = 'title unavailable'
    const description = { address: facts.to, title, line: conversationLine(facts.to, title) }
    const result = assembleReceipt(facts, description)
    if (
      (facts.state.kind === 'started' || facts.state.kind === 'queued') &&
      facts.senderHistoryUnconfirmed !== true
    ) {
      return {
        ...result,
        said: `Your message ${facts.recorded.id} is recorded. ${result.said}`,
      }
    }
    return result
  }
}

function assembleReceipt(
  facts: SendFacts,
  { address, title, line: conversation }: ReturnType<typeof describeConversation>,
): { readonly receipt: SendReceipt; readonly said: string } {
  const receipt: SendReceipt = {
    recorded: facts.recorded,
    recipient: { id: facts.to, address, title, state: facts.state },
    attachments: facts.attachments,
    ...(facts.senderHistoryUnconfirmed ? { senderHistoryUnconfirmed: true } : {}),
  }
  if (!('profile' in facts)) {
    let said = outboundReceiptSaid(facts, address, conversation)
    if (facts.senderHistoryUnconfirmed) {
      if (facts.state.kind === 'started' || facts.state.kind === 'queued') {
        said = `Your message ${facts.recorded.id} is recorded. ${said}`
      }
      said += " The sender's history could not be confirmed."
    }
    return { receipt, said }
  }
  const { recorded, state } = facts
  const task = `Task ${recorded.taskLabel}`
  const target = facts.targetKind === 'new' ? 'a new' : 'the existing'
  const lastActive =
    facts.targetKind === 'continued' && facts.lastActiveAt != null && facts.readAt !== undefined
      ? `, last active ${howLongAgo(facts.lastActiveAt, facts.readAt)}`
      : ''
  if (state.kind === 'started' || state.kind === 'queued') {
    const delivery = state.kind === 'started' ? 'sent to' : 'held for'
    return {
      receipt,
      said: `${task} ${delivery} ${facts.profile} in ${target} ${conversation}${lastActive}. ${contextInTheReceipt(facts.context)}`,
    }
  }
  const cause = state.cause.reason
    .replace(/^This conversation did not start: /, '')
    .replace(/\.$/, '')
  const activity =
    facts.targetKind === 'continued' && lastActive === ''
      ? ', last active time unknown'
      : lastActive
  if (state.cause.code === 'provider-file-missing') {
    const giveAgain =
      facts.targetKind === 'new'
        ? 'give it again with to: "new"'
        : `give it with to: "new" and a brief pointing at ${address}`
    return {
      receipt,
      said: `${task} is recorded in ${target} ${conversation}${activity}, but that conversation can't run: its session file is missing. Its record is still readable with read_transcript. To have the work done, ${giveAgain}, then close task ${recorded.taskLabel}. ${contextInTheReceipt(facts.context)}`,
    }
  }
  const person = state.needsPerson === true ? ' Ask the person to fix it, with request_action.' : ''
  return {
    receipt,
    said: `${task} is recorded in ${target} ${conversation}${activity}, but it could not start: ${cause}. The work is kept. Once the cause is fixed, send a message to this address to try starting it again.${person} ${contextInTheReceipt(facts.context)}`,
  }
}

function contextInTheReceipt(reading: ContextReading | null | undefined): string {
  if (reading == null || reading.kind === 'unknown') return 'Context: no current reading.'
  if (reading.kind === 'tokens') {
    const used = Math.round(reading.used).toLocaleString('en-US')
    return `Context: ${used} tokens used (window size not reported).`
  }
  const rounded = Math.round((100 * reading.used) / reading.window)
  const percent = rounded === 0 && reading.used > 0 ? '<1' : String(rounded)
  return `Context: ${percent}% used.`
}

function outboundReceiptSaid(
  facts: Exclude<SendFacts, { readonly profile: string }>,
  address: string,
  conversation: string,
): string {
  const { recorded, state, waitsFor, heldBehindTurn } = facts
  const isQuestion = recorded.kind === 'question'
  const subject = isQuestion
    ? `Question ${recorded.id}`
    : recorded.kind === 'reply'
      ? 'Your reply'
      : `Your message ${recorded.id}`
  if (state.kind === 'delivery-unknown') {
    return `${subject} is recorded for ${conversation}. Delivery could not be determined.`
  }
  if (state.kind === 'cannot-run') {
    if (state.cause.code === 'provider-file-missing') {
      const recovery = isQuestion
        ? ` To get an answer, withdraw ${recorded.id} and ask elsewhere, or read its record.`
        : ''
      return `${subject} is recorded for ${conversation}, but that conversation can't run: its session file is missing. Its record is still readable with read_transcript.${recovery}`
    }
    const cause = state.cause.reason
      .replace(/^This conversation did not start: /, '')
      .replace(/\.$/, '')
    const person =
      state.needsPerson === true ? ' Ask the person to fix it, with request_action.' : ''
    return `${subject} is recorded for ${conversation}, but it could not start: ${cause}. Once the cause is fixed, send a message to ${address} to try starting it again.${person}`
  }
  if (isQuestion) {
    const went = state.kind === 'started' ? 'sent to' : 'queued for'
    return `${subject} ${went} ${conversation}. ${THE_ANSWER_ARRIVES_AS_A_MESSAGE}`
  }
  if (state.kind === 'started') return `Delivered to ${conversation}.`
  const held = `Held for ${conversation}`
  if (waitsFor != null) return `${held}. ${waitsFor}`
  return heldBehindTurn === true
    ? `${held}: it is working; it goes out when it is free.`
    : `${held}.`
}
