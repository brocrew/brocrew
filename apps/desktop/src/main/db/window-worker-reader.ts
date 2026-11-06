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

type Pending = {
  readonly kind: WindowReadQuery['kind']
  readonly resolve: (result: WindowReadResult) => void
  readonly reject: (error: unknown) => void
  readonly cleanUp: () => void
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
  private terminating = false

  constructor(private readonly worker: WindowReadWorker) {
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
      for (const one of this.pending.values()) {
        one.cleanUp()
        one.reject(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
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
    if (this.pending.size >= WINDOW_READ_BOUNDS.pending) throw new WindowReadUnavailable('busy')
    const query = windowReadQuery.parse(input)
    if (signal?.aborted)
      throw new WindowReadUnavailable('unavailable', undefined, this.failureCause)
    if (!Number.isSafeInteger(this.nextId + 1))
      throw new WindowReadUnavailable('unavailable', undefined, this.failureCause)
    const id = ++this.nextId
    // The caller can set this flag while the worker is inside synchronous SQLite.
    const flag =
      signal !== undefined
        ? new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
        : undefined
    let posted = false
    const cleanUp = () => signal?.removeEventListener('abort', abandoned)
    const abandoned = () => {
      if (flag !== undefined) Atomics.store(flag, 0, 1)
      // Only an unposted job releases its permit here; a native job must first answer or exit.
      if (!posted) {
        const pending = this.pending.get(id)
        this.pending.delete(id)
        cleanUp()
        pending?.reject(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
      }
    }
    const result = new Promise<WindowReadResult>((resolve, reject) => {
      this.pending.set(id, { kind: query.kind, resolve, reject, cleanUp })
    })
    void result.catch(() => {})
    signal?.addEventListener('abort', abandoned, { once: true })
    void this.ready
      .then(() => {
        if (!this.pending.has(id)) return
        if (this.closed || this.failed)
          throw new WindowReadUnavailable('unavailable', undefined, this.failureCause)
        posted = true
        this.worker.postMessage({
          type: 'read',
          id,
          query,
          ...(flag === undefined ? {} : { cancellation: flag.buffer }),
        })
      })
      .catch((error: unknown) => this.fail(error instanceof Error ? error.message : String(error)))
    return result
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.rejectReady(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
      try {
        this.worker.postMessage({ type: 'close' })
      } catch (error) {
        this.fail(error instanceof Error ? error.message : String(error))
      }
    }
    const timer = setTimeout(() => this.terminate(), 3000)
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
      this.fail(typeof message.cause === 'string' ? message.cause : undefined)
      return
    }
    if (typeof message.id !== 'number') {
      this.fail()
      return
    }
    const pending = this.pending.get(message.id)
    if (pending === undefined || this.failed) return
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
  }

  private fail(cause?: string): void {
    this.failureCause ??= cause
    this.failed = true
    this.rejectReady(new WindowReadUnavailable('unavailable', undefined, this.failureCause))
    this.terminate()
  }

  private terminate(): void {
    if (this.terminating) return
    this.terminating = true
    void this.worker.terminate().catch(() => {})
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
