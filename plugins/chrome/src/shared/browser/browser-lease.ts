export class OperationBlockedError extends Error {
  constructor() {
    super('a browser transition is in progress')
    this.name = 'OperationBlockedError'
  }
}
export class OperationTimeoutError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`a browser operation exceeded its ${deadlineMs}ms deadline`)
    this.name = 'OperationTimeoutError'
  }
}
export interface TransitionBarrier {
  isTransitioning(): boolean
  inFlight(): number
  runOp<T>(fn: () => Promise<T>): Promise<T>
  transition<T>(fn: () => Promise<T>): Promise<T>
}
export function createTransitionBarrier(): TransitionBarrier {
  let transitioning = false
  let count = 0
  let drained: Promise<void> = Promise.resolve()
  let resolveDrain: (() => void) | null = null
  let transitionChain: Promise<unknown> = Promise.resolve()
  function settleDrainIfIdle(): void {
    if (count === 0 && resolveDrain) {
      const r = resolveDrain
      resolveDrain = null
      r()
    }
  }
  async function runOp<T>(fn: () => Promise<T>): Promise<T> {
    if (transitioning) throw new OperationBlockedError()
    count++
    try {
      return await fn()
    } finally {
      count--
      settleDrainIfIdle()
    }
  }
  function transition<T>(fn: () => Promise<T>): Promise<T> {
    const run = transitionChain.then(async () => {
      transitioning = true
      if (count > 0) {
        drained = new Promise<void>((res) => {
          resolveDrain = res
        })
        await drained
      }
      try {
        return await fn()
      } finally {
        transitioning = false
      }
    })
    transitionChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  return {
    isTransitioning: () => transitioning,
    inFlight: () => count,
    runOp,
    transition,
  }
}
export interface KeyedSerializer {
  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T>
  activeKeys(): number
}
export function createKeyedSerializer(): KeyedSerializer {
  const chains = new Map<string, Promise<unknown>>()
  function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    chains.set(key, tail)
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key)
    })
    return run
  }
  return { runExclusive, activeKeys: () => chains.size }
}
