import type { Worker } from 'node:worker_threads'
import {
  limitsReadInput,
  limitsReadResult,
  LimitsReadUnavailable,
  type LimitsReadInput,
  type LimitsReadResult,
} from './limits-read-protocol'

type ReadWorker = Pick<Worker, 'postMessage' | 'on' | 'terminate'>
type Pending = {
  readonly id: number
  readonly input: LimitsReadInput
  readonly resolve: (read: LimitsReadResult) => void
  readonly reject: (error: unknown) => void
}

/** Completion or confirmed exit releases a native read; a caller timeout does not. */
export class LimitsWorkerTransport {
  private readonly ready: Promise<void>
  private readonly exited: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: unknown) => void
  private resolveExit!: () => void
  private pending: Pending | undefined
  private nextId = 0
  private closed = false
  private failed = false
  private terminationRequested = false

  constructor(private readonly worker: ReadWorker) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => {})
    this.exited = new Promise<void>((resolve) => {
      this.resolveExit = resolve
    })
    worker.on('message', (incoming: unknown) => this.receive(incoming))
    worker.on('error', () => this.fail())
    worker.on('exit', () => {
      this.failed = true
      this.rejectReady(new LimitsReadUnavailable(this.closed ? 'closed' : 'failed'))
      this.pending?.reject(new LimitsReadUnavailable(this.closed ? 'closed' : 'failed'))
      this.pending = undefined
      this.resolveExit()
    })
  }

  get whenExited(): Promise<void> {
    return this.exited
  }

  async execute(input: LimitsReadInput): Promise<LimitsReadResult> {
    if (this.closed) throw new LimitsReadUnavailable('closed')
    if (this.failed) {
      await this.exited
      throw new LimitsReadUnavailable('failed')
    }
    if (this.pending !== undefined) throw new LimitsReadUnavailable('busy')
    if (!Number.isSafeInteger(this.nextId + 1)) throw new LimitsReadUnavailable('failed')
    const wanted = limitsReadInput.parse(input)
    const id = ++this.nextId
    const result = new Promise<LimitsReadResult>((resolve, reject) => {
      this.pending = { id, input: wanted, resolve, reject }
    })
    void result.catch(() => {})
    try {
      await this.ready
      if (this.closed || this.failed) throw new LimitsReadUnavailable('failed')
      this.worker.postMessage({ type: 'read', id, input: wanted })
    } catch {
      this.fail()
    }
    return result
  }

  async stop(terminateAfterMs = 3000): Promise<void> {
    if (!Number.isFinite(terminateAfterMs) || terminateAfterMs <= 0)
      throw new RangeError('Invalid stop deadline')
    if (!this.closed) {
      this.closed = true
      this.rejectReady(new LimitsReadUnavailable('closed'))
      try {
        this.worker.postMessage({ type: 'close' })
      } catch {
        this.fail()
      }
    }
    const timer = setTimeout(() => this.terminate(), terminateAfterMs)
    try {
      await this.exited
    } finally {
      clearTimeout(timer)
    }
  }

  private receive(incoming: unknown): void {
    if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
      this.fail()
      return
    }
    const message = incoming as Record<string, unknown>
    if (message.type === 'ready') {
      if (!this.closed && !this.failed) this.resolveReady()
      return
    }
    if (message.type === 'unavailable') {
      this.fail()
      return
    }
    const pending = this.pending
    if (pending === undefined || message.id !== pending.id) return
    if (this.failed) return
    if (message.type === 'failed') {
      this.pending = undefined
      pending.reject(new LimitsReadUnavailable(message.why === 'overflow' ? 'overflow' : 'failed'))
      return
    }
    const parsed = limitsReadResult.safeParse(message.read)
    if (
      message.type !== 'read' ||
      !parsed.success ||
      parsed.data.operation !== pending.input.operation ||
      parsed.data.databaseEpoch !== pending.input.databaseEpoch ||
      parsed.data.signInEpoch !== pending.input.signInEpoch ||
      parsed.data.inputCapturedAt !== pending.input.capturedAt
    ) {
      this.fail()
      return
    }
    this.pending = undefined
    if (this.closed) pending.reject(new LimitsReadUnavailable('closed'))
    else pending.resolve(parsed.data)
  }

  private fail(): void {
    this.failed = true
    this.rejectReady(new LimitsReadUnavailable('failed'))
    // Do not settle the native promise until exit proves its connection has stopped.
    this.terminate()
  }

  private terminate(): void {
    if (this.terminationRequested) return
    this.terminationRequested = true
    void this.worker.terminate().catch(() => {})
  }
}
