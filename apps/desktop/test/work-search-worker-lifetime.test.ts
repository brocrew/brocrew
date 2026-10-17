import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORK_SEARCH_BOUNDS } from '../src/shared/work-search'
import { workSearchInWords, workSearchRefusal } from '../src/shared/work-search-words'
import { WorkSearchWorkerReader } from '../src/main/db/work-search-reader'

class WorkerDouble extends EventEmitter {
  terminations = 0
  private readonly finished = new Promise<number>((resolve) => {
    this.once('exit', resolve)
  })
  terminate() {
    this.terminations++
    return this.finished
  }
}
const empty = {
  ok: true,
  page: {
    hits: [],
    searched: 0,
    rows_unread: 0,
    ledgers_skipped: 0,
    complete: true,
    next_cursor: null,
  },
}
afterEach(() => vi.useRealTimers())

describe('the work search owns its worker until exit', () => {
  it('does not spawn until asked and waits for exit after a result', async () => {
    const worker = new WorkerDouble()
    const start = vi.fn(() => worker as unknown as Worker)
    const reader = new WorkSearchWorkerReader(start)
    expect(start).not.toHaveBeenCalled()
    const pending = reader.read('sess_1', { scope: 'all' })
    expect(start).toHaveBeenCalledTimes(1)
    worker.emit('message', empty)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.emit('exit', 0)
    expect(await pending).toEqual(empty)
    await reader.close()
    expect(await reader.read('sess_1', { scope: 'all' })).toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('cannot accept a late result after the deadline or close before the owned worker ends', async () => {
    vi.useFakeTimers()
    const worker = new WorkerDouble()
    const reader = new WorkSearchWorkerReader(() => worker as unknown as Worker)
    const pending = reader.read('sess_1', { scope: 'all' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(worker.terminations).toBe(1)
    expect(await pending).toEqual({ ok: false, reason: 'unavailable' })
    const queued = reader.read('sess_2', { scope: 'all' })
    worker.emit('message', empty)
    let closed = false
    const closing = reader.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    worker.emit('exit', 0)
    expect(await pending).toEqual({ ok: false, reason: 'unavailable' })
    await closing
    expect(await queued).toEqual({ ok: false, reason: 'unavailable' })
    expect(closed).toBe(true)
  })

  it('cannot replace an error with a late success while waiting for exit', async () => {
    const worker = new WorkerDouble()
    const reader = new WorkSearchWorkerReader(() => worker as unknown as Worker)
    const pending = reader.read('sess_1', { scope: 'all' })
    worker.emit('error', new Error('fictional worker failure'))
    worker.emit('message', empty)
    expect(worker.terminations).toBe(1)
    worker.emit('exit', 0)
    expect(await pending).toEqual({ ok: false, reason: 'unavailable' })
    await reader.close()
  })

  it('rejects malformed or repeated output rather than passing it into a window', async () => {
    const oversizedReferences = {
      ...empty,
      page: {
        ...empty.page,
        hits: [
          {
            kind: 'piece',
            piece: 'work_first',
            label: 'W1.1',
            title: null,
            state: 'answered',
            owner: { conversation: 'sess_1', name: null, profile: null },
            giver: null,
            result: null,
            status: null,
            resource_ids: {
              brief: Array.from({ length: 10 }, (_, index) => `res_${index}`),
              result: ['res_extra'],
              attachments: [],
              working: [],
            },
            clipped: { title: false, result: false, status: false },
            resources_omitted: 0,
          },
        ],
      },
    }
    expect(
      oversizedReferences.page.hits[0]!.resource_ids.brief.length +
        oversizedReferences.page.hits[0]!.resource_ids.result.length,
    ).toBe(11)
    for (const messages of [
      [{ ...empty, extra: 'unexpected' }],
      [empty, empty],
      [oversizedReferences],
    ]) {
      const worker = new WorkerDouble()
      const reader = new WorkSearchWorkerReader(() => worker as unknown as Worker)
      const pending = reader.read('sess_1', { scope: 'all' })
      for (const message of messages) worker.emit('message', message)
      expect(worker.terminations).toBe(1)
      worker.emit('exit', 0)
      expect(await pending).toEqual({ ok: false, reason: 'unavailable' })
      await reader.close()
    }
  })
})

describe('searches wait in order and retain a bounded partial page', () => {
  for (const count of [2, 5]) {
    it(`answers ${count} concurrent callers in FIFO order`, async () => {
      const workers: WorkerDouble[] = []
      const callers: string[] = []
      const reader = new WorkSearchWorkerReader((caller) => {
        callers.push(caller)
        const worker = new WorkerDouble()
        workers.push(worker)
        return worker as unknown as Worker
      })
      const pending = Array.from({ length: count }, (_, i) =>
        reader.read(`sess_${i}`, { scope: 'all' }),
      )
      expect(callers).toEqual(['sess_0'])
      for (let i = 0; i < count; i++) {
        expect(callers).toEqual(Array.from({ length: i + 1 }, (_, n) => `sess_${n}`))
        const worker = workers[i]!
        worker.emit('message', empty)
        worker.emit('exit', 0)
        expect(await pending[i]).toEqual(empty)
      }
      await reader.close()
    })
  }

  it('refuses only queue overflow and releases waiting slots on close', async () => {
    const worker = new WorkerDouble()
    const start = vi.fn(() => worker as unknown as Worker)
    const reader = new WorkSearchWorkerReader(start)
    const pending = Array.from({ length: WORK_SEARCH_BOUNDS.waiting + 1 }, () =>
      reader.read('sess_1', { scope: 'all' }),
    )
    let overflow: unknown
    void reader.read('overflow', { scope: 'all' }).then((value) => {
      overflow = value
    })
    await Promise.resolve()
    try {
      expect(overflow).toEqual({ ok: false, reason: 'busy' })
      expect(workSearchRefusal('busy')).toMatchObject({ rail: 'work-search-busy', retryable: true })
    } finally {
      const closing = reader.close()
      worker.emit('exit', 0)
      expect(await Promise.all(pending)).toEqual(
        pending.map(() => ({ ok: false, reason: 'unavailable' })),
      )
      await closing
    }
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('returns its last validated checkpoint at the deadline and never overlaps its worker', async () => {
    vi.useFakeTimers()
    const workers = [new WorkerDouble(), new WorkerDouble()]
    const start = vi.fn(() => workers[start.mock.calls.length - 1]! as unknown as Worker)
    const reader = new WorkSearchWorkerReader(start)
    const pending = reader.read('sess_1', { scope: 'all' })
    const partial = {
      ...empty,
      page: { ...empty.page, searched: 3, complete: false, next_cursor: 'fictional-cursor' },
    }
    workers[0]!.emit('message', { kind: 'progress', result: partial })
    const queued = reader.read('sess_2', { scope: 'all' })
    await vi.advanceTimersByTimeAsync(WORK_SEARCH_BOUNDS.workerMs)
    expect(await pending).toEqual(partial)
    expect(workSearchInWords(partial.page)).toContain(
      'Older work has not been searched yet. next_cursor: fictional-cursor',
    )
    expect(start).toHaveBeenCalledTimes(1)
    workers[0]!.emit('message', empty)
    workers[0]!.emit('exit', 1)
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(2)
    workers[1]!.emit('message', empty)
    workers[1]!.emit('exit', 0)
    expect(await queued).toEqual(empty)
    await reader.close()
  })

  it.each(['error', 'reply'])(
    'does not disguise a real worker failure (%s) as a partial success',
    async (failure) => {
      vi.useFakeTimers()
      const worker = new WorkerDouble()
      const reader = new WorkSearchWorkerReader(() => worker as unknown as Worker)
      const pending = reader.read('sess_1', { scope: 'all' })
      worker.emit('message', {
        kind: 'progress',
        result: { ...empty, page: { ...empty.page, complete: false, next_cursor: 'fictional' } },
      })
      if (failure === 'error') worker.emit('error', new Error('fictional damaged ledger'))
      else worker.emit('message', { ok: false, reason: 'unavailable' })
      await vi.advanceTimersByTimeAsync(WORK_SEARCH_BOUNDS.workerMs)
      expect(await pending).toEqual({ ok: false, reason: 'unavailable' })
      worker.emit('exit', 1)
      expect(await pending).toEqual({ ok: false, reason: 'unavailable' })
      expect(workSearchRefusal('unavailable')).toMatchObject({
        retryable: true,
        rail: 'work-search-unavailable',
      })
      await reader.close()
    },
  )
})
