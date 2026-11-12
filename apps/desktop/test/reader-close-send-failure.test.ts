import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import { ReaderWorkerLifetime } from '../src/main/db/reader-worker-lifetime'

it.each(['failed post', 'error before ready'])(
  'reports %s while retaining both close callers until actual exit',
  async (mode) => {
    const events = new EventEmitter()
    const sendError = new Error('fictional closed message port')
    const worker = Object.assign(events, {
      postMessage() { throw sendError },
      terminate() { throw new Error('native termination must not be requested') },
    })
    const lifetime = new ReaderWorkerLifetime(() => worker, Date.now, 1_000, {
      bounds: { restarts: 0, restartWindowMs: 1_000, replyBytes: 1024 },
      unavailable: (cause) => ({ cause }),
      accept: () => undefined,
    })
    const reading = lifetime.read({}, {})
    if (mode === 'failed post') events.emit('message', { type: 'ready' })
    else events.emit('error', new Error('fictional worker failed to load'))
    expect(await reading).toEqual({ cause: 'worker' })
    let joined = false
    const close = lifetime.close().catch((error: unknown) => error).finally(() => { joined = true })
    const repeated = lifetime.close().catch((error: unknown) => error)
    await Promise.resolve()
    expect(joined).toBe(false)
    expect(await lifetime.read({}, {})).toEqual({ cause: 'closed' })
    events.emit('exit', 1)
    expect(await close).toBe(sendError)
    expect(await repeated).toBe(sendError)
    expect(joined).toBe(true)
  },
)
