import type { Provider } from '@brobot2/shared'
import type { StartPhase } from '@brobot2/runtime'

/** How a launch ended: ready, given up on at its deadline, failed, or stopped while it started. */
export type StartAttemptOutcome = 'ready' | 'timed-out' | 'failed' | 'cancelled'

interface StartAttemptOf {
  readonly v: 1
  /** This launch's own id, shared by its two lines. */
  readonly attempt: string
  readonly session: string
  readonly provider: Provider
  readonly opening: 'fresh' | 'resume'
  /** The limit chosen for this launch, in milliseconds. */
  readonly timeoutMs: number
  /** When the line was made, in UTC. */
  readonly at: string
}

/** A timing line when a provider launch begins and ends. */
export type StartAttemptLine =
  | (StartAttemptOf & { readonly stage: 'began' })
  | (StartAttemptOf & {
      readonly stage: 'ended'
      readonly outcome: StartAttemptOutcome
      /** Milliseconds from the first line, on a clock that only moves forward. */
      readonly elapsedMs: number
      /** Each phase reached, in milliseconds from the first line. */
      readonly phases: Readonly<Partial<Record<StartPhase, number>>>
      /** The last phase reached: at a timeout, the one the launch was waiting after. */
      readonly lastPhase: StartPhase | null
      /** The size of the thread's answer, when the provider's transport counts it. */
      readonly responseBytes: number | null
    })
