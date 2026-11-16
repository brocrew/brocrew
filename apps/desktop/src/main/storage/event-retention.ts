import type { Worker } from 'node:worker_threads'
import type { EventTrimResult } from '../db/event-retention'

const SWEEP_EVERY_MS = 60 * 60 * 1000
const FIRST_SWEEP_DELAY_MS = 10 * 60 * 1000
const FIRST_SWEEP_LATEST_MS = 20 * 60 * 1000

/** One periodic history sweep; stopping joins its worker before the app closes its database. */
export function startEventRetention(
  start: () => Worker,
  trimmed: (result: EventTrimResult) => Promise<void>,
  warn: (error: unknown) => void,
): { firstListAccepted(at: number): void; stop(): Promise<void> } {
  let closed = false
  let busy = false
  let ready = false
  let first: ReturnType<typeof setTimeout> | undefined
  let worker: Worker | null = null
  let running: Promise<void> = Promise.resolve()
  let stopping: Promise<void> | undefined
  const run = (): void => {
    if (closed || busy || !ready) return
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
      current.once(
        'message',
        (message: { ok: boolean; value?: EventTrimResult; error?: string }) => {
          if (message.ok && message.value) result = message.value
          else warn(message.error ?? 'Event history cleanup failed.')
        },
      )
      current.once('error', warn)
      current.once('exit', (code) => {
        worker = null
        resolve(code === 0 ? result : null)
      })
    })
      .then(async (result) => {
        if (closed) return
        if (result !== null) {
          try {
            await trimmed(result)
          } catch (error) {
            warn(error)
          }
        }
      })
      .finally(() => {
        busy = false
      })
  }

  const begin = (): void => {
    if (closed || ready) return
    ready = true
    clearTimeout(first)
    clearTimeout(fallback)
    run()
  }
  const fallback = setTimeout(begin, Math.max(0, FIRST_SWEEP_LATEST_MS - performance.now()))
  fallback.unref()
  const timer = setInterval(run, SWEEP_EVERY_MS)
  timer.unref()
  return {
    firstListAccepted(at) {
      if (closed || ready || first !== undefined) return
      first = setTimeout(begin, Math.max(0, at + FIRST_SWEEP_DELAY_MS - performance.now()))
      first.unref()
    },
    stop() {
      stopping ??= (async () => {
        closed = true
        clearInterval(timer)
        clearTimeout(first)
        clearTimeout(fallback)
        if (worker !== null) await worker.terminate()
        await running
      })()
      return stopping
    },
  }
}
