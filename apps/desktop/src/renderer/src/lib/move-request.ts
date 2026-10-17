import type { DecideMoveRequestInput, MoveRequestAck } from '../../../shared/move-request'

/** Navigate only after the host accepts the person's press. */
export async function moveRequestFromWindow(
  input: DecideMoveRequestInput,
  doors: {
    decide(input: DecideMoveRequestInput): Promise<MoveRequestAck>
    open(sessionId: string): Promise<unknown>
    refresh(): Promise<unknown>
  },
): Promise<string | null> {
  const ack = await doors.decide(input)
  if (ack.outcome === 'refused') return ack.reason
  if (ack.outcome === 'moved') await doors.open(ack.sessionId)
  await doors.refresh()
  return null
}
