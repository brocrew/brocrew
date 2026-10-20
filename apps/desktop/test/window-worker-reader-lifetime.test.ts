import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  WindowReaderLifetime,
  WindowWorkerReader,
  type WindowReadWorker,
} from '../src/main/db/window-worker-reader'
import { WINDOW_READ_BOUNDS, WindowReadUnavailable } from '../src/main/db/window-read-protocol'

class ReadWorker extends EventEmitter implements WindowReadWorker {
  readonly sent: unknown[] = []
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  terminate = vi.fn(async () => 0)
}

const result = {
  kind: 'routes' as const,
  routes: [],
  questions: {
    walk: 'every-conversation-that-routed' as const,
    rows: [],
    ledgers: 0,
    rowsUnread: 0,
  },
  decisions: {
    walk: 'every-conversation-that-routed' as const,
    rows: [],
    ledgers: 0,
    rowsUnread: 0,
  },
}
const drain = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('window reader owns its native connection until confirmed exit', () => {
  const leadQuery = {
    kind: 'leads' as const,
    sessionId: 'fictional',
    before: 1000,
    opening: 'fictional lead',
    historicalOpening: 'old fictional lead',
  }

  it('an abort before ready sends no native job and releases its queued permit', async () => {
    const worker = new ReadWorker()
    const reader = new WindowWorkerReader(worker)
    const stop = new AbortController()
    const answer = reader.read(leadQuery, stop.signal)
    stop.abort()
    await expect(answer).rejects.toThrow(WindowReadUnavailable)
    worker.emit('message', { type: 'ready' })
    await drain()
    expect(worker.sent).toEqual([])
    await expect(reader.read(leadQuery, stop.signal)).rejects.toThrow(WindowReadUnavailable)
    worker.emit('exit', 0)
    await reader.close()
  })

  it('an abort reaches the native flag but retains the permit until the worker replies', async () => {
    const worker = new ReadWorker()
    const reader = new WindowWorkerReader(worker)
    const stop = new AbortController()
    const cleanUp = vi.spyOn(stop.signal, 'removeEventListener')
    let settled = false
    const answer = reader.read(leadQuery, stop.signal).catch((error: unknown) => {
      settled = true
      return error
    })
    worker.emit('message', { type: 'ready' })
    await drain()
    const sent = worker.sent[0]
    if (
      sent === null ||
      typeof sent !== 'object' ||
      !('id' in sent) ||
      typeof sent.id !== 'number' ||
      !('cancellation' in sent) ||
      !(sent.cancellation instanceof SharedArrayBuffer)
    )
      throw new Error('Missing native abort flag')
    const flag = new Int32Array(sent.cancellation)
    expect(Atomics.load(flag, 0)).toBe(0)
    const queued = Array.from({ length: WINDOW_READ_BOUNDS.pending - 1 }, () =>
      reader.read({ kind: 'routes' }).catch((error: unknown) => error),
    )
    stop.abort()
    await drain()
    expect(Atomics.load(flag, 0)).toBe(1)
    expect(settled).toBe(false)
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow(WindowReadUnavailable)
    worker.emit('message', { type: 'failed', id: sent.id })
    expect(await answer).toBeInstanceOf(WindowReadUnavailable)
    expect(cleanUp).toHaveBeenCalledOnce()
    const next = reader.read({ kind: 'routes' }).catch((error: unknown) => error)
    await drain()
    expect(worker.sent).toHaveLength(WINDOW_READ_BOUNDS.pending + 1)
    worker.emit('exit', 0)
    await Promise.all([...queued, next])
    await reader.close()
  })
  it('waits for ready, correlates replies and waits for exit on close', async () => {
    const worker = new ReadWorker()
    const reader = new WindowWorkerReader(worker)
    const answer = reader.read({ kind: 'routes' })
    expect(worker.sent).toEqual([])
    worker.emit('message', { type: 'ready' })
    await drain()
    const sent = worker.sent[0] as { id: number }
    worker.emit('message', { type: 'read', id: sent.id + 1, result })
    worker.emit('message', { type: 'read', id: sent.id, result })
    expect(await answer).toEqual(result)
    let closed = false
    const closing = reader.close().then(() => {
      closed = true
    })
    await drain()
    expect(closed).toBe(false)
    expect(worker.sent.at(-1)).toEqual({ type: 'close' })
    worker.emit('exit', 0)
    await closing
    expect(closed).toBe(true)
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow(WindowReadUnavailable)
  })

  it('an invalid reply terminates once and settles its pending read only after exit', async () => {
    const worker = new ReadWorker()
    const reader = new WindowWorkerReader(worker)
    let settled = false
    const answer = reader.read({ kind: 'routes' }).catch((error) => {
      settled = true
      return error
    })
    worker.emit('message', { type: 'ready' })
    await drain()
    const sent = worker.sent[0] as { id: number }
    worker.emit('message', { type: 'read', id: sent.id, result: { kind: 'routes', routes: [] } })
    worker.emit('error', new Error('fictional worker failure'))
    await drain()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    worker.emit('exit', 1)
    expect(await answer).toBeInstanceOf(WindowReadUnavailable)
    await reader.close()
  })

  it('bounds queued demand while the worker is starting', async () => {
    const worker = new ReadWorker()
    const reader = new WindowWorkerReader(worker)
    const answers = Array.from({ length: WINDOW_READ_BOUNDS.pending }, () =>
      reader.read({ kind: 'routes' }).catch((error) => error),
    )
    const overflow = reader.read({ kind: 'routes' })
    await expect(overflow).rejects.toThrow(WindowReadUnavailable)
    await expect(overflow).rejects.toMatchObject({ why: 'busy' })
    expect(worker.sent).toEqual([])
    worker.emit('exit', 1)
    for (const answer of await Promise.all(answers)) {
      expect(answer).toBeInstanceOf(WindowReadUnavailable)
      expect(answer).toMatchObject({ why: 'unavailable' })
    }
    await reader.close()
  })

  it('shutdown refuses a late successful reply and waits for the connection to exit', async () => {
    const worker = new ReadWorker()
    const reader = new WindowWorkerReader(worker)
    const answer = reader.read({ kind: 'routes' }).catch((error) => error)
    worker.emit('message', { type: 'ready' })
    await drain()
    const sent = worker.sent[0] as { id: number }
    const closing = reader.close()
    worker.emit('message', { type: 'read', id: sent.id, result })
    expect(await answer).toBeInstanceOf(WindowReadUnavailable)
    worker.emit('exit', 0)
    await closing
  })

  function lifetime() {
    const workers: ReadWorker[] = []
    const start = vi.fn(() => {
      const worker = new ReadWorker()
      workers.push(worker)
      const reader = new WindowWorkerReader(worker)
      worker.emit('message', { type: 'ready' })
      return reader
    })
    return { lifetime: new WindowReaderLifetime(start), workers, start }
  }

  it('replaces a failed reader once after confirmed exit, with no overlapping connection', async () => {
    const { lifetime: reader, workers, start } = lifetime()
    let settled = false
    const first = reader.read({ kind: 'routes' }).catch((error) => {
      settled = true
      return error
    })
    await drain()
    const initial = workers[0]!
    initial.emit('error', new Error('fictional native failure'))
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow(WindowReadUnavailable)
    expect(start).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(initial.terminate).toHaveBeenCalledOnce()
    initial.emit('exit', 1)
    expect(await first).toBeInstanceOf(WindowReadUnavailable)

    const recovered = reader.read({ kind: 'routes' })
    await drain()
    expect(start).toHaveBeenCalledTimes(2)
    const replacement = workers[1]!
    const sent = replacement.sent[0] as { id: number }
    replacement.emit('message', { type: 'read', id: sent.id, result })
    expect(await recovered).toEqual(result)
    const closing = reader.close()
    replacement.emit('exit', 0)
    await closing
  })

  it('bounds replacement at two readers and gives restart guidance after both fail', async () => {
    const { lifetime: reader, workers, start } = lifetime()
    for (let n = 0; n < 2; n++) {
      const answer = reader.read({ kind: 'routes' }).catch((error) => error)
      await drain()
      workers[n]!.emit('error', new Error('fictional native failure'))
      workers[n]!.emit('exit', 1)
      expect(await answer).toBeInstanceOf(WindowReadUnavailable)
    }
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow('Restart BroCrew')
    expect(start).toHaveBeenCalledTimes(2)
    await reader.close()
  })

  it('quit waits for confirmed exit and prevents a replacement after that exit', async () => {
    const { lifetime: reader, workers, start } = lifetime()
    const answer = reader.read({ kind: 'routes' }).catch((error) => error)
    await drain()
    let closed = false
    const closing = reader.close().then(() => {
      closed = true
    })
    await drain()
    expect(closed).toBe(false)
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow(WindowReadUnavailable)
    expect(start).toHaveBeenCalledOnce()
    workers[0]!.emit('exit', 0)
    expect(await answer).toBeInstanceOf(WindowReadUnavailable)
    await closing
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow(WindowReadUnavailable)
    expect(start).toHaveBeenCalledOnce()
  })

  it('a start failure consumes the bounded retry budget without opening a connection', async () => {
    const start = vi.fn(() => {
      throw new Error('fictional start failure')
    })
    const reader = new WindowReaderLifetime(start)
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow(WindowReadUnavailable)
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow(WindowReadUnavailable)
    await expect(reader.read({ kind: 'routes' })).rejects.toThrow('Restart BroCrew')
    expect(start).toHaveBeenCalledTimes(2)
    await reader.close()
  })
})
