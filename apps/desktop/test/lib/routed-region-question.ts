import type { FakeSessionHandle } from '@brobot2/runtime/testing'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { waitFor } from './f093-host'

export async function raiseRegionQuestion(
  handle: FakeSessionHandle,
  readLedger: () => readonly TranscriptEvent[],
) {
  const question = handle.simulateUserInput('which region?', ['eu', 'us'], false)
  await waitFor(
    () =>
      readLedger().some(
        (event) => event.type === 'request_routed' && event.requestId === question.id,
      ),
    'the routing of the question',
  )
  return question
}
