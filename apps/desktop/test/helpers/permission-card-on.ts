import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { waitFor } from '../lib/host-fixture'

export const permissionCardOn =
  (ledger: (sessionId: string) => TranscriptEvent[]) =>
  async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const card = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (card === undefined) throw new Error('no permission request on the ledger')
    return card.id
  }
