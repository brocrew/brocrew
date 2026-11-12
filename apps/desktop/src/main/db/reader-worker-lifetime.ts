import type { Worker } from 'node:worker_threads'
import { serialize } from 'node:v8'

export interface ReaderWorker {
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  postMessage: Worker['postMessage']
  terminate: Worker['terminate']
}

/** What one reader decides; the lifetime below decides nothing about results. */
export interface ReaderRules<Request, Result> {
  readonly bounds: {
    readonly restarts: number
    readonly restartWindowMs: number
    readonly replyBytes: number
  }
  unavailable(cause: 'closed' | 'cancelled' | 'worker' | 'busy', retryAfterMs?: number): Result
  /** The reply's result when it answers the request, or undefined when the worker misbehaved. */
  accept(result: unknown, request: Request): Result | undefined
  /** Milliseconds to wait before a new worker may start; 0 starts it now. */
  admission?(): number
  /** Called once when a worker fails while the reader is open. */
  failure?(): void
  /** The answer after the worker says it expired; without it, an expiry message is misbehavior. */
  expired?(): Result
}

type Job<Request, Context, Result> = {
  id: number
  request: Request
  context: Context
  resolve: (result: Result) => void
  flag: Int32Array
  progress: number
  timer?: ReturnType<typeof setTimeout>
}
type Owned = {
  worker: ReaderWorker
  ready: boolean
  expired: boolean
  failed: boolean
  terminating: boolean
  exited: Promise<void>
  resolveExit: () => void
}

/** One native job and one replaceable successor; a native permit lasts until reply or verified exit. */
export class ReaderWorkerLifetime<Request, Context, Result> {
  private owned: Owned | undefined
  private active: Job<Request, Context, Result> | undefined
  private waiting: Job<Request, Context, Result> | undefined
  private sequence = 0
  private closed = false
  private everStarted = false
  private restartTimes: number[] = []

  constructor(
    private readonly start: () => ReaderWorker,
    private readonly now: () => number,
    private readonly deadlineMs: number,
    private readonly rules: ReaderRules<Request, Result>,
  ) {}

