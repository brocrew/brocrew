import { WindowReadUnavailable } from '../../db/window-read-protocol'

/**
 * Why the worker did not serve a window read: every caller permit was held; the writer moved under
 * both tries, or could not be sampled; the worker's read failed; the worker is gone; or it needs
 * a restart. The failed read is reported to its caller.
 */
type WindowReadMiss =
  | 'callers-full'
  | 'writer-moved'
  | 'writer-unsampled'
  | 'worker-read-failed'
  | 'worker-busy'
  | 'worker-gone'
  | 'worker-needs-restart'

/** A window read the worker did not serve, and why; any other refusal stands. */
class WindowReadMissed extends WindowReadUnavailable {
  constructor(
    readonly missed: WindowReadMiss,
    cause?: string,
  ) {
    super(missed === 'worker-needs-restart' ? 'restart' : 'unavailable', undefined, cause)
  }
}

/**
 * What a failed wait for the worker says: a miss, or the error itself when it is no refusal.
 * ⛔ A caller's own abort is no miss: it stands.
 */
function whyTheWorkerMissed(error: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted === true || !(error instanceof WindowReadUnavailable)) return error
  if (error.why === 'restart') return new WindowReadMissed('worker-needs-restart', error.message)
  if (error.why === 'busy') return new WindowReadMissed('worker-busy', error.message)
  return new WindowReadMissed(
    error.why === 'failed' ? 'worker-read-failed' : 'worker-gone',
    error.message,
  )
}

/**
 * How long a failed read is remembered
 * before the worker is asked again at the same writer stamp: doubled after each further failure
 * there, up to the most. A write that moves the stamp asks again at once.
 */
const A_FAILED_WINDOW_READ_WAITS_MS = 1_000

const A_FAILED_WINDOW_READ_WAITS_AT_MOST_MS = 30_000
/**
 * The worker's misses remembered at a stamp: a read that failed there. A busy worker is asked
 * again by the next caller, and a gone one is its lifetime's to restart.
 */
const REMEMBERED_WINDOW_READ_MISSES: ReadonlySet<WindowReadMiss> = new Set<WindowReadMiss>([
  'worker-read-failed',
])

export {
  A_FAILED_WINDOW_READ_WAITS_AT_MOST_MS,
  A_FAILED_WINDOW_READ_WAITS_MS,
  REMEMBERED_WINDOW_READ_MISSES,
  whyTheWorkerMissed,
  WindowReadMissed,
}
