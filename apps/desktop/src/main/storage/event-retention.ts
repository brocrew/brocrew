import type { Worker } from 'node:worker_threads'
import { eventTrimWriter, type EventTrimBatch, type EventTrimResult } from '../db/event-retention'
import type { AppDatabase } from '../db/connection'
import { incrementallyCompact } from '../db/compact'

const SWEEP_EVERY_MS = 60 * 60 * 1000
const CATCH_UP_AFTER_MS = 60 * 1000
const FIRST_SWEEP_DELAY_MS = 10 * 60 * 1000
const FIRST_SWEEP_LATEST_MS = 20 * 60 * 1000

/** One periodic history sweep; stopping joins its worker before the app closes its database. */
export function startEventRetention(
  db: AppDatabase,
  start: () => Worker,
  trimmed: (result: EventTrimResult) => Promise<void>,
  warn: (error: unknown) => void,
): { firstListAccepted(at: number): void; stop(): Promise<void> } {
  const write = eventTrimWriter(db)
  let closed = false
  let busy = false
  let ready = false
  let first: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let worker: Worker | null = null
  let running: Promise<void> = Promise.resolve()
  let stopping: Promise<void> | undefined
  const schedule = (delay: number): void => {
    if (closed) return
    timer = setTimeout(run, delay)
    timer.unref()
  }
  const run = (): void => {
    if (closed || busy || !ready) return
    const began = performance.now()
    let result: EventTrimResult | null = null
    let removed = 0
    let exitCode: number | null = null
    let failure: unknown
    console.info('BroCrew event history sweep started.')
    const finish = (): void => {
      busy = false
      const outcome = {
        ...result,
        removed,
        elapsedMs: performance.now() - began,
        exitCode,
        status: closed ? 'stopped' : failure === undefined ? 'completed' : 'failed',
      }
      if (failure !== undefined && !closed) {
        warn({
          ...outcome,
          error: failure instanceof Error ? failure.message : String(failure),
        })
      } else console.info('BroCrew event history sweep ended:', outcome)
      schedule(
        failure === undefined && result?.budgetReached && !result.interrupted
          ? CATCH_UP_AFTER_MS
          : SWEEP_EVERY_MS,
      )
    }
    let current: Worker
    try {
      current = start()
      worker = current
      busy = true
    } catch (error) {
      failure = error
      finish()
      return
    }
    running = new Promise<void>((resolve) => {
      current.on(
        'message',
        (message: {
          kind?: 'trim-batch'
          batch: EventTrimBatch
          ok?: boolean
          value?: EventTrimResult
          error?: string
        }) => {
          if (closed) return
          if (message.kind === 'trim-batch') {
            try {
              const value = write(message.batch)
              removed += value.changed ?? 0
              current.postMessage({ value })
            } catch (error) {
              current.postMessage({
                error: error instanceof Error ? error.message : String(error),
                code: (error as { code?: string }).code,
              })
            }
          } else if (message.ok && message.value) {
            result = message.value
            removed = result.removed
          } else failure = message.error ?? 'Event history cleanup failed.'
        },
      )
      current.once('error', (error) => {
        failure = error
      })
      current.once('exit', (code) => {
        worker = null
        exitCode = code
        if (failure === undefined && (code !== 0 || result === null))
          failure = `Event history worker exited with code ${code}${result === null ? ' without a result' : ''}.`
        resolve()
      })
    })
      .then(async () => {
        if (closed || failure !== undefined || result === null) return
        const compacted = result.interrupted
          ? { steps: 0, reclaimedPages: 0, longestLockMs: 0 }
          : await incrementallyCompact(db, () => closed)
        if (closed) return
        result = {
          ...result,
          incrementalSteps: compacted.steps,
          reclaimedPages: compacted.reclaimedPages,
          longestIncrementalLockMs: compacted.longestLockMs,
        }
        await trimmed(result)
      })
      .catch((error: unknown) => {
        failure = error
      })
      .finally(finish)
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
  return {
    firstListAccepted(at) {
      if (closed || ready || first !== undefined) return
      first = setTimeout(begin, Math.max(0, at + FIRST_SWEEP_DELAY_MS - performance.now()))
      first.unref()
    },
    stop() {
      stopping ??= (async () => {
        closed = true
        clearTimeout(timer)
        clearTimeout(first)
        clearTimeout(fallback)
        if (worker !== null) await worker.terminate()
        await running
      })()
      return stopping
    },
  }
}
