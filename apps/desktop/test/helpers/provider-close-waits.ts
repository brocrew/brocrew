import type { SessionHandle } from '@brobot2/runtime'

/** True when the promise has not settled after `ms`: it is still waiting, whichever way it ends. */
export async function stillWaiting(promise: Promise<unknown>, ms = 100): Promise<boolean> {
  const quiet = Symbol('quiet')
  const first = await Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled',
    ),
    new Promise<typeof quiet>((resolve) => setTimeout(() => resolve(quiet), ms)),
  ])
  return first === quiet
}

/**
 * A handle whose `close()` can be held open, for the case where termination cannot be confirmed. A
 * Proxy rather than a subclass or a spread: the Fake's state lives in own fields its own methods
 * mutate, so anything that re-homes `this` quietly stops being the session under test.
 */
export function gateClose(
  handle: SessionHandle,
  gate: Promise<void>,
  onClose: () => void,
): { handle: SessionHandle; closed: () => boolean } {
  let finished = false
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          onClose()
          await gate
          await target.close()
          finished = true
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return { handle: proxied, closed: () => finished }
}
