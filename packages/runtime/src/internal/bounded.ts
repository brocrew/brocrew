export function withTimeout(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
    const done = (): void => {
      clearTimeout(timer)
      resolve()
    }
    p.then(done, done)
  })
}

export class DidNotAnswerInTime extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DidNotAnswerInTime'
  }
}

export function didNotAnswerInTime(error: unknown): boolean {
  for (let one = error, depth = 0; one instanceof Error && depth < 8; depth += 1) {
    if (one instanceof DidNotAnswerInTime) return true
    one = one.cause
  }
  return false
}

export function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new DidNotAnswerInTime(`${what} did not answer within ${ms}ms`)),
      ms,
    )
    if (typeof timer.unref === 'function') timer.unref()
    p.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

export function assertNotCancelled(signal: AbortSignal | undefined, what: string): void {
  if (signal?.aborted === true) throw new Error(`${what} was cancelled before it started`)
}

export function untilCancelled<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  what: string,
): Promise<T> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(new Error(`${what} was cancelled`))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error(`${what} was cancelled`))
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export interface LaunchCancel {
  readonly cancelled: boolean
  release(): void
}

export function cancelWith(
  signal: AbortSignal | undefined,
  tearDown: () => Promise<void> | void,
): LaunchCancel {
  if (signal === undefined) return { cancelled: false, release: () => {} }
  const onAbort = (): void => {
    void (async () => tearDown())().catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return {
    get cancelled(): boolean {
      return signal.aborted
    },
    release: () => signal.removeEventListener('abort', onAbort),
  }
}
