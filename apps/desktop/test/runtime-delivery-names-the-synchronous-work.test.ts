import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MainThreadWork, aWaitSays } from '../src/main/stall-watch'
import { webContentsSink } from '../src/main/runtime/ipc'
import { ReopenQueue } from '../src/main/runtime/reopen-queue'
import { broadcastRuntime } from '../src/main/runtime/window-broadcast'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

afterEach(() => vi.useRealTimers())

describe('runtime delivery names synchronous work', () => {
  it('finishes once on early return or throw and retains the native promise', async () => {
    let at = 0
    const work = new MainThreadWork(() => at)
    const finish = work.start('window state broadcast')
    at = 700
    finish()
    finish()
    const failure = new Error('fictional failure')
    expect(() =>
      work.timed('runtime provider event delivery', () => {
        at += 600
        throw failure
      }),
    ).toThrow(failure)
    const promise = Promise.resolve('result')
    expect(work.timed('runtime sign-in renewed resume', () => promise)).toBe(promise)
    at += 10000
    await promise
    expect(work.take()).toEqual([
      { what: 'window state broadcast', count: 1, ms: 700, longest: 700 },
      { what: 'runtime provider event delivery', count: 1, ms: 600, longest: 600 },
      { what: 'runtime sign-in renewed resume', count: 1, ms: 0, longest: 0 },
    ])
  })

  it('names a low-CPU window broadcast including enumeration and continues past a lost window', () => {
    let at = 0
    const work = new MainThreadWork(() => at)
    const delivered: unknown[] = []
    const failed: unknown[] = []
    const failure = new Error('one window closed')
    const target = (send: () => void, destroyed = false) => ({
      isDestroyed: () => destroyed,
      webContents: { isDestroyed: () => false, send },
    })
    const message = { moved: [{ conversation: 'fictional-private-id' }] }
    broadcastRuntime(
      () => {
        at += 50
        return [
          target(() => {
            at += 600
            delivered.push(message)
          }),
          target(() => {
            throw failure
          }),
          target(() => {
            delivered.push(message)
          }),
          target(() => {
            throw new Error('destroyed window sent')
          }, true),
        ]
      },
      'runtime:states',
      message,
      (error) => failed.push(error),
      work,
      'window state broadcast',
    )
    expect(delivered).toEqual([message, message])
    expect(failed).toEqual([failure])
    const line = aWaitSays(700, 40, work.take())
    expect(line).toContain('window state broadcast 650 ms')
    expect(line).not.toContain('outside the timed work')
    expect(line).not.toContain('fictional-private-id')
  })

  it('records enumeration failure without swallowing it', () => {
    let at = 0
    const work = new MainThreadWork(() => at)
    const failure = new Error('enumeration failed')
    expect(() =>
      broadcastRuntime(
        () => {
          at += 800
          throw failure
        },
        'channel',
        {},
        () => {},
        work,
        'window change broadcast',
      ),
    ).toThrow(failure)
    expect(work.take()).toEqual([
      { what: 'window change broadcast', count: 1, ms: 800, longest: 800 },
    ])
  })

  it('records actual IPC send and its refusal without putting message contents in labels', () => {
    let at = 0
    let destroyed = false
    const failure = new Error('send failed')
    const work = new MainThreadWork(() => at)
    const contents = {
      id: 1,
      isDestroyed: () => destroyed,
      send: () => {
        at += 750
        throw failure
      },
    } as unknown as WebContents
    const message: RuntimeEventMessage = {
      sessionId: 'fictional-private-id',
      ordinal: 0,
      at: 0,
      event: { type: 'assistant_delta', text: 'fictional-private-text' },
    }
    const sink = webContentsSink(contents, work)
    expect(() => sink.send(message)).toThrow(failure)
    destroyed = true
    sink.send(message)
    expect(work.take()).toEqual([
      { what: 'window conversation event send', count: 2, ms: 750, longest: 750 },
    ])
  })

  it('records FIFO admission but excludes waiting on an unresolved reopen', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] })
    let at = 0
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const work = new MainThreadWork(() => at)
    const queue = new ReopenQueue(work)
    const order: string[] = []
    const first = queue.run(() => {
      at += 70
      order.push('first')
      return held
    })
    const second = queue.run(async () => {
      at += 90
      order.push('second')
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['first'])
    expect(work.take()).toEqual([
      { what: 'runtime sign-in reopen admission', count: 1, ms: 70, longest: 70 },
    ])
    at += 20000
    release()
    await first
    await vi.advanceTimersByTimeAsync(0)
    await second
    expect(order).toEqual(['first', 'second'])
    expect(work.take()).toEqual([
      { what: 'runtime sign-in reopen admission', count: 1, ms: 90, longest: 90 },
    ])
  })

  it('keeps the queue rejection and starts the next job after a synchronous failure', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] })
    let at = 0
    const work = new MainThreadWork(() => at)
    const queue = new ReopenQueue(work)
    const failure = new Error('reopen failed')
    const first = queue.run(() => {
      at += 630
      throw failure
    })
    const rejected = expect(first).rejects.toBe(failure)
    let ran = false
    const next = queue.run(async () => {
      ran = true
    })
    await vi.runAllTimersAsync()
    await rejected
    await next
    expect(ran).toBe(true)
    expect(work.take()).toEqual([
      { what: 'runtime sign-in reopen admission', count: 2, ms: 630, longest: 630 },
    ])
  })
})
