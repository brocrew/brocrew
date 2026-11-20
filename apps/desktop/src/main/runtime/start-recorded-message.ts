import type { MessageRecipientState, SendRecipientState } from '../../shared/tool-outcome'
import type { RecordedAgentMessage } from './message-records'
import { errorMessage } from './session-disclosures'

interface RecordedMessage {
  readonly id: string
  readonly to: string
  readonly noteSending?: (delivery: 'sent' | 'queued') => void
}

export interface StartRecordedMessageDependencies {
  start(): Promise<unknown>
  waitForFlush(): Promise<unknown> | null | undefined
  state(): SendRecipientState
  failedStart(error: unknown): Extract<SendRecipientState, { kind: 'cannot-run' }>
}

/** Start for a message already kept in the recipient's ledger. */
export async function startRecordedMessage(
  message: RecordedMessage,
  deps: StartRecordedMessageDependencies,
): Promise<RecordedAgentMessage> {
  let state: MessageRecipientState | null = null
  try {
    try {
      await deps.start()
    } catch (error) {
      console.warn(
        `message_agent: the start did not happen for ${message.to}: ${errorMessage(error)}`,
      )
      state = deps.failedStart(error)
    }
    if (state === null) await deps.waitForFlush()
    state ??= deps.state()
  } catch (error) {
    console.warn(`message_agent: could not determine delivery: ${errorMessage(error)}`)
    state = { kind: 'delivery-unknown' }
  }
  let senderHistoryUnconfirmed: true | undefined
  if (state.kind !== 'delivery-unknown') {
    try {
      message.noteSending?.(state.kind === 'started' ? 'sent' : 'queued')
    } catch (error) {
      console.warn(`message_agent: could not confirm sender history: ${errorMessage(error)}`)
      senderHistoryUnconfirmed = true
    }
  }
  return {
    id: message.id,
    to: message.to,
    state,
    ...(senderHistoryUnconfirmed ? { senderHistoryUnconfirmed } : {}),
  }
}
