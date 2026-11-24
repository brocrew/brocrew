import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilesLibraryLifetime } from '../src/main/db/files-library-reader'
import type { ReaderWorker } from '../src/main/db/reader-worker-lifetime'
import { TeamProfileGraphLifetime } from '../src/main/db/team-profile-graph-reader'
import { libraryUnavailable } from '../src/shared/files-library'
import { graphUnavailable } from '../src/shared/team-profile-graph'
import { libraryContext, workspaceQuery } from './helpers/files-library-fixture'
import { graphContext } from './helpers/team-profile-graph-fixture'

/** A worker that answers only when told, so time can pass between its start, `ready` and reply. */
class FictionalWorker extends EventEmitter implements ReaderWorker {
  posted: Record<string, unknown>[] = []
  postMessage(value: unknown): void {
    this.posted.push(value as Record<string, unknown>)
  }
  terminate(): Promise<number> {
    return Promise.resolve(0)
  }
  ready(): void {
    this.emit('message', { type: 'ready' })
  }
  reply(result: unknown): void {
    const reads = this.posted.filter((m) => m['type'] === 'read')
    this.emit('message', { type: 'read', id: reads.at(-1)!['id'], result })
  }
  closeAsked(): boolean {
    return this.posted.some((m) => m['type'] === 'close')
  }
  reads(): number {
    return this.posted.filter((m) => m['type'] === 'read').length
  }
}

/** One reader, asked the same thing each time. */
type Reader = { read(): Promise<unknown>; close(): Promise<void> }

/** The idle window each reader is given here, in milliseconds. */
const IDLE = 20

const callers: { name: string; open(start: () => ReaderWorker): Reader; answer: unknown }[] = [
  {
    name: 'the Files library',
    open: (start) => {
      const reader = new FilesLibraryLifetime(start, Date.now, IDLE)
      return {
        read: () => reader.read({ operation: 'query', query: workspaceQuery }, libraryContext),
        close: () => reader.close(),
      }
    },
    answer: libraryUnavailable('budget'),
  },
  {
    name: 'the team graph',
    open: (start) => {
      const reader = new TeamProfileGraphLifetime(start, () => performance.now(), IDLE)
      return {
        read: () => reader.read({ operation: 'snapshot' }, graphContext),
        close: () => reader.close(),
      }
    },
    answer: graphUnavailable('budget'),
  },
]

afterEach(() => vi.useRealTimers())

describe.each(callers)(
  '$name: a cold worker’s start does not count against its first read',
  (caller) => {
    const opened = () => {
      vi.useFakeTimers()
      const workers: FictionalWorker[] = []
      const reader = caller.open(() => {
        const worker = new FictionalWorker()
        workers.push(worker)
        return worker
      })
      return { reader, workers }
    }
    const settledFlag = (reading: Promise<unknown>) => {
      const seen = { settled: false }
      void reading.then(() => {
        seen.settled = true
      })
      return seen
    }

    it('a late ready starts the idle window again, and a read that then stalls still ends', async () => {
      const { reader, workers } = opened()
      const first = reader.read()
      const worker = workers[0]!
      await vi.advanceTimersByTimeAsync(IDLE - 5)
      worker.ready()
      expect(worker.reads()).toBe(1)
      await vi.advanceTimersByTimeAsync(IDLE - 5)
      expect(worker.closeAsked()).toBe(false)
      worker.reply(caller.answer)
      expect(await first).toMatchObject({ cause: 'budget' })

      const stalled = reader.read()
      const seen = settledFlag(stalled)
      await vi.advanceTimersByTimeAsync(IDLE + 1)
      expect(seen.settled).toBe(true)
      expect(await stalled).toMatchObject({ cause: 'worker' })
      expect(worker.closeAsked()).toBe(true)
      const closing = reader.close()
      worker.emit('exit', 1)
      await closing
    })

    it('a worker that never says ready ends the read after the idle window, without a read sent', async () => {
      const { reader, workers } = opened()
      const reading = reader.read()
      const worker = workers[0]!
      await vi.advanceTimersByTimeAsync(IDLE - 1)
      expect(worker.closeAsked()).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      expect(await reading).toMatchObject({ cause: 'worker' })
      expect(worker.reads()).toBe(0)
      expect(worker.closeAsked()).toBe(true)
      const closing = reader.close()
      worker.emit('exit', 1)
      await closing
    })

    it('a read cancelled before ready keeps its own window, and the newer read gets a fresh one', async () => {
      const { reader, workers } = opened()
      const older = reader.read()
      const worker = workers[0]!
      await vi.advanceTimersByTimeAsync(IDLE - 10)
      const newer = reader.read()
      await vi.advanceTimersByTimeAsync(5)
      worker.ready()
      expect(worker.reads()).toBe(1)
      worker.reply(caller.answer)
      expect(await older).toMatchObject({ cause: 'cancelled' })
      expect(worker.reads()).toBe(2)
      await vi.advanceTimersByTimeAsync(IDLE - 1)
      expect(worker.closeAsked()).toBe(false)
      worker.reply(caller.answer)
      expect(await newer).toMatchObject({ cause: 'budget' })

      const closing = reader.close()
      worker.emit('exit', 1)
      await closing
    })

    it('a ready that comes while the only read is already cancelled does not extend it', async () => {
      const { reader, workers } = opened()
      const older = reader.read()
      const worker = workers[0]!
      const newer = reader.read()
      await vi.advanceTimersByTimeAsync(IDLE - 5)
      worker.ready()
      await vi.advanceTimersByTimeAsync(6)
      expect(worker.closeAsked()).toBe(true)
      expect(await older).toMatchObject({ cause: 'worker' })
      const closing = reader.close()
      expect(await newer).toMatchObject({ cause: 'closed' })
      worker.emit('exit', 1)
      await closing
    })

    it('a worker that exits before ready ends the read at once, and its window leaves nothing behind', async () => {
      const { reader, workers } = opened()
      const reading = reader.read()
      const worker = workers[0]!
      await vi.advanceTimersByTimeAsync(IDLE - 10)
      worker.emit('exit', 1)
      expect(await reading).toMatchObject({ cause: 'worker' })
      worker.ready()
      expect(worker.reads()).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      await reader.close()
    })

    it('a warm worker gets each read at once, and its window counts from that read', async () => {
      const { reader, workers } = opened()
      const first = reader.read()
      const worker = workers[0]!
      worker.ready()
      worker.reply(caller.answer)
      await first
      await vi.advanceTimersByTimeAsync(IDLE * 3)
      const warm = reader.read()
      expect(worker.reads()).toBe(2)
      await vi.advanceTimersByTimeAsync(IDLE - 1)
      expect(worker.closeAsked()).toBe(false)
      worker.reply(caller.answer)
      expect(await warm).toMatchObject({ cause: 'budget' })
      expect(workers).toHaveLength(1)
      const closing = reader.close()
      worker.emit('exit', 1)
      await closing
    })
  },
)
