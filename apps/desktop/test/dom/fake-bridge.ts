import type { RuntimeBridge } from '../../src/shared/runtime-ipc'

/** A runtime bridge for a whole-window test, and every verb the window called that it had no answer for. */
export interface FakeBridge {
  readonly bridge: RuntimeBridge
  readonly unexpected: readonly string[]
}

/**
 * The verbs it is handed answer as given. Any other verb the window calls is recorded and refused,
 * so a read the test did not answer shows in `unexpected`, even where the window's store turns
 * the refusal into "did not answer" and the screen goes on drawing. A deliberately partial test
 * passes `{ partial: true }`, and an unanswered verb then answers `null`, as a host that did not.
 */
export function aFakeBridge(
  answers: Partial<RuntimeBridge>,
  options: { readonly partial?: boolean } = {},
): FakeBridge {
  const unexpected: string[] = []
  const bridge = new Proxy(answers, {
    get(target, key) {
      if (typeof key !== 'string' || key in target || key === 'then')
        return Reflect.get(target, key)
      return () => {
        if (options.partial === true) return Promise.resolve(null)
        if (!unexpected.includes(key)) unexpected.push(key)
        return Promise.reject(new Error(`The fake bridge has no answer for ${key}.`))
      }
    },
  }) as RuntimeBridge
  return { bridge, unexpected }
}
