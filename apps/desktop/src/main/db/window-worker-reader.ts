import type { Worker } from 'node:worker_threads'
import {
  WINDOW_READ_BOUNDS,
  WindowReadUnavailable,
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
    worker.on('error', () => this.fail())
    worker.on('exit', () => {
      this.failed = true
      this.rejectReady(new WindowReadUnavailable())
      for (const one of this.pending.values()) {
        one.cleanUp()
        one.reject(new WindowReadUnavailable())
      }
      this.pending.clear()
      this.resolveExit()
    })
  }

  get whenExited(): Promise<void> {
    return this.exited
  }

  async read(input: WindowReadQuery, signal?: AbortSignal): Promise<WindowReadResult> {
    if (this.closed || this.failed || this.pending.size >= WINDOW_READ_BOUNDS.pending)
      throw new WindowReadUnavailable()
    const query = windowReadQuery.parse(input)
    if (signal?.aborted) throw new WindowReadUnavailable()
    if (!Number.isSafeInteger(this.nextId + 1)) throw new WindowReadUnavailable()
    const id = ++this.nextId
    // The caller can set this flag while the worker is inside synchronous SQLite.
    const flag =
      query.kind === 'leads' && signal !== undefined
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
        pending?.reject(new WindowReadUnavailable())
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
        if (this.closed || this.failed) throw new WindowReadUnavailable()
        posted = true
        this.worker.postMessage({
          type: 'read',
          id,
          query,
          ...(flag === undefined ? {} : { cancellation: flag.buffer }),
        })
      })
      .catch(() => this.fail())
    return result
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.rejectReady(new WindowReadUnavailable())
      try {
        this.worker.postMessage({ type: 'close' })
      } catch {
        this.fail()
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
      this.fail()
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
      pending.reject(new WindowReadUnavailable('failed'))
      return
    }
    const parsed = windowReadResult.safeParse(message.result)
    if (message.type !== 'read' || !parsed.success || parsed.data.kind !== pending.kind) {
      this.fail()
      return
    }
    this.pending.delete(message.id)
    pending.cleanUp()
    if (this.closed) pending.reject(new WindowReadUnavailable())
    else pending.resolve(parsed.data as WindowReadResult)
  }

  private fail(): void {
    this.failed = true
    this.rejectReady(new WindowReadUnavailable())
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

  constructor(private readonly start: () => WindowWorkerReader) {}

  async read(input: WindowReadQuery, signal?: AbortSignal): Promise<WindowReadResult> {
    const query = windowReadQuery.parse(input)
    if (this.closed) throw new WindowReadUnavailable()
    if (this.owned === undefined) {
      if (this.created >= 2) throw new WindowReadUnavailable('restart')
      this.created++
      let reader: WindowWorkerReader
      try {
        reader = this.start()
      } catch {
        throw new WindowReadUnavailable()
      }
      this.owned = reader
      void reader.whenExited.then(() => {
        if (this.owned === reader) this.owned = undefined
      })
    }
    return this.owned.read(query, signal)
  }

  async close(): Promise<void> {
    this.closed = true
    await this.owned?.close()
  }
}
