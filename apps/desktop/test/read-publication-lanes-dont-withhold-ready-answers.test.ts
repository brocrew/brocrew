import { describe, expect, it, vi } from 'vitest'
import { readPublicationLane } from '../src/renderer/src/lib/read-publication-lane'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const answer = new Promise<Value>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { answer, resolve, reject }
}
function lane() {
  const reading = vi.fn()
  const ready = vi.fn()
  const unavailable = vi.fn()
  return {
    reading,
    ready,
    unavailable,
    lane: readPublicationLane<string>({ reading, ready, unavailable }),
  }
}

describe('independent read publication lanes', () => {
  it('publishes ready actionable answers while limits are still reading', async () => {
    const limits = lane()
    const actionable = lane()
    const slow = deferred<string>()
    const refreshing = limits.lane.refresh(() => slow.answer)
    await actionable.lane.refresh(async () => 'fictional new question')
    expect(actionable.ready).toHaveBeenCalledExactlyOnceWith('fictional new question')
    expect(limits.reading).toHaveBeenCalledTimes(1)
    expect(limits.ready).not.toHaveBeenCalled()
    slow.resolve('fictional dated limits')
    await refreshing
    expect(limits.ready).toHaveBeenCalledExactlyOnceWith('fictional dated limits')
  })

  it('an earlier round cannot replace the newer result when it finishes last', async () => {
    const { lane: current, ready } = lane()
    const old = deferred<string>()
    const pending = current.refresh(() => old.answer)
    await current.refresh(async () => 'newer')
    old.resolve('older')
    await pending
    expect(ready).toHaveBeenCalledExactlyOnceWith('newer')
  })

  it('an old failure cannot invalidate a newer successful answer', async () => {
    const { lane: current, ready, unavailable } = lane()
    const old = deferred<string>()
    const pending = current.refresh(() => old.answer)
    await current.refresh(async () => 'newer')
    old.reject(new Error('fictional old failure'))
    await pending
    expect(ready).toHaveBeenCalledExactlyOnceWith('newer')
    expect(unavailable).not.toHaveBeenCalled()
  })

  it('a scope change rejects both old success and failure publication', async () => {
    for (const fails of [false, true]) {
      const { lane: current, ready, unavailable } = lane()
      const old = deferred<string>()
      const pending = current.refresh(() => old.answer)
      current.changeScope()
      if (fails) old.reject(new Error('fictional old scope'))
      else old.resolve('old account')
      await pending
      expect(ready).not.toHaveBeenCalled()
      expect(unavailable).not.toHaveBeenCalled()
      await current.refresh(async () => 'current account')
      expect(ready).toHaveBeenCalledExactlyOnceWith('current account')
    }
  })

  it('closing a lane prevents late publication and new reads', async () => {
    const { lane: current, ready, reading } = lane()
    const old = deferred<string>()
    const pending = current.refresh(() => old.answer)
    current.close()
    old.resolve('late')
    await pending
    const read = vi.fn(async () => 'never requested')
    await current.refresh(read)
    expect(ready).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(reading).toHaveBeenCalledTimes(1)
  })

  it('reports a current synchronous read failure as unavailable', async () => {
    const { lane: current, ready, unavailable } = lane()
    const error = new Error('fictional unavailable connection')
    await current.refresh(() => {
      throw error
    })
    expect(ready).not.toHaveBeenCalled()
    expect(unavailable).toHaveBeenCalledExactlyOnceWith(error)
  })
})
