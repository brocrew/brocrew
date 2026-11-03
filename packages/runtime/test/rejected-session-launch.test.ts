import { expect, it, vi } from 'vitest'
import { RejectedSessionLaunch } from '../src/rejected-session-launch'
import { ManagedPluginOwnership } from '../src/managed-plugin-ownership'
import type { SessionHandle } from '../src/runtime'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it('retains a refused replacement until both close and its one exit fact settle', async () => {
  const closing = deferred()
  const exit = deferred()
  const witness = vi.fn(() => exit.promise)
  const handle = { awaitProcessExit: witness } as unknown as SessionHandle
  const cause = new Error('fictional connection revision changed')
  const refused = new RejectedSessionLaunch(cause, handle, closing.promise)
  const ownership = new ManagedPluginOwnership()
  ownership.trackRefused(refused)
  ownership.trackRefused(refused)
  ownership.seal()
  let ended = false
  void ownership.awaitProcessExit()!.then(() => {
    ended = true
  })
  expect(refused.cause).toBe(cause)
  expect(refused.message).toBe(cause.message)
  expect(witness).toHaveBeenCalledOnce()
  closing.resolve()
  await Promise.resolve()
  expect(ended).toBe(false)
  expect(await ownership.mayReopen()).toBe(false)
  exit.resolve()
  await ownership.awaitProcessExit()
  expect(ended).toBe(true)
  expect(await ownership.mayReopen()).toBe(true)
})

for (const failure of ['close', 'exit', 'exit-getter'] as const) {
  it(`${failure} failure keeps refused replacement ownership uncertain`, async () => {
    const closing = deferred()
    const exit = deferred()
    const failed = new Error('fictional cleanup proof failed')
    const handle = {
      awaitProcessExit: () => {
        if (failure === 'exit-getter') throw failed
        return exit.promise
      },
    } as unknown as SessionHandle
    const refused = new RejectedSessionLaunch(
      new Error('fictional refusal'),
      handle,
      closing.promise,
    )
    const ownership = new ManagedPluginOwnership()
    ownership.trackRefused(refused)
    ownership.seal()
    let ended = false
    void ownership.awaitProcessExit()!.then(() => {
      ended = true
    })
    if (failure === 'close') closing.reject(failed)
    else closing.resolve()
    if (failure === 'exit') exit.reject(failed)
    else exit.resolve()
    await expect(refused.terminated).rejects.toBe(failed)
    expect(await ownership.mayReopen()).toBe(false)
    expect(ended).toBe(false)
    ownership.seal()
    await Promise.resolve()
    expect(ended).toBe(false)
  })
}

it('keeps the bounded-close fallback distinct from a process-exit witness', async () => {
  const closing = deferred()
  const handle = {} as SessionHandle
  const refused = new RejectedSessionLaunch(new Error('fictional refusal'), handle, closing.promise)
  const ownership = new ManagedPluginOwnership()
  ownership.trackRefused(refused)
  expect(refused.processExit).toBeUndefined()
  expect(ownership.awaitProcessExit()).toBeUndefined()
  expect(await ownership.mayReopen()).toBe(false)
  closing.resolve()
  await refused.terminated
  expect(await ownership.mayReopen()).toBe(true)
})

it('propagates refused bounded-close failure even without an exit witness', async () => {
  const closing = deferred()
  const failed = new Error('fictional close failed')
  const refused = new RejectedSessionLaunch(
    new Error('fictional refusal'),
    {} as SessionHandle,
    closing.promise,
  )
  const ownership = new ManagedPluginOwnership()
  ownership.trackRefused(refused)
  closing.reject(failed)
  await expect(refused.terminated).rejects.toBe(failed)
  expect(ownership.awaitProcessExit()).toBeUndefined()
  await expect(ownership.closeAll()).rejects.toBe(failed)
  expect(await ownership.mayReopen()).toBe(false)
})

it('reports active bounded-close failure after attempting every managed child', async () => {
  const ownership = new ManagedPluginOwnership()
  const failed = new Error('fictional active close failed')
  const first = vi.fn(async () => {
    throw failed
  })
  const second = vi.fn(async () => {})
  ownership.track({ close: first } as unknown as SessionHandle)
  ownership.track({ close: second } as unknown as SessionHandle)
  await expect(ownership.closeAll()).rejects.toBe(failed)
  expect(first).toHaveBeenCalledOnce()
  expect(second).toHaveBeenCalledOnce()
  expect(ownership.awaitProcessExit()).toBeUndefined()
  expect(await ownership.mayReopen()).toBe(false)
})
