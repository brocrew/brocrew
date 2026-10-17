import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitsReaderLifetime, type LimitsReader } from '../src/main/db/limits-reader-lifetime'
import {
  LimitsReadUnavailable,
  type LimitsReadInput,
  type LimitsReadResult,
} from '../src/main/db/limits-read-protocol'

const context = { capturedAt: 10, signInChangedAt: {}, usage: {} }
function result(input: LimitsReadInput): LimitsReadResult {
  const walk = {
    walk: 'every-provider-wall-recently-recorded' as const,
    rows: [],
    ledgers: 0,
    rowsUnread: 0,
  }
  return {
    operation: input.operation,
    databaseEpoch: input.databaseEpoch,
    signInEpoch: input.signInEpoch,
    inputCapturedAt: input.capturedAt,
    readStartedAt: 11,
    snapshotPinStartedAt: 11,
    snapshotPinnedAt: 12,
    evaluatedAt: 13,
    readFinishedAt: 14,
    canonical: walk,
    display: walk,
    measured: { rows: 0, bytes: 0, statements: 1 },
  }
}

class Reader implements LimitsReader {
  readonly calls: LimitsReadInput[] = []
  readonly stop = vi.fn(() => this.whenExited)
  private exit!: () => void
  private resolve!: (result: LimitsReadResult) => void
  private reject!: (error: unknown) => void
  readonly whenExited = new Promise<void>((resolve) => {
    this.exit = resolve
  })
  constructor(readonly file: string) {}
  execute(input: LimitsReadInput) {
    this.calls.push(input)
    return new Promise<LimitsReadResult>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
  finish() {
    this.resolve(result(this.calls.at(-1)!))
  }
  died() {
    this.reject?.(new LimitsReadUnavailable('failed'))
    this.exit()
  }
}

describe('limits reader lifetime fences caller scope and native ownership', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  function setup() {
    const readers: Reader[] = []
    const changed = vi.fn()
    const start = vi.fn((file: string) => {
      const reader = new Reader(file)
      readers.push(reader)
      return reader
    })
    return {
      readers,
      start,
      changed,
      lifetime: new LimitsReaderLifetime('first.sqlite', start, changed),
    }
  }
  const tick = () => vi.advanceTimersByTimeAsync(0)

  it('keeps one connection and starts a fresh read after each completed demand', async () => {
    const { lifetime, readers, start } = setup()
    const first = lifetime.read(context)
    await tick()
    readers[0]!.finish()
    expect((await first).operation).toBe(1)
    const second = lifetime.read(context)
    await tick()
    readers[0]!.finish()
    expect((await second).operation).toBe(2)
    expect(start).toHaveBeenCalledTimes(1)
    expect(readers[0]!.calls).toHaveLength(2)
    const closed = lifetime.close()
    readers[0]!.died()
    await closed
  })

  it('rejects an old sign-in read and waits for its native completion before the new scope', async () => {
    const { lifetime, readers, changed } = setup()
    const old = lifetime.read(context).catch((error: unknown) => error)
    await tick()
    lifetime.signInChanged()
    expect(await old).toMatchObject({ why: 'changed' })
    const current = lifetime.read({ ...context, signInChangedAt: { claude: 9 } })
    await tick()
    expect(readers[0]!.calls).toHaveLength(1)
    readers[0]!.finish()
    await tick()
    expect(readers[0]!.calls[1]).toMatchObject({ signInEpoch: 2, operation: 2 })
    readers[0]!.finish()
    expect((await current).signInEpoch).toBe(2)
    expect(changed).toHaveBeenCalledWith({ why: 'scope', databaseEpoch: 1, signInEpoch: 2 })
    const closed = lifetime.close()
    readers[0]!.died()
    await closed
  })

  it('restore cannot start a replacement until the previous worker has exited', async () => {
    const { lifetime, readers, start } = setup()
    const old = lifetime.read(context).catch((error: unknown) => error)
    await tick()
    let restored = false
    const restore = lifetime.restore('restored.sqlite').then(() => {
      restored = true
    })
    expect(await old).toMatchObject({ why: 'changed' })
    const current = lifetime.read(context)
    await vi.advanceTimersByTimeAsync(3000)
    expect(restored).toBe(false)
    expect(readers[0]!.stop).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
    readers[0]!.died()
    await restore
    await tick()
    expect(start.mock.calls).toEqual([['first.sqlite'], ['restored.sqlite']])
    readers[1]!.finish()
    expect((await current).databaseEpoch).toBe(2)
    const closed = lifetime.close()
    readers[1]!.died()
    await closed
  })

  it('a caller timeout cannot overlap the native reader with the next read', async () => {
    const { lifetime, readers } = setup()
    const completed = vi.fn()
    lifetime.observeReads({ before: () => 'selected proof', completed })
    const first = lifetime.read(context, undefined, 5).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5)
    expect(await first).toMatchObject({ why: 'deadline' })
    const next = lifetime.read(context)
    await tick()
    expect(readers[0]!.calls).toHaveLength(1)
    readers[0]!.finish()
    await tick()
    expect(completed).not.toHaveBeenCalled()
    expect(readers[0]!.calls).toHaveLength(2)
    readers[0]!.finish()
    await next
    expect(completed).toHaveBeenCalledTimes(1)
    const closed = lifetime.close()
    readers[0]!.died()
    await closed
  })

