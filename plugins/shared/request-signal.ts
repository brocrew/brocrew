import { AsyncLocalStorage } from 'node:async_hooks'
const scope = new AsyncLocalStorage<AbortSignal>()
export function withRequestSignal<T>(signal: AbortSignal, fn: () => T): T {
  return scope.run(signal, fn)
}
export function currentRequestSignal(): AbortSignal | undefined {
  return scope.getStore()
}
