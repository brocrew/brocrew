import type { Worker } from 'node:worker_threads'
import type { EventTrimResult } from '../db/event-retention'

const SWEEP_EVERY_MS = 60 * 60 * 1000

/** One periodic history sweep; stopping joins its worker before the app closes its database. */
export function startEventRetention(
  start: () => Worker,
  trimmed: (result: EventTrimResult) => Promise<void>,
  warn: (error: unknown) => void,
): { stop(): Promise<void> } {
  let closed = false
  let busy = false
  let worker: Worker | null = null
  let running: Promise<void> = Promise.resolve()
  let stopping: Promise<void> | undefined
  const run = (): void => {
    if (closed || busy) return
    let current: Worker
    try {
      current = start()
      worker = current
      busy = true
    } catch (error) {
      warn(error)
      return
    }
    running = new Promise<EventTrimResult | null>((resolve) => {
      let result: EventTrimResult | null = null
      current.once('message', (message: { ok: boolean; value?: EventTrimResult; error?: string }) => {
        if (message.ok && message.value) result = message.value
        else warn(message.error ?? 'Event history cleanup failed.')
      })
      current.once('error', warn)
      current.once('exit', (code) => {
        worker = null
        resolve(code === 0 ? result : null)
      })
    }).then(async (result) => {
      if (closed) return
      if (result !== null) {
        try {
          await trimmed(result)
        } catch (error) {
          warn(error)
        }
      }
    }).finally(() => {
      busy = false
    })
  }

  const timer = setInterval(run, SWEEP_EVERY_MS)
  timer.unref()
  run()
  return {
    stop() {
      stopping ??= (async () => {
        closed = true
        clearInterval(timer)
        if (worker !== null) await worker.terminate()
        await running
      })()
      return stopping
    },
  }
}
