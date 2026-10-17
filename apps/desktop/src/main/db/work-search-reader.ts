import type { Worker } from 'node:worker_threads'
import {
  WORK_SEARCH_BOUNDS,
  workSearchQuery,
  workSearchResult,
  type WorkSearchQuery,
  type WorkSearchResult,
} from '../../shared/work-search'

export interface WorkSearchReader {
  read(caller: string, query: WorkSearchQuery): Promise<WorkSearchResult>
  close(): Promise<void>
}

export class WorkSearchWorkerReader implements WorkSearchReader {
  private closed = false
  private active: Worker | undefined
  private exiting: Promise<void> | undefined
  private readonly waiting: Array<() => void> = []

  constructor(private readonly start: (caller: string, query: WorkSearchQuery) => Worker) {}

  async read(caller: string, input: WorkSearchQuery): Promise<WorkSearchResult> {
    const parsed = workSearchQuery.safeParse(input)
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    if (this.closed) return { ok: false, reason: 'unavailable' }
    if (this.active !== undefined) {
      if (this.waiting.length === WORK_SEARCH_BOUNDS.waiting) return { ok: false, reason: 'busy' }
      return await new Promise<WorkSearchResult>((resolve) => {
        this.waiting.push(() => {
          void this.read(caller, parsed.data).then(resolve)
        })
      })
    }
    let worker: Worker
    try {
      worker = this.start(caller, parsed.data)
    } catch {
      this.waiting.shift()?.()
      return { ok: false, reason: 'unavailable' }
    }
    this.active = worker
    let result: WorkSearchResult = { ok: false, reason: 'unavailable' }
    let discarded = false
    let received = false
    let progress: WorkSearchResult | undefined
    const exit = new Promise<void>((resolve) => {
      worker.on('message', (message: unknown) => {
        if (discarded) return
        if (received) {
          discarded = true
          result = { ok: false, reason: 'unavailable' }
          void worker.terminate().catch(() => {})
          return
        }
        const checkpoint =
          typeof message === 'object' &&
          message !== null &&
          'kind' in message &&
          message.kind === 'progress' &&
          'result' in message
        const read = workSearchResult.safeParse(checkpoint ? message.result : message)
        if (
          checkpoint &&
          read.success &&
          read.data.ok &&
          !read.data.page.complete &&
          read.data.page.next_cursor !== null
        ) {
          progress = read.data
          return
        }
        received = true
        if (read.success && !checkpoint) result = read.data
        else {
          discarded = true
          void worker.terminate().catch(() => {})
        }
      })
      worker.on('error', () => {
        discarded = true
        result = { ok: false, reason: 'unavailable' }
        void worker.terminate().catch(() => {})
      })
      worker.once('exit', (code) => {
        if (code !== 0 || this.closed || discarded) result = { ok: false, reason: 'unavailable' }
        resolve()
      })
    })
    this.exiting = exit
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = exit.then(() => {
      clearTimeout(timer)
      if (this.active === worker) this.active = undefined
      if (this.exiting === exit) this.exiting = undefined
      this.waiting.shift()?.()
      return result
    })
    const deadline = new Promise<WorkSearchResult>((resolve) => {
      timer = setTimeout(() => {
        const partial =
          !discarded && !this.closed && !(received && !result.ok) ? progress : undefined
        discarded = true
        result = partial ?? { ok: false, reason: 'unavailable' }
        void worker.terminate().catch(() => {})
        resolve(result)
      }, WORK_SEARCH_BOUNDS.workerMs)
    })
    return await Promise.race([settled, deadline])
  }

  async close(): Promise<void> {
    this.closed = true
    for (const resume of this.waiting.splice(0)) resume()
    if (this.active !== undefined) {
      try {
        await this.active.terminate()
      } catch {
        // Keep the slot until the worker's exit is confirmed.
      }
    }
    await this.exiting
  }
}
