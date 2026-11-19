import type { Worker } from 'node:worker_threads'
import {
  WINDOW_READ_BOUNDS,
  WindowReadUnavailable,
  windowReadFailure,
  windowReadQuery,
  windowReadResult,
  type WindowReadQuery,
  type WindowReadResult,
  type WindowStoreReader,
} from './window-read-protocol'

const monotonicUs = () => Number(process.hrtime.bigint() / 1_000n)

type ReadTiming = {
  readonly enqueuedUs: number
  phase: 'enqueued' | 'posted' | 'start' | 'end'
  cancelled: boolean
}

type TimingPhase = 'enqueue' | 'post' | 'start' | 'end' | 'cancel' | 'release' | 'busy'
type TimingReport = (phase: TimingPhase, facts: Record<string, unknown>) => void

type Pending = {
  readonly kind: WindowReadQuery['kind']
  readonly resolve: (result: WindowReadResult) => void
  readonly reject: (error: unknown) => void
  readonly cleanUp: () => void
  readonly cancel: () => void
  readonly timing?: ReadTiming
}

/** The worker operations used by the reader; subscribing does not use the fluent return value. */
export interface WindowReadWorker {
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  postMessage: Worker['postMessage']
  terminate: Worker['terminate']
}

/** Owns one worker until confirmed exit, with a bounded queue and no synchronous fallback. */
export class WindowWorkerReader implements WindowStoreReader {
  private readonly ready: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: unknown) => void
  private readonly exited: Promise<void>
  private resolveExit!: () => void
  private readonly pending = new Map<number, Pending>()
  private nextId = 0
  private closed = false
  private failed = false
  private failureCause: string | undefined
  private closeError: { error: unknown } | undefined
  private terminating = false
  private readonly reportTiming?: TimingReport

  constructor(private readonly worker: WindowReadWorker, reportTiming?: TimingReport) {
    if (reportTiming !== undefined) {
      this.reportTiming = (phase, facts) => {
        try {
          reportTiming(phase, facts)
        } catch {
          // Debug output must never change a read's outcome.
        }
      }
    }
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => {})
    this.exited = new Promise((resolve) => {
      this.resolveExit = resolve
    })
    worker.on('message', (message: unknown) => this.receive(message))
    worker.on('error', (error) => this.fail(error.message))
    worker.on('exit', (code) => {
      this.failureCause ??= `The window reader exited with code ${code}.`
      this.failed = true
      this.rejectReady(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
      for (const [id, one] of this.pending) {
        one.cleanUp()
        one.reject(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
        this.reportTiming?.('release', { id, kind: one.kind, atUs: monotonicUs(), outcome: 'exit' })
      }
      this.pending.clear()
      this.resolveExit()
    })
  }

  get whenExited(): Promise<void> {
    return this.exited
  }

  async read(input: WindowReadQuery, signal?: AbortSignal): Promise<WindowReadResult> {
    if (this.closed || this.failed)
      throw new WindowReadUnavailable('unavailable', undefined, this.failureCause)
    if (this.pending.size >= WINDOW_READ_BOUNDS.pending) {
      if (this.reportTiming !== undefined) {
        const atUs = monotonicUs()
        const owners = [...this.pending].map(([id, { kind, timing }]) => ({
          id,
          kind,
          phase: timing?.phase,
          cancelled: timing?.cancelled,
          ageUs: timing === undefined ? undefined : atUs - timing.enqueuedUs,
        }))
        this.reportTiming('busy', { atUs, owners })
      }
      throw new WindowReadUnavailable('busy')
    }
    const query = windowReadQuery.parse(input)
    if (signal?.aborted)
      throw new WindowReadUnavailable('unavailable', undefined, this.failureCause)
    if (!Number.isSafeInteger(this.nextId + 1))
      throw new WindowReadUnavailable('unavailable', undefined, this.failureCause)
    const id = ++this.nextId
    const timing: ReadTiming | undefined =
      this.reportTiming === undefined
        ? undefined
        : { enqueuedUs: monotonicUs(), phase: 'enqueued', cancelled: false }
    // The caller can set this flag while the worker is inside synchronous SQLite.
    const flag = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
    let posted = false
    const cleanUp = () => signal?.removeEventListener('abort', abandoned)
    const abandoned = () => {
      Atomics.store(flag, 0, 1)
      if (timing !== undefined && !timing.cancelled) {
        timing.cancelled = true
        this.reportTiming?.('cancel', { id, kind: query.kind, atUs: monotonicUs(), posted })
      }
      // Only an unposted job releases its permit here; a native job must first answer or exit.
      if (!posted) {
        const pending = this.pending.get(id)
        this.pending.delete(id)
        cleanUp()
        pending?.reject(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
        if (pending !== undefined)
          this.reportTiming?.('release', {
            id,
            kind: query.kind,
            atUs: monotonicUs(),
            outcome: 'cancelled-unposted',
          })
      }
    }
    const result = new Promise<WindowReadResult>((resolve, reject) => {
      this.pending.set(id, { kind: query.kind, resolve, reject, cleanUp, cancel: abandoned, timing })
    })
    if (timing !== undefined)
      this.reportTiming?.('enqueue', { id, kind: query.kind, atUs: timing.enqueuedUs })
    void result.catch(() => {})
    signal?.addEventListener('abort', abandoned, { once: true })
    void this.ready
      .then(() => {
        if (!this.pending.has(id)) return
        if (this.closed || this.failed)
          throw new WindowReadUnavailable('unavailable', undefined, this.failureCause)
        posted = true
        const postUs = timing === undefined ? undefined : monotonicUs()
        this.worker.postMessage({
          type: 'read',
          id,
          query,
          cancellation: flag.buffer,
        })
        if (timing !== undefined) {
          timing.phase = 'posted'
          this.reportTiming?.('post', { id, kind: query.kind, atUs: postUs })
        }
      })
      .catch((error: unknown) => {
        if (!this.closed) this.fail(error instanceof Error ? error.message : String(error))
      })
    return result
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      for (const one of this.pending.values()) one.cancel()
      this.rejectReady(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
      this.retire()
    }
    await this.exited
    if (this.closeError) throw this.closeError.error
  }

  private receive(incoming: unknown): void {
    if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
      this.fail()
      return
    }
    const message = incoming as Record<string, unknown>
    if (this.reportTiming !== undefined && message.type === 'debug-window-read-timing') {
      const { id, phase, atUs } = message
      if (
        typeof id !== 'number' ||
        typeof atUs !== 'number' ||
        !Number.isSafeInteger(atUs) ||
        atUs < 0 ||
        (phase !== 'start' && phase !== 'end')
      )
        return
      const pending = this.pending.get(id)
      if (pending?.timing === undefined) return
      if (pending.timing.phase !== (phase === 'start' ? 'posted' : 'start')) return
      pending.timing.phase = phase
      this.reportTiming(phase, { id, kind: pending.kind, atUs })
      return
    }
    if (message.type === 'ready') {
      if (!this.closed && !this.failed) this.resolveReady()
      return
    }
    if (message.type === 'unavailable') {
      this.fail(typeof message.cause === 'string' ? message.cause : undefined)
      return
    }
    if (typeof message.id !== 'number') {
      this.fail()
      return
    }
    const pending = this.pending.get(message.id)
    if (pending === undefined || this.failed) return
    const receivedUs = this.reportTiming === undefined ? undefined : monotonicUs()
    if (message.type === 'failed') {
      this.pending.delete(message.id)
      pending.cleanUp()
      const failure = windowReadFailure.safeParse(message.reason)
      pending.reject(
        new WindowReadUnavailable(
          'failed',
          failure.success ? failure.data : 'worker-read-failed',
          typeof message.cause === 'string' ? message.cause : undefined,
        ),
      )
      this.reportTiming?.('release', {
        id: message.id,
        kind: pending.kind,
        atUs: monotonicUs(),
        receivedUs,
        outcome: 'failed',
      })
      return
    }
    const parsed = windowReadResult.safeParse(message.result)
    if (message.type !== 'read' || !parsed.success || parsed.data.kind !== pending.kind) {
      this.fail()
      return
    }
    this.pending.delete(message.id)
    pending.cleanUp()
    if (this.closed)
      pending.reject(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
    else pending.resolve(parsed.data as WindowReadResult)
    this.reportTiming?.('release', {
      id: message.id,
      kind: pending.kind,
      atUs: monotonicUs(),
      receivedUs,
      outcome: 'read',
    })
  }

  private fail(cause?: string): void {
    this.failureCause ??= cause
    this.failed = true
    this.rejectReady(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
    for (const pending of this.pending.values()) {
      pending.cancel()
      pending.reject(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
    }
    this.retire()
  }

  private retire(): void {
    if (this.terminating) return
    this.terminating = true
    try {
      this.worker.postMessage({ type: 'close' })
    } catch (error) {
      this.closeError = { error }
    }
  }
}

/** A failed reader may be replaced once, after exit proves its native connection is gone. */
export class WindowReaderLifetime implements WindowStoreReader {
  private owned: WindowWorkerReader | undefined
  private closed = false
  private created = 0
  private lastCause: string | undefined

  constructor(private readonly start: () => WindowWorkerReader) {}

  async read(input: WindowReadQuery, signal?: AbortSignal): Promise<WindowReadResult> {
    const query = windowReadQuery.parse(input)
    if (this.closed) throw new WindowReadUnavailable()
    if (this.owned === undefined) {
      if (this.created >= 2) throw new WindowReadUnavailable('restart', undefined, this.lastCause)
      this.created++
      let reader: WindowWorkerReader
      try {
        reader = this.start()
      } catch (error) {
        this.lastCause = error instanceof Error ? error.message : String(error)
        throw new WindowReadUnavailable(
          'unavailable',
          undefined,
          error instanceof Error ? error.message : String(error),
        )
      }
      this.owned = reader
      void reader.whenExited.then(() => {
        if (this.owned === reader) this.owned = undefined
      })
    }
    try {
      return await this.owned.read(query, signal)
    } catch (error) {
      if (error instanceof WindowReadUnavailable) this.lastCause = error.readCause ?? error.message
      throw error
    }
  }

  async close(): Promise<void> {
    this.closed = true
    await this.owned?.close()
  }
}
