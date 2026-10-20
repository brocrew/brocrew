import type { Worker } from 'node:worker_threads'
import {
  pastWorkSearchResult,
  type PastWorkSearchResult,
  type PastWorkSource,
} from '../../shared/past-work-search'

export class PastWorkSearchReader {
  private worker: Worker | undefined
  private closed = false
  private queued = 0
  private serial = 0
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly start: (file: string) => Worker) {}

  read(source: PastWorkSource, caller: string, words: string): Promise<PastWorkSearchResult> {
    if (this.closed || this.queued >= 8)
      return Promise.resolve({ ok: false, reason: 'unavailable' })
    this.queued++
    const result = this.tail.then(() => this.run(source, caller, words))
    this.tail = result.catch(() => undefined)
    return result.finally(() => {
      this.queued--
    })
  }

  private async run(
    source: PastWorkSource,
    caller: string,
    words: string,
  ): Promise<PastWorkSearchResult> {
    if (this.closed) return { ok: false, reason: 'unavailable' }
    let worker: Worker
    try {
      if (this.worker === undefined) {
        const opened = this.start(source.file)
        this.worker = opened
        opened.on('error', () => {
          void opened.terminate().catch(() => {})
        })
        opened.once('exit', () => {
          if (this.worker === opened) this.worker = undefined
        })
      }
      worker = this.worker
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
    const id = ++this.serial
    return await new Promise((resolve) => {
      let finished = false
      const finish = (result: PastWorkSearchResult) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        worker.off('message', message)
        worker.off('error', failed)
        worker.off('exit', exited)
        resolve(result)
      }
      const exited = () => {
        if (this.worker === worker) this.worker = undefined
        finish({ ok: false, reason: 'unavailable' })
      }
      const failed = () => {
        // Keep the queue occupied until the failed worker has exited.
        void worker.terminate().catch(() => {})
      }
      const message = (value: unknown) => {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('id' in value) ||
          value.id !== id ||
          !('result' in value)
        ) {
          failed()
          return
        }
        const parsed = pastWorkSearchResult.safeParse(value.result)
        if (!parsed.success) {
          failed()
          return
        }
        finish(parsed.data)
      }
      const timer = setTimeout(failed, 180_000)
      worker.on('message', message)
      worker.once('error', failed)
      worker.once('exit', exited)
      try {
        worker.postMessage({ id, source, caller, words })
      } catch {
        failed()
      }
    })
  }

  async close(): Promise<void> {
    this.closed = true
    const worker = this.worker
    if (worker !== undefined) {
      await worker.terminate().catch(() => {})
      if (this.worker === worker) this.worker = undefined
    }
    await this.tail
  }
}
