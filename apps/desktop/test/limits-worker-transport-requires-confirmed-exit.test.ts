import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LimitsWorkerTransport } from '../src/main/db/limits-worker-transport'
import type { LimitsReadInput } from '../src/main/db/limits-read-protocol'

const input: LimitsReadInput = {
  operation: 1,
  databaseEpoch: 2,
  signInEpoch: 3,
  capturedAt: 10,
  signInChangedAt: {},
  usage: {},
}
const result = {
  operation: 1,
  databaseEpoch: 2,
  signInEpoch: 3,
  inputCapturedAt: 10,
  readStartedAt: 11,
  snapshotPinStartedAt: 11,
  snapshotPinnedAt: 12,
  evaluatedAt: 13,
  readFinishedAt: 14,
  canonical: { walk: 'every-provider-wall-recently-recorded', rows: [], ledgers: 0, rowsUnread: 0 },
  display: { walk: 'every-provider-wall-recently-recorded', rows: [], ledgers: 0, rowsUnread: 0 },
  measured: { rows: 0, bytes: 0, statements: 1 },
}

describe('limits transport waits for confirmed worker exit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const events = new EventEmitter()
    const postMessage = vi.fn()
    const terminate = vi.fn(() => new Promise<number>(() => {}))
    const transport = new LimitsWorkerTransport(
      Object.assign(events, { postMessage, terminate }) as unknown as Worker,
    )
    events.emit('message', { type: 'ready' })
    return { events, postMessage, terminate, transport }
  }

  it('rejects a concurrent native request and ignores an unrelated result id', async () => {
    const { events, postMessage, transport } = setup()
    const answer = transport.execute(input)
    await vi.advanceTimersByTimeAsync(0)
    await expect(transport.execute(input)).rejects.toMatchObject({ why: 'busy' })
    events.emit('message', { type: 'read', id: 99, read: result })
    await expect(transport.execute(input)).rejects.toMatchObject({ why: 'busy' })
    expect(postMessage).toHaveBeenCalledTimes(1)
    events.emit('message', { type: 'read', id: 1, read: result })
    expect(await answer).toEqual(result)
    const stopped = transport.stop()
    events.emit('exit', 0)
    await stopped
  })

  it.each(['operation', 'databaseEpoch', 'signInEpoch', 'inputCapturedAt'] as const)(
    'quarantines a reply with the wrong %s until exit',
    async (field) => {
      const { events, terminate, transport } = setup()
      let settled = false
      const answer = transport
        .execute(input)
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true
        })
      await vi.advanceTimersByTimeAsync(0)
      events.emit('message', { type: 'read', id: 1, read: { ...result, [field]: 99 } })
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe(false)
      expect(terminate).toHaveBeenCalledTimes(1)
      events.emit('exit', 1)
      expect(await answer).toMatchObject({ why: 'failed' })
    },
  )

  it('a stop deadline requests termination and still waits for exit', async () => {
    const { events, transport, terminate } = setup()
    const answer = transport.execute(input).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    let stopped = false
    const closing = transport.stop(5).then(() => {
      stopped = true
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(stopped).toBe(false)
    expect(terminate).toHaveBeenCalledTimes(1)
    events.emit('exit', 1)
    await closing
    expect(await answer).toMatchObject({ why: 'closed' })
    expect(stopped).toBe(true)
  })

  it('worker errors retain native ownership until the worker exits', async () => {
    const { events, transport } = setup()
    let settled = false
    const answer = transport
      .execute(input)
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(0)
    events.emit('error', new Error('fictional crash'))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    events.emit('exit', 1)
    expect(await answer).toMatchObject({ why: 'failed' })
  })

  it('a valid completed overflow failure frees the native request without pretending success', async () => {
    const { events, transport } = setup()
    const answer = transport.execute(input).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    events.emit('message', { type: 'failed', id: 1, why: 'overflow' })
    expect(await answer).toMatchObject({ why: 'overflow' })
    const next = transport.execute({ ...input, operation: 2 })
    await vi.advanceTimersByTimeAsync(0)
    events.emit('message', { type: 'read', id: 2, read: { ...result, operation: 2 } })
    expect((await next).operation).toBe(2)
    const stopped = transport.stop()
    events.emit('exit', 0)
    await stopped
  })
})
