import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore, type SessionStore } from '../src/renderer/src/lib/session-store'
import type { RuntimeBridge } from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'

const stores: SessionStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
})

const readers = [
  'questionsForAPerson',
  'decisionsForAPerson',
  'stalledWorkForAPerson',
  'stoppedWorkForAPerson',
  'workIncidentsForAPerson',
  'waitingOnWhoWroteForAPerson',
  'instructionAsksForAPerson',
  'mcpServerRequestsForAPerson',
  'readWorkspace',
  'whatIsBeingDone',
  'whatEachConversationIsWaitingOn',
  'theWholeForest',
  'processMemory',
  'readLimitsDisplay',
] as const

describe('an unavailable host read never claims that the workspace is empty', () => {
  it.each(readers)('%s does not turn a failed read into an all-clear', async (reader) => {
    const failure = vi.fn(async () => {
      throw new Error('The fictional host is restarting')
    })
    const bridge = everythingOverTheWire({
      onEvent: () => () => {},
      onLiveness: () => () => {},
      [reader]: failure,
    }) as unknown as RuntimeBridge
    const store = createSessionStore(bridge)
    stores.push(store)

    expect(await store[reader]()).toBeNull()
    expect(failure).toHaveBeenCalledOnce()
  })

  it('preserves the host’s forest completeness and reading time when it recovers', async () => {
    const reading = {
      readAt: 1234,
      conversations: 12,
      heldByNoAgent: 3,
      nodes: {
        rows: [],
        walk: 'every-conversation-this-app-placed' as const,
        ledgers: 8,
        rowsUnread: 2,
        ledgersSkipped: 1,
      },
    }
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce(reading)
    const store = createSessionStore(
      everythingOverTheWire({
        onEvent: () => () => {},
        onLiveness: () => () => {},
        theWholeForest: read,
      }) as unknown as RuntimeBridge,
    )
    stores.push(store)

    expect(await store.theWholeForest()).toBeNull()
    expect(await store.theWholeForest()).toEqual(reading)
  })
})
