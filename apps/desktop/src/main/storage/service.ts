import type { Worker } from 'node:worker_threads'
import type { StorageError } from '../../shared/storage'
import type { StorageReply, StorageRequest, StorageRoots } from './engine'

export interface StorageWorker {
  once(...args: Parameters<Worker['once']>): void
  terminate: Worker['terminate']
}
export type StorageWorkerFactory = (roots: StorageRoots, request: StorageRequest) => StorageWorker
type Result = { ok: true; value: StorageReply } | { ok: false; error: StorageError }

/** Permits stay held until worker exit, including after cancellation and timeouts. */
export class StorageService {
  private readonly active = new Set<() => void>()
  private closed = false
  constructor(
    private readonly roots: StorageRoots,
    private readonly start: StorageWorkerFactory,
    private readonly timeout = 15_000,
  ) {}

  run(request: StorageRequest, signal?: AbortSignal): Promise<Result> {
    if (this.closed || signal?.aborted) return Promise.resolve({ ok: false, error: 'cancelled' })
    if (this.active.size >= 2) return Promise.resolve({ ok: false, error: 'busy' })
    return new Promise((resolve) => {
      let worker: StorageWorker
      try {
        worker = this.start(this.roots, request)
      } catch {
        resolve({ ok: false, error: 'unavailable' })
        return
      }
      let settled = false
      let stopping = false
      const finish = (result: Result): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        resolve(result)
      }
      const stop = (): void => {
        if (stopping) return
        stopping = true
        void worker.terminate().catch(() => {})
      }
      const abort = (): void => {
        finish({ ok: false, error: 'cancelled' })
        stop()
      }
      const timer = setTimeout(() => {
        finish({ ok: false, error: 'limit' })
        stop()
      }, this.timeout)
      this.active.add(abort)
      worker.once('message', (result: Result) => {
        finish(result)
        stop()
      })
      worker.once('error', () => {
        finish({ ok: false, error: 'unavailable' })
        stop()
      })
      worker.once('exit', () => {
        this.active.delete(abort)
        finish({ ok: false, error: 'unavailable' })
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }

  close(): void {
    this.closed = true
    for (const abort of this.active) abort()
  }
}
