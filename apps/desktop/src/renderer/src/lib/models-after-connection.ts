import type { Provider } from '../../../shared/runtime-ipc'
import type { ModelLists } from './model-lists'

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/** A completed connection gesture may need two brief retries before the catalogue is ready. */
export async function modelsAfterConnection(
  lists: Pick<ModelLists, 'read' | 'held'>,
  provider: Provider,
  signal: AbortSignal,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = pause,
): Promise<void> {
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    await lists.read(provider)
    if (signal.aborted) return
    const held = lists.held(provider)
    if (held?.state === 'answered' && held.list.notAsked === null) return
    if (attempt < 2) await wait(150 * (attempt + 1), signal)
  }
}
