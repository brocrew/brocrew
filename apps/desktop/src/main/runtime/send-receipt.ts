import type { SendReceipt } from '../../shared/tool-outcome'
import { canonicalAddressOf, conversationDisplayTitle, conversationLine } from './conversation-address'

type ConversationReads = Parameters<typeof conversationLine>[0]

export type SendFacts = Pick<SendReceipt, 'recorded' | 'attachments'> & {
  readonly to: string
  readonly profile: string
  readonly state: SendReceipt['recipient']['state']
}

export function sendReceipt(
  facts: SendFacts,
  reads: ConversationReads,
): { readonly receipt: SendReceipt; readonly said: string } {
  const address = canonicalAddressOf(reads, facts.to)
  const title = conversationDisplayTitle(reads, facts.to)
  const receipt: SendReceipt = {
    recorded: facts.recorded,
    recipient: { id: facts.to, address, title, state: facts.state },
    attachments: facts.attachments,
  }
  const conversation = conversationLine(reads, facts.to)
  const recipient = `${facts.profile} at ${conversation}`
  const task = `Task ${facts.recorded.taskLabel}`
  const { state } = facts
  if (state.kind === 'started') return { receipt, said: `${task} sent to ${recipient}.` }
  if (state.kind === 'queued') return { receipt, said: `${task} held for ${recipient}.` }
  const cause = state.cause.reason.replace(/^This conversation did not start: /, '').replace(/\.$/, '')
  if (state.cause.code === 'provider-file-missing') {
    return {
      receipt,
      said: `${task} is recorded in ${conversation}, but that conversation can't run: its session file is missing. Its record is still readable with read_transcript.`,
    }
  }
  const person = state.needsPerson === true ? ' Ask the person to fix it, with request_action.' : ''
  return {
    receipt,
    said: `${task} is recorded in ${conversation}, but it could not start: ${cause}. The work is kept. Once the cause is fixed, send a message to this address to try starting it again.${person}`,
  }
}
