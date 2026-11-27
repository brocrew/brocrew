import type { UserInputResponse } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime/testing'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { waitFor } from '../lib/f093-host'

/**
 * Raises a question on a child exactly as its provider would, then waits until the app has decided
 * where it goes. The first wait keeps a routing that never happened apart from a request that never
 * reached the ledger; without it both would fail identically.
 */
export const nativeQuestionOn =
  (ledger: (sessionId: string) => TranscriptEvent[]) =>
  async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
    extra: { secret?: boolean } = {},
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    const raised = handle.simulateUserInput(prompt, options, false, extra)
    await waitFor(
      () => ledger(child).some((event) => event.type === 'user_input_request'),
      `the request ${raised.id} to reach ${child}'s ledger`,
    )
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
  }
