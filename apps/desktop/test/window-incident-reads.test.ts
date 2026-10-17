import { describe, expect, it, vi } from 'vitest'
import { WindowIncidentReads, INCIDENT_READ_LIMIT } from '../src/main/db/window-incident-reads'
import { rowsUnreadOnce, type SessionStore } from '../src/main/db/session-store'
import type { WindowWriterStamp } from '../src/main/db/window-writer-stamp'
import type { LimitsWriterStamp } from '../src/main/db/fresh-limits-snapshot'

function fixture() {
  const writer = {}
  let window: WindowWriterStamp | null = {
    writer,
    watcher: 0,
    revision: 1n,
    dataVersion: 1n,
    schemaVersion: 1n,
    at: 100,
  }
  let content: LimitsWriterStamp | null = { writer, totalChanges: 1n, dataVersion: 1n, at: 100 }
  const cache = new WindowIncidentReads(
    () => window,
    () => content,
  )
  const held = vi.fn<SessionStore['messagesWaitingIn']>(() => [])
  const stop = vi.fn<SessionStore['lastAskToStop']>(() => null)
  const routes = vi.fn(() => [])
  const store = cache.store({
    messagesWaitingIn: held,
    lastAskToStop: stop,
    routedRequestsOf: routes,
  } as unknown as SessionStore)
  return {
    cache,
    store,
    held,
    stop,
    routes,
    window: (value: WindowWriterStamp | null) => {
      window = value
    },
    content: (value: LimitsWriterStamp | null) => {
      content = value
    },
    writer,
  }
}

describe('window incident dependency reuse', () => {
  it('reuses only the two facts in scope, separates owners and row bounds, and isolates mutations', () => {
    const { cache, store, held, stop, routes } = fixture()
    const first = cache.run(() => store.messagesWaitingIn('one'))
    Object.assign(first, { 0: 'a caller changed its array' })
    expect(cache.run(() => store.messagesWaitingIn('one'))).toEqual([])
    cache.run(() => {
      store.messagesWaitingIn('two')
      store.messagesWaitingIn('one', undefined, 1)
      store.lastAskToStop('one')
      store.lastAskToStop('one')
      store.routedRequestsOf('one')
      store.routedRequestsOf('one')
    })
    expect(held).toHaveBeenCalledTimes(3)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(routes).toHaveBeenCalledTimes(2)
    store.messagesWaitingIn('one')
    store.lastAskToStop('one')
    expect(held).toHaveBeenCalledTimes(4)
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it.each(['content', 'external', 'writer', 'routing', 'schema', 'clock'] as const)(
    'invalidates both facts when %s changes',
    (change) => {
      const f = fixture()
      const read = () =>
        f.cache.run(() => {
          f.store.messagesWaitingIn('one')
          f.store.lastAskToStop('one')
        })
      read()
      read()
      expect(f.held).toHaveBeenCalledTimes(1)
      if (change === 'content')
        f.content({ writer: f.writer, totalChanges: 2n, dataVersion: 1n, at: 101 })
      if (change === 'external')
        f.content({ writer: f.writer, totalChanges: 1n, dataVersion: 2n, at: 101 })
      if (change === 'writer') f.content({ writer: {}, totalChanges: 1n, dataVersion: 1n, at: 101 })
      if (change === 'routing')
        f.window({
          writer: f.writer,
          watcher: 0,
          revision: 2n,
          dataVersion: 1n,
          schemaVersion: 1n,
          at: 101,
        })
      if (change === 'schema')
        f.window({
          writer: f.writer,
          watcher: 0,
          revision: 1n,
          dataVersion: 1n,
          schemaVersion: 2n,
          at: 101,
        })
      if (change === 'clock')
        f.content({ writer: f.writer, totalChanges: 1n, dataVersion: 1n, at: 99 })
      read()
      expect(f.held).toHaveBeenCalledTimes(2)
      expect(f.stop).toHaveBeenCalledTimes(2)
    },
  )

  it('clears previous facts when stamps are unavailable and never retains the bypassed read', () => {
    const f = fixture()
    const read = () => f.cache.run(() => f.store.messagesWaitingIn('one'))
    read()
    f.content(null)
    read()
    read()
    f.content({ writer: f.writer, totalChanges: 1n, dataVersion: 1n, at: 101 })
    read()
    read()
    expect(f.held).toHaveBeenCalledTimes(4)
  })

  it.each([7, 'the-whole-ledger'] as const)(
    'never retains unread facts and preserves skip %s',
    (ordinal) => {
      const f = fixture()
      f.held.mockImplementation((id, unread) => {
        unread?.in(id)(ordinal)
        return []
      })
      for (let n = 0; n < 2; n++) {
        const unread = rowsUnreadOnce()
        f.cache.run(() => f.store.messagesWaitingIn('one', unread))
        expect(ordinal === 7 ? unread.count : unread.ledgersSkipped).toBe(1)
      }
      expect(f.held).toHaveBeenCalledTimes(2)
    },
  )

  it('never retains failed or changed-during-read facts', () => {
    const f = fixture()
    const read = () => f.cache.run(() => f.store.lastAskToStop('one'))
    f.stop.mockImplementationOnce(() => {
      throw new Error('fictional read failure')
    })
    expect(read).toThrow('fictional read failure')
    f.stop.mockImplementationOnce(() => {
      f.content({ writer: f.writer, totalChanges: 2n, dataVersion: 1n, at: 101 })
      return null
    })
    read()
    read()
    read()
    expect(f.stop).toHaveBeenCalledTimes(3)
  })

  it('bounds empty entries, and does not inherit the scope in asynchronous continuations', async () => {
    const f = fixture()
    f.cache.run(() => {
      for (let n = 0; n <= INCIDENT_READ_LIMIT.entries; n++) f.store.lastAskToStop(String(n))
    })
    f.stop.mockClear()
    f.cache.run(() => {
      f.store.lastAskToStop('0')
      f.store.lastAskToStop(String(INCIDENT_READ_LIMIT.entries))
    })
    expect(f.stop).toHaveBeenCalledTimes(1)
    await f.cache.run(async () => {
      await Promise.resolve()
      f.store.lastAskToStop(String(INCIDENT_READ_LIMIT.entries))
    })
    expect(f.stop).toHaveBeenCalledTimes(2)
    f.cache.invalidate()
    f.cache.run(() => f.store.lastAskToStop(String(INCIDENT_READ_LIMIT.entries)))
    expect(f.stop).toHaveBeenCalledTimes(3)
  })

  it('does not retain an oversized value, and evicts by the combined byte budget', () => {
    const f = fixture()
    const message = (text: string): ReturnType<SessionStore['messagesWaitingIn']> => [
      { messageId: 'fictional', kind: 'work', text, attachments: [], authorship: {}, at: 1 },
    ]
    f.held.mockReturnValue(message('x'.repeat(INCIDENT_READ_LIMIT.bytes)))
    f.cache.run(() => f.store.messagesWaitingIn('large'))
    f.cache.run(() => f.store.messagesWaitingIn('large'))
    expect(f.held).toHaveBeenCalledTimes(2)
    f.held.mockReturnValue(message('x'.repeat(INCIDENT_READ_LIMIT.bytes / 2)))
    f.cache.run(() => f.store.messagesWaitingIn('one'))
    f.cache.run(() => f.store.messagesWaitingIn('two'))
    f.cache.run(() => f.store.messagesWaitingIn('one'))
    expect(f.held).toHaveBeenCalledTimes(5)
  })
})
