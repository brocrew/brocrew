import type { Worker } from 'node:worker_threads'
import type { StorageError } from '../../shared/storage'
import type { StorageReply, StorageRequest, StorageRoots } from './engine'
import { STORAGE_STALL_TIMEOUT } from './engine'

interface StorageWorker {
  once(...args: Parameters<Worker['once']>): void
  on(...args: Parameters<Worker['on']>): void
  terminate: Worker['terminate']
}
export type StorageWorkerFactory = (roots: StorageRoots, request: StorageRequest) => StorageWorker
type Result = { ok: true; value: StorageReply } | { ok: false; error: StorageError }
type WorkerMessage = Result | { progress: true }

/**
 * Permits stay held until worker exit, including after cancellation and stalls. A request fails with
 * `limit` only when its worker reports no progress for `stall` milliseconds; a slow walk that keeps
 * reporting is left to finish, and a worker that exits is handled by its exit event.
 */
export class StorageService {
  private readonly active = new Set<() => void>()
  private closed = false
  constructor(
    private readonly roots: StorageRoots,
    private readonly start: StorageWorkerFactory,
    private readonly stall = STORAGE_STALL_TIMEOUT,
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
      const stalled = (): void => {
        finish({ ok: false, error: 'limit' })
        stop()
      }
      let timer = setTimeout(stalled, this.stall)
      this.active.add(abort)
      worker.on('message', (message: WorkerMessage) => {
        if ('progress' in message) {
          if (settled) return
          clearTimeout(timer)
          timer = setTimeout(stalled, this.stall)
          return
        }
        finish(message)
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