  read(request: Request, context: Context): Promise<Result> {
    if (this.closed) return Promise.resolve(this.rules.unavailable('closed'))
    if (!Number.isSafeInteger(this.sequence + 1))
      return Promise.resolve(this.rules.unavailable('worker'))
    return new Promise((resolve) => {
      const job: Job<Request, Context, Result> = {
        id: ++this.sequence,
        request,
        context,
        resolve,
        progress: 0,
        flag: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      }
      if (this.active === undefined) {
        this.active = job
        void this.begin(job)
      } else {
        Atomics.store(this.active.flag, 0, 1)
        this.waiting?.resolve(this.rules.unavailable('cancelled'))
        this.waiting = job
      }
    })
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.owned?.exited
      return
    }
    this.closed = true
    this.waiting?.resolve(this.rules.unavailable('closed'))
    this.waiting = undefined
    if (this.active !== undefined) Atomics.store(this.active.flag, 0, 1)
    const owned = this.owned
    if (owned === undefined) {
      this.finish(this.rules.unavailable('closed'))
      return
    }
    this.fail(owned)
    await owned.exited
  }

  private async begin(job: Job<Request, Context, Result>): Promise<void> {
    const { bounds } = this.rules
    if (this.closed) {
      this.finish(this.rules.unavailable('closed'))
      return
    }
    const previous = this.owned
    if (previous?.failed) {
      await previous.exited
      if (this.closed) {
        this.finish(this.rules.unavailable('closed'))
        return
      }
      if (this.owned === previous) this.owned = undefined
    }
    if (this.owned === undefined) {
      const now = this.now()
      this.restartTimes = this.restartTimes.filter((at) => now - at < bounds.restartWindowMs)
      if (this.everStarted && this.restartTimes.length >= bounds.restarts) {
        this.finish(
          this.rules.unavailable(
            'busy',
            Math.max(1, bounds.restartWindowMs - (now - this.restartTimes[0]!)),
          ),
        )
        return
      }
      const retryAfterMs = this.rules.admission?.() ?? 0
      if (retryAfterMs > 0) {
        this.finish(this.rules.unavailable('busy', retryAfterMs))
        return
      }
      if (this.everStarted) this.restartTimes.push(now)
      this.everStarted = true
      try {
        this.owned = this.subscribe(this.start())
      } catch {
        this.rules.failure?.()
        this.finish(this.rules.unavailable('worker'))
        return
      }
    }
    if (this.active !== job) return
    this.watch(job, this.owned)
    if (this.owned.ready) this.post(job, this.owned)
  }

  private watch(job: Job<Request, Context, Result>, owned: Owned): void {
    clearTimeout(job.timer)
    job.timer = setTimeout(() => {
      if (this.active === job && this.owned === owned) this.fail(owned)
    }, this.deadlineMs)
  }

  private subscribe(worker: ReaderWorker): Owned {
    let resolveExit!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const owned: Owned = {
      worker,
      ready: false,
      expired: false,
      failed: false,
      terminating: false,
      exited,
      resolveExit,
    }
    worker.on('message', (message) => this.receive(owned, message))
    worker.on('error', () => this.fail(owned))
    worker.on('exit', () => {
      if (!owned.failed && !this.closed && !owned.expired) this.rules.failure?.()
      owned.failed = true
      owned.resolveExit()
      if (this.owned === owned)
        this.finish(
          this.closed
            ? this.rules.unavailable('closed')
            : owned.expired && this.rules.expired !== undefined
              ? this.rules.expired()
              : this.rules.unavailable('worker'),
        )
    })
    return owned
  }
  private post(job: Job<Request, Context, Result>, owned: Owned): void {
    try {
      owned.worker.postMessage({
        type: 'read',
        id: job.id,
        request: job.request,
        context: job.context,
        cancellation: job.flag.buffer,
      })
    } catch {
      this.fail(owned)
    }
  }
  private receive(owned: Owned, incoming: unknown): void {
    if (this.owned !== owned || owned.failed) return
    if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
      this.fail(owned)
      return
    }
    const message = incoming as Record<string, unknown>
    if (message.type === 'ready' && Object.keys(message).length === 1 && !owned.ready) {
      owned.ready = true
      if (this.active !== undefined) this.post(this.active, owned)
      return
    }
    if (
      this.rules.expired !== undefined &&
      message.type === 'expired' &&
      Object.keys(message).length === 1 &&
      owned.ready
    ) {
      owned.expired = true
      owned.failed = true
      return
    }
    const job = this.active
    if (
      owned.ready &&
      job !== undefined &&
      message.type === 'progress' &&
      Object.keys(message).length === 3 &&
      message.id === job.id &&
      typeof message.completed === 'number' &&
      Number.isSafeInteger(message.completed) &&
      message.completed > job.progress
    ) {
      job.progress = message.completed
      if (Atomics.load(job.flag, 0) === 0) this.watch(job, owned)
      return
    }
    if (
      !owned.ready ||
      job === undefined ||
      message.type !== 'read' ||
      Object.keys(message).length !== 3 ||
      message.id !== job.id ||
      serialize(message.result).byteLength > this.rules.bounds.replyBytes
    ) {
      this.fail(owned)
      return
    }
    const result = this.rules.accept(message.result, job.request)
    if (result === undefined) {
      this.fail(owned)
      return
    }
    this.finish(Atomics.load(job.flag, 0) !== 0 ? this.rules.unavailable('cancelled') : result)
  }
  private finish(result: Result): void {
    if (this.active?.timer !== undefined) clearTimeout(this.active.timer)
    this.active?.resolve(result)
    this.active = undefined
    if (this.waiting !== undefined) {
      this.active = this.waiting
      this.waiting = undefined
      void this.begin(this.active)
    }
  }
  private fail(owned: Owned): void {
    if (!owned.failed && !this.closed) this.rules.failure?.()
    owned.failed = true
    if (owned.terminating) return
    owned.terminating = true
    // The exit listener releases the active permit; terminate's promise alone never does.
    void owned.worker.terminate().catch(() => {})
  }
}
