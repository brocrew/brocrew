import { describe, expect, it, vi } from 'vitest'
import { LinkAnswers, LINK_ANSWER_LIMIT } from '../src/main/runtime/link-answers'
import type { WindowWriterStamp } from '../src/main/db/window-writer-stamp'
import type { LimitsWriterStamp } from '../src/main/db/fresh-limits-snapshot'
import type { ReadLinkAnswer } from '../src/main/runtime/link-answers'

const available = (title = 'Fictional plan'): ReadLinkAnswer => ({
  answer: {
    state: 'available',
    kind: 'conversation',
    title,
    status: 'idle',
    opens: { sessionId: 'fictional' },
  },
})
function fixture() {
  const writer = {}
  let at = 100
  let window: WindowWriterStamp | null = {
    writer,
    watcher: 0,
    revision: 1n,
    dataVersion: 1n,
    schemaVersion: 1n,
    at,
  }
  let content: LimitsWriterStamp | null = { writer, totalChanges: 1n, dataVersion: 1n, at }
  return {
    cache: new LinkAnswers(
      () => window,
      () => content,
      () => at,
    ),
    window: (value: WindowWriterStamp | null) => {
      window = value
    },
    content: (value: LimitsWriterStamp | null) => {
      content = value
    },
    advance: (value: number) => {
      at = value
    },
    writer,
  }
}

describe('cached link answers', () => {
  it('reuses a target, keeps callers from mutating it, and drops all targets on local changes', () => {
    const { cache } = fixture()
    const read = vi.fn(() => available())
    const first = cache.read('one', read)
    expect(first.opens).toEqual({ sessionId: 'fictional' })
    Object.assign(first.opens!, { sessionId: 'wrong' })
    expect(cache.read('one', read)).toEqual(available().answer)
    cache.read('two', read)
    expect(read).toHaveBeenCalledTimes(2)
    cache.invalidate()
    cache.read('one', read)
    cache.read('two', read)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it.each(['routing', 'title', 'external', 'writer', 'schema'])(
    'drops retained answers after a %s stamp change',
    (change) => {
      const f = fixture()
      const read = vi.fn(() => available())
      f.cache.read('one', read)
      f.cache.read('two', read)
      if (change === 'title')
        f.content({ writer: f.writer, totalChanges: 2n, dataVersion: 1n, at: 101 })
      else if (change === 'external')
        f.content({ writer: f.writer, totalChanges: 1n, dataVersion: 2n, at: 101 })
      else
        f.window({
          writer: change === 'writer' ? {} : f.writer,
          watcher: 0,
          revision: change === 'routing' ? 2n : 1n,
          dataVersion: 1n,
          schemaVersion: change === 'schema' ? 2n : 1n,
          at: 101,
        })
      f.cache.read('one', read)
      f.cache.read('two', read)
      expect(read).toHaveBeenCalledTimes(4)
    },
  )

  it.each(['window', 'content'] as const)(
    'neither reuses nor publishes with an absent %s stamp',
    (stamp) => {
      const f = fixture()
      const read = vi.fn(() => available())
      f.cache.read('one', read)
      f[stamp](null)
      f.cache.read('one', read)
      f.cache.read('one', read)
      expect(read).toHaveBeenCalledTimes(3)
    },
  )

  it('does not publish a read whose writer changed or was invalidated while composing', () => {
    const f = fixture()
    let count = 0
    f.cache.read('one', () => {
      count++
      f.content({ writer: f.writer, totalChanges: 2n, dataVersion: 1n, at: 101 })
      return available('Before the change')
    })
    f.cache.read('one', () => {
      count++
      f.cache.invalidate()
      return available('During invalidation')
    })
    expect(
      f.cache.read('one', () => {
        count++
        return available('Current')
      }).title,
    ).toBe('Current')
    expect(count).toBe(3)
  })

  it('does not retain failed reads', () => {
    const { cache } = fixture()
    cache.read('one', () => ({ ...available('Unread'), cacheable: false }))
    expect(cache.read('one', () => available('Recovered')).title).toBe('Recovered')
  })

  it('expires a scheduled answer at its next due time and after a clock moves backward', () => {
    const f = fixture()
    const read = vi.fn(() => ({ ...available(), state: { is: 'scheduled' as const, dueAt: 200 } }))
    f.cache.read('one', read)
    f.advance(199)
    f.cache.read('one', read)
    expect(read).toHaveBeenCalledTimes(1)
    f.advance(200)
    f.cache.read('one', read)
    expect(read).toHaveBeenCalledTimes(2)
    f.advance(99)
    f.cache.read('one', read)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('retains at most 512 targets and evicts the least recently used one', () => {
    const { cache } = fixture()
    const read = vi.fn(() => available())
    for (let at = 0; at < LINK_ANSWER_LIMIT; at++) cache.read(String(at), read)
    cache.read('0', read)
    cache.read('extra', read)
    cache.read('0', read)
    expect(read).toHaveBeenCalledTimes(513)
    cache.read('1', read)
    expect(read).toHaveBeenCalledTimes(514)
    expect(LINK_ANSWER_LIMIT).toBe(512)
  })
})
