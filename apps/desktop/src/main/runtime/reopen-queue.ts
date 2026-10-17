import type { MainThreadWork } from '../stall-watch'

export class ReopenQueue {
  private tail: Promise<void> = Promise.resolve()
  private closed = false

  constructor(private readonly timing?: Pick<MainThreadWork, 'timed'>) {}

  run(reopen: () => Promise<void>): Promise<void> {
    const next = this.tail.then(async () => {
      if (this.closed) return
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (!this.closed) {
        const started = this.timing
          ? this.timing.timed('runtime sign-in reopen admission', reopen)
          : reopen()
        await started
      }
    })
    this.tail = next.catch(() => {})
    return next
  }

  close(): void {
    this.closed = true
  }
}
