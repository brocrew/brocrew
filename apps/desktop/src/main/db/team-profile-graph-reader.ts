import type { Worker } from 'node:worker_threads'
import { serialize } from 'node:v8'
import {
  TEAM_PROFILE_GRAPH_BOUNDS as B,
  teamProfileGraphRequest,
  teamProfileGraphResult,
  graphReadContext,
  graphUnavailable,
  type TeamProfileGraphReader,
  type TeamProfileGraphRequest,
  type TeamProfileGraphResult,
  type TeamProfileGraphReadContext,
} from '../../shared/team-profile-graph'

export interface GraphWorker {
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  postMessage: Worker['postMessage']
  terminate: Worker['terminate']
}
type Job = {
  id: number
  request: TeamProfileGraphRequest
  context: TeamProfileGraphReadContext
  resolve: (result: TeamProfileGraphResult) => void
  flag: Int32Array
  timer?: ReturnType<typeof setTimeout>
}
type Owned = {
  worker: GraphWorker
  ready: boolean
  expired: boolean
  failed: boolean
  terminating: boolean
  exited: Promise<void>
  resolveExit: () => void
}

/** One native job and one replaceable successor; a native permit lasts until reply or verified exit. */
export class TeamProfileGraphLifetime implements TeamProfileGraphReader {
  private owned: Owned | undefined
  private active: Job | undefined
  private waiting: Job | undefined
  private sequence = 0
  private closed = false
  private everStarted = false
  private restartTimes: number[] = []

  constructor(
    private readonly start: () => GraphWorker,
    private readonly now: () => number = () => performance.now(),
    private readonly deadlineMs: number = B.parentDeadlineMs,
    private readonly admission: () => number = () => 0,
    private readonly failure: () => void = () => {},
  ) {}

  read(
    input: TeamProfileGraphRequest,
    context: TeamProfileGraphReadContext,
  ): Promise<TeamProfileGraphResult> {
    const request = teamProfileGraphRequest.safeParse(input)
    const source = graphReadContext.safeParse(context)
    if (!request.success || !source.success) return Promise.resolve(graphUnavailable('worker'))
    if (this.closed) return Promise.resolve(graphUnavailable('closed'))
    if (!Number.isSafeInteger(this.sequence + 1)) return Promise.resolve(graphUnavailable('worker'))
    return new Promise((resolve) => {
      const job: Job = {
        id: ++this.sequence,
        request: request.data,
        context: source.data,
        resolve,
        flag: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
      }
      if (this.active === undefined) {
        this.active = job
        void this.begin(job)
      } else {
        Atomics.store(this.active.flag, 0, 1)
        this.waiting?.resolve(graphUnavailable('cancelled'))
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
    this.waiting?.resolve(graphUnavailable('closed'))
    this.waiting = undefined
    if (this.active !== undefined) Atomics.store(this.active.flag, 0, 1)
    const owned = this.owned
    if (owned === undefined) {
      this.finish(graphUnavailable('closed'))
      return
    }
    this.fail(owned)
    await owned.exited
  }

  private async begin(job: Job): Promise<void> {
    if (this.closed) {
      this.finish(graphUnavailable('closed'))
      return
    }
    const previous = this.owned
    if (previous?.failed) {
      await previous.exited
      if (this.closed) {
        this.finish(graphUnavailable('closed'))
        return
      }
      if (this.owned === previous) this.owned = undefined
    }
    if (this.owned === undefined) {
      const now = this.now()
      this.restartTimes = this.restartTimes.filter((at) => now - at < B.restartWindowMs)
      if (this.everStarted && this.restartTimes.length >= B.restarts) {
        this.finish(
          graphUnavailable(
            'busy',
            'roster',
            0,
            0,
            Math.max(1, B.restartWindowMs - (now - this.restartTimes[0]!)),
          ),
        )
        return
      }
      const retryAfterMs = this.admission()
      if (retryAfterMs > 0) {
        this.finish(graphUnavailable('busy', 'roster', 0, 0, retryAfterMs))
        return
      }
      if (this.everStarted) this.restartTimes.push(now)
      this.everStarted = true
      try {
        this.owned = this.subscribe(this.start())
      } catch {
        this.failure()
        this.finish(graphUnavailable('worker'))
        return
      }
    }
    if (this.active !== job) return
    job.timer = setTimeout(() => {
      if (this.owned !== undefined) this.fail(this.owned)
    }, this.deadlineMs)
    if (this.owned.ready) this.post(job, this.owned)
  }

  private subscribe(worker: GraphWorker): Owned {
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
      if (!owned.failed && !this.closed && !owned.expired) this.failure()
      owned.failed = true
      owned.resolveExit()
      if (this.owned === owned)
        this.finish(graphUnavailable(this.closed ? 'closed' : owned.expired ? 'expired' : 'worker'))
    })
    return owned
  }
  private post(job: Job, owned: Owned): void {
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
    if (message.type === 'expired' && Object.keys(message).length === 1 && owned.ready) {
      owned.expired = true
      owned.failed = true
      return
    }
    const job = this.active
    if (
      !owned.ready ||
      job === undefined ||
      message.type !== 'read' ||
      Object.keys(message).length !== 3 ||
      message.id !== job.id ||
      serialize(message.result).byteLength > B.replyBytes
    ) {
      this.fail(owned)
      return
    }
    const parsed = teamProfileGraphResult.safeParse(message.result)
    const expected = job.request.operation === 'release' ? 'released' : job.request.operation
    if (!parsed.success || (parsed.data.type !== 'unavailable' && parsed.data.type !== expected)) {
      this.fail(owned)
      return
    }
    this.finish(Atomics.load(job.flag, 0) !== 0 ? graphUnavailable('cancelled') : parsed.data)
  }
  private finish(result: TeamProfileGraphResult): void {
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
    if (!owned.failed && !this.closed) this.failure()
    owned.failed = true
    if (owned.terminating) return
    owned.terminating = true
    // The exit listener releases the active permit; terminate's promise alone never does.
    void owned.worker.terminate().catch(() => {})
  }
}
