import { expect, it, vi } from 'vitest'
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
function owned() {
  const exit = deferred(),
    close = deferred()
  const handle = {
    close: vi.fn(() => close.promise),
    awaitProcessExit: () => exit.promise,
  } as unknown as SessionHandle
  const owner = new ManagedPluginOwnership()
  owner.track(handle)
  const aggregate = owner.awaitProcessExit()!
  let proved = false
  void aggregate.then(() => {
    proved = true
  })
  return { owner, handle, exit, close, aggregate, proved: () => proved }
}
it('a rejected exit witness keeps a retired handle owned after successful close', async () => {
  const f = owned()
  const retiring = f.owner.retire(f.handle)
  f.owner.seal()
  f.exit.reject(new Error('fictional unreadable exit'))
  f.close.resolve()
  await retiring
  await f.owner.closeAll()
  expect(await f.owner.mayReopen()).toBe(false)
  expect(f.proved()).toBe(false)
  expect(f.owner.awaitProcessExit()).toBe(f.aggregate)
  expect(f.handle.close).toHaveBeenCalledOnce()
})
it('a rejected close is retained and never becomes proof even after the exit resolves', async () => {
  const f = owned(),
    error = new Error('fictional cleanup failed')
  const retiring = f.owner.retire(f.handle)
  const rejected = expect(retiring).rejects.toBe(error)
  expect(f.owner.retire(f.handle)).toBe(retiring)
  f.owner.seal()
  f.exit.resolve()
  f.close.reject(error)
  await rejected
  await f.owner.closeAll()
  expect(await f.owner.mayReopen()).toBe(false)
  expect(f.proved()).toBe(false)
  expect(f.handle.close).toHaveBeenCalledOnce()
  await expect(f.owner.retire(f.handle)).rejects.toBe(error)
})
it('successful close and exit release the same retired aggregate only after both facts', async () => {
  const f = owned()
  const retiring = f.owner.retire(f.handle)
  f.owner.seal()
  f.close.resolve()
  await retiring
  expect(await f.owner.mayReopen()).toBe(false)
  expect(f.proved()).toBe(false)
  f.exit.resolve()
  await f.aggregate
  expect(await f.owner.mayReopen()).toBe(true)
  expect(f.proved()).toBe(true)
  expect(f.handle.close).toHaveBeenCalledOnce()
})
