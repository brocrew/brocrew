import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore, type SessionStore } from '../src/renderer/src/lib/session-store'
import type { RuntimeBridge } from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import { readingOf } from './lib/forest-fixture'

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
    const reading = readingOf([], undefined, {
      readAt: 1234,
      members: { total: 12, admitted: ['neri'] },
      unfolded: ['neri'],
    })
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValueOnce(reading)
    const store = createSessionStore(
      everythingOverTheWire({
        onEvent: () => () => {},
        onLiveness: () => () => {},
        forestReading: read,
      }) as unknown as RuntimeBridge,
    )
    stores.push(store)

    expect(await store.forestReading({ is: 'the-workspace', window: 'day' })).toBeNull()
    expect(await store.forestReading({ is: 'the-workspace', window: 'day' })).toEqual(reading)
  })
})

it('keeps a failed graph page distinct from an empty page', async () => {
  const listing = readingOf([])
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('The page could not be read'))
    .mockResolvedValueOnce({ nodes: readingOf([]).nodes, gone: [], readAt: 55 })
  const store = createSessionStore(
    everythingOverTheWire({
      onEvent: () => () => {},
      onLiveness: () => () => {},
      forestNodes: read,
    }) as unknown as RuntimeBridge,
  )
  stores.push(store)
  expect(await store.forestNodes(listing, ['neri'])).toBeNull()
  expect(await store.forestNodes(listing, ['neri'])).toEqual({
    nodes: readingOf([]).nodes,
    gone: [],
    readAt: 55,
  })
  expect(read).toHaveBeenLastCalledWith(listing, ['neri'])
})
