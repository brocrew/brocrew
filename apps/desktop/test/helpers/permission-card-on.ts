import type { SessionStore } from '../../src/main/db/session-store'
import type { PieceRow } from '../../src/shared/task-contracts'
import type { RuntimeHost, RuntimeEventSink } from '../../src/main/runtime/runtime-host'
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

/** Allow the existing permission and wait for its provider turn terminal. */
export async function finishPermissionTurn(
  ledger: (sessionId: string) => TranscriptEvent[],
  host: Pick<RuntimeHost, 'claimSession' | 'respondPermission'>,
  window: RuntimeEventSink,
  claimed: Set<string>,
  sessionId: string,
): Promise<void> {
  const before = ledger(sessionId).filter((event) => event.type === 'turn').length
  const id = await permissionCardOn(ledger)(sessionId)
  if (!claimed.has(sessionId)) {
    host.claimSession(sessionId, window)
    claimed.add(sessionId)
  }
  await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
  await waitFor(
    () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
    'the turn to reach its own terminal',
  )
}

/** Readers follow the current host and store when a fixture rebuilds them. */
export function permissionTurnFixture(
  current: () => {
    store: SessionStore
    host: Pick<RuntimeHost, 'claimSession' | 'respondPermission'>
    window: RuntimeEventSink
    claimed: Set<string>
  },
) {
  const ledger = (sessionId: string): TranscriptEvent[] =>
    current()
      .store.events(sessionId)
      .map((entry) => entry.event)
  const finish = (sessionId: string): Promise<void> => {
    const { host, window, claimed } = current()
    return finishPermissionTurn(ledger, host, window, claimed, sessionId)
  }
  const pieceGivenTo = (worker: string): PieceRow => {
    const row = current().store.piecesOwnedBy(worker).at(-1)
    if (row === undefined) throw new Error(`no piece in ${worker}`)
    return row
  }
  return { ledger, finish, pieceGivenTo }
}
