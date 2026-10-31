import type { Worker } from 'node:worker_threads'
import { serialize } from 'node:v8'
import {
  FILES_LIBRARY_BOUNDS as B,
  filesLibraryRequest,
  filesLibraryResult,
  libraryReadContext,
  libraryUnavailable,
  type FilesLibraryReader,
  type FilesLibraryRequest,
  type FilesLibraryResult,
  type LibraryReadContext,
} from '../../shared/files-library'

export interface LibraryWorker {
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  postMessage: Worker['postMessage']
  terminate: Worker['terminate']
}
type Job = {
  id: number
  request: FilesLibraryRequest
  context: LibraryReadContext
  resolve: (result: FilesLibraryResult) => void
  flag: Int32Array
  timer?: ReturnType<typeof setTimeout>
}
type Owned = {
  worker: LibraryWorker
  ready: boolean
  failed: boolean
  terminating: boolean
  exited: Promise<void>
  resolveExit: () => void
}

/** One native job and one replaceable successor; a native permit lasts until reply or verified exit. */
export class FilesLibraryLifetime implements FilesLibraryReader {
  private owned: Owned | undefined
  private active: Job | undefined
  private waiting: Job | undefined
  private sequence = 0
  private closed = false
  private everStarted = false
  private restartTimes: number[] = []

  constructor(
    private readonly start: () => LibraryWorker,
    private readonly now: () => number = Date.now,
    private readonly deadlineMs: number = B.parentDeadlineMs,
  ) {}

  read(input: FilesLibraryRequest, context: LibraryReadContext): Promise<FilesLibraryResult> {
    const request = filesLibraryRequest.safeParse(input)
    const source = libraryReadContext.safeParse(context)
    if (!request.success || !source.success) return Promise.resolve(libraryUnavailable('worker'))
    if (this.closed) return Promise.resolve(libraryUnavailable('closed'))
    if (!Number.isSafeInteger(this.sequence + 1))
      return Promise.resolve(libraryUnavailable('worker'))
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
        this.waiting?.resolve(libraryUnavailable('cancelled'))
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
    this.waiting?.resolve(libraryUnavailable('closed'))
    this.waiting = undefined
    if (this.active !== undefined) Atomics.store(this.active.flag, 0, 1)
    const owned = this.owned
    if (owned === undefined) {
      this.finish(libraryUnavailable('closed'))
      return
    }
    this.fail(owned)
    await owned.exited
  }

  private async begin(job: Job): Promise<void> {
    if (this.closed) {
      this.finish(libraryUnavailable('closed'))
      return
    }
    const previous = this.owned
    if (previous?.failed) {
      await previous.exited
      if (this.closed) {
        this.finish(libraryUnavailable('closed'))
        return
      }
      if (this.owned === previous) this.owned = undefined
    }
    if (this.owned === undefined) {
      const now = this.now()
      this.restartTimes = this.restartTimes.filter((at) => now - at < B.restartWindowMs)
      if (this.everStarted && this.restartTimes.length >= B.restarts) {
        this.finish(
          libraryUnavailable(
            'busy',
            0,
            0,
            Math.max(1, B.restartWindowMs - (now - this.restartTimes[0]!)),
          ),
        )
        return
      }
      if (this.everStarted) this.restartTimes.push(now)
      this.everStarted = true
      try {
        this.owned = this.subscribe(this.start())
      } catch {
        this.finish(libraryUnavailable('worker'))
        return
      }
    }
    if (this.active !== job) return
    job.timer = setTimeout(() => {
      if (this.owned !== undefined) this.fail(this.owned)
    }, this.deadlineMs)
    if (this.owned.ready) this.post(job, this.owned)
  }

  private subscribe(worker: LibraryWorker): Owned {
    let resolveExit!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const owned: Owned = {
      worker,
      ready: false,
      failed: false,
      terminating: false,
      exited,
      resolveExit,
    }
    worker.on('message', (message) => this.receive(owned, message))
    worker.on('error', () => this.fail(owned))
    worker.on('exit', () => {
      owned.failed = true
      owned.resolveExit()
      if (this.owned === owned) this.finish(libraryUnavailable(this.closed ? 'closed' : 'worker'))
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
    const parsed = filesLibraryResult.safeParse(message.result)
    const expected =
      job.request.operation === 'query' || job.request.operation === 'page'
        ? 'files'
        : job.request.operation === 'release'
          ? 'released'
          : job.request.operation
    if (!parsed.success || (parsed.data.type !== 'unavailable' && parsed.data.type !== expected)) {
      this.fail(owned)
      return
    }
    this.finish(Atomics.load(job.flag, 0) !== 0 ? libraryUnavailable('cancelled') : parsed.data)
  }
  private finish(result: FilesLibraryResult): void {
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
    owned.failed = true
    if (owned.terminating) return
    owned.terminating = true
    // The exit listener releases the active permit; terminate's promise alone never does.
    void owned.worker.terminate().catch(() => {})
  }
}