  it('restore waits for exit before replacement and for replacement before opening the new file', async () => {
    const { lifetime, readers, start } = setup()
    const first = lifetime.read(context)
    await tick()
    readers[0]!.finish()
    await first
    let finishReplacement!: () => void
    const replace = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReplacement = resolve
        }),
    )
    const restored = lifetime.restore('ready-after-replacement.sqlite', replace)
    const current = lifetime.read(context)
    await tick()
    expect(replace).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledTimes(1)
    readers[0]!.died()
    await tick()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
    finishReplacement()
    await restored
    await tick()
    expect(start.mock.calls[1]).toEqual(['ready-after-replacement.sqlite'])
    readers[1]!.finish()
    expect((await current).databaseEpoch).toBe(2)
    const closed = lifetime.close()
    readers[1]!.died()
    await closed
  })

  it('allows one replacement after death and then reports unavailable without a restart loop', async () => {
    const { lifetime, readers, start, changed } = setup()
    for (let n = 0; n < 2; n++) {
      const answer = lifetime.read(context).catch((error: unknown) => error)
      await tick()
      expect(readers).toHaveLength(n + 1)
      readers[n]!.died()
      expect(await answer).toMatchObject({ why: 'failed' })
      await tick()
    }
    const refused = lifetime.read(context).catch((error: unknown) => error)
    await tick()
    expect(await refused).toMatchObject({ why: 'failed' })
    expect(start).toHaveBeenCalledTimes(2)
    expect(changed.mock.calls.map(([change]) => change.why)).toEqual(['unavailable', 'unavailable'])
    await lifetime.close()
  })

  it('quit rejects publication immediately but completes only after confirmed exit', async () => {
    const { lifetime, readers, start } = setup()
    const answer = lifetime.read(context).catch((error: unknown) => error)
    await tick()
    let exited = false
    const close = lifetime.close().then(() => {
      exited = true
    })
    expect(await answer).toMatchObject({ why: 'changed' })
    await expect(lifetime.read(context)).rejects.toMatchObject({ why: 'closed' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(exited).toBe(false)
    expect(start).toHaveBeenCalledTimes(1)
    readers[0]!.died()
    await close
    expect(exited).toBe(true)
  })

  it('captures and completes authority evidence once for the selected native job before subscribers', async () => {
    const { lifetime, readers } = setup()
    const observed: string[] = []
    lifetime.observeReads({
      before: (input) => {
        observed.push(`before:${input.operation}:${input.capturedAt}`)
        return { selected: input.operation, capturedAt: input.capturedAt }
      },
      completed: (input, result, token) => {
        expect(result.operation).toBe(input.operation)
        expect(token).toEqual({ selected: input.operation, capturedAt: input.capturedAt })
        observed.push(`completed:${input.operation}`)
      },
    })
    const first = lifetime.read(context).then((value) => {
      observed.push('subscriber:1')
      return value
    })
    await tick()
    const second = lifetime.read({ ...context, capturedAt: 20 }).then((value) => {
      observed.push('subscriber:2')
      return value
    })
    const cancel = new AbortController()
    const third = lifetime
      .read({ ...context, capturedAt: 30 }, cancel.signal)
      .catch((error: unknown) => error)
    cancel.abort()
    expect(await third).toMatchObject({ why: 'cancelled' })
    readers[0]!.finish()
    await first
    await tick()
    expect(readers[0]!.calls.map((input) => input.operation)).toEqual([1, 3])
    readers[0]!.finish()
    expect((await second).operation).toBe(3)
    expect(observed).toEqual([
      'before:1:10',
      'completed:1',
      'subscriber:1',
      'before:3:30',
      'completed:3',
      'subscriber:2',
    ])
    const closed = lifetime.close()
    readers[0]!.died()
    await closed
  })

  it('never admits a completion across a scope change, and observation failure leaves display intact', async () => {
    const { lifetime, readers } = setup()
    const completed = vi.fn<
      (input: LimitsReadInput, result: LimitsReadResult, token: unknown) => void
    >(() => {
      throw new Error('refused authority preparation')
    })
    const scopeChanged = vi.fn()
    lifetime.observeReads({
      before: () => {
        throw new Error('unreadable stamp')
      },
      completed,
      scopeChanged,
    })
    const old = lifetime.read(context).catch((error: unknown) => error)
    await tick()
    lifetime.signInChanged()
    expect(await old).toMatchObject({ why: 'changed' })
    readers[0]!.finish()
    await tick()
    expect(completed).not.toHaveBeenCalled()
    expect(scopeChanged).toHaveBeenCalledWith({ why: 'scope', databaseEpoch: 1, signInEpoch: 2 })
    const fresh = lifetime.read(context)
    await tick()
    readers[0]!.finish()
    expect((await fresh).signInEpoch).toBe(2)
    expect(completed).toHaveBeenCalledTimes(1)
    expect(completed.mock.calls[0]?.[2]).toBeUndefined()
    const closed = lifetime.close()
    readers[0]!.died()
    await closed
  })
})
