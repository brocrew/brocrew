import type { SendRecipientState } from '../../shared/tool-outcome'
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
  let state: SendRecipientState | null = null
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
    try {
      message.noteSending?.('queued')
    } catch (receiptError) {
      console.warn(
        `message_agent: could not keep the sender receipt: ${errorMessage(receiptError)}`,
      )
    }
    throw error
  }
  message.noteSending?.(state.kind === 'started' ? 'sent' : 'queued')
  return { id: message.id, to: message.to, state }
}
