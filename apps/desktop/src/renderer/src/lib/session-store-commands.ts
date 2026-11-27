import type { ClientSessionApi } from '../../../shared/client-session-api'
import type { ProviderAnswerAck } from '../../../shared/runtime-ipc'
import type { createLiveSessionRecords } from './live-session-records'
import type { SessionRecord } from './session-record'

/** What the store's command groups share from the store: the bridge, the records and the command runners. */
export interface SessionCommands {
  readonly bridge: ClientSessionApi
  readonly sessions: ReturnType<typeof createLiveSessionRecords>['sessions']
  readonly approvalChoices: Map<
    string,
    {
      requested: 'ask' | 'auto'
      nativePending: 'ask' | 'auto' | null
    }
  >
  forSession<T>(
    sessionId: string,
    action: (record: SessionRecord) => Promise<T>,
  ): Promise<{ ok: boolean; value?: T }>
  forSessionSaying<T>(
    sessionId: string,
    action: (record: SessionRecord) => Promise<T>,
  ): Promise<{ value?: T; refused: unknown }>
  noteFailure(record: SessionRecord, cause: unknown): void
  markSent(sessionId: string, requestId: string): void
  sendAnswer(
    sessionId: string,
    requestId: string,
    ask: () => Promise<ProviderAnswerAck>,
  ): Promise<string | null>
  noteAnswer(
    sessionId: string,
    requestId: string,
    ok: boolean,
    ack: ProviderAnswerAck | undefined,
  ): void
}
