import type { SessionHandle } from './runtime'

/** A refused handle remains owned through bounded close and its captured process-exit fact. */
export class RejectedSessionLaunch extends Error {
  readonly processExit: Promise<void> | undefined
  readonly terminated: Promise<void>

  constructor(
    cause: unknown,
    handle: SessionHandle,
    readonly closing: Promise<void>,
  ) {
    super(cause instanceof Error ? cause.message : 'The session launch was refused', { cause })
    let exit: Promise<void> | undefined
    try {
      exit = handle.awaitProcessExit?.()
    } catch (error) {
      exit = Promise.reject(error)
    }
    this.processExit = exit
    this.terminated =
      exit === undefined ? closing : Promise.all([closing, exit]).then(() => undefined)
    void this.terminated.catch(() => {})
  }
}
