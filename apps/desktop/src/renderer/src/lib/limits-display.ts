import type {
  LimitsDisplayAnswer,
  LimitsDisplayChanged,
  LimitsDisplayReading,
  LimitsDisplayScope,
} from '../../../shared/limits-display'
import { providerName } from '../../../shared/runtime-ipc'
import type { LastKnownProviderBlock } from '../../../shared/runtime-ipc'
import type { Provider } from '@brobot2/shared'
import { readPublicationLane } from './read-publication-lane'
import { fullTime } from './clock'

export interface LimitsDisplayState {
  readonly status: 'updating' | 'ready' | 'unavailable'
  readonly reading: LimitsDisplayReading | null
}

const dateTime = fullTime

// The display's wording is kept together while its dated evidence stays separate from admission.
export const limitsDisplayWords = {
  updating: 'Updating limits…',
  unavailable: 'Limits unavailable',
  failed: 'The latest limits could not be read.',
  asOf: (at: number): string => `Limits as of ${dateTime(at)}`,
  emptyAsOf: (at: number): string => `No limits reported as of ${dateTime(at)}`,
  lastReading: (at: number): string => `Last reading: ${dateTime(at)}`,
  reported: (at: number): string => `Limit reported as of ${dateTime(at)}`,
  condition: (words: string, at: number): string => `As of ${dateTime(at)}: ${words}`,
  rail: (providers: readonly Provider[]): string =>
    providers.map((provider) => `${providerName(provider)} limit`).join(' · '),
  lastKnown: (block: LastKnownProviderBlock): string =>
    `Last known: stopped at ${providerName(block.provider)}’s limit · as of ${dateTime(block.asOf)}`,
}

export function limitsDisplayLabel(
  state: LimitsDisplayState,
  emptyAsOf: (at: number) => string = limitsDisplayWords.emptyAsOf,
): string {
  if (state.status === 'updating') return limitsDisplayWords.updating
  if (state.status === 'unavailable') return limitsDisplayWords.unavailable
  const reading = state.reading
  if (reading === null) return limitsDisplayWords.unavailable
  if (
    reading.walked.walk === 'no-ledger' ||
    reading.walked.rowsUnread > 0 ||
    (reading.walked.ledgersSkipped ?? 0) > 0
  )
    return limitsDisplayWords.unavailable
  return reading.walked.rows.length === 0
    ? emptyAsOf(reading.evaluatedAt)
    : limitsDisplayWords.asOf(reading.evaluatedAt)
}

function newerOrSame(next: LimitsDisplayScope, previous: LimitsDisplayScope): boolean {
  return (
    next.databaseEpoch > previous.databaseEpoch ||
    (next.databaseEpoch === previous.databaseEpoch && next.signInEpoch >= previous.signInEpoch)
  )
}

/** Retains dated evidence within its scope, without making it a current conversation fact. */
export function limitsDisplayLane(publish: (state: LimitsDisplayState) => void) {
  let scope: LimitsDisplayScope | null = null
  let reading: LimitsDisplayReading | null = null
  const lane = readPublicationLane<LimitsDisplayAnswer | null>({
    reading: () => publish({ status: 'updating', reading }),
    ready: (answer) => {
      if (answer === null) {
        publish({ status: 'unavailable', reading })
        return
      }
      const next = answer.is === 'read' ? answer.reading : answer
      if (scope !== null && !newerOrSame(next, scope)) {
        publish({ status: 'unavailable', reading })
        return
      }
      if (
        scope !== null &&
        (next.databaseEpoch !== scope.databaseEpoch || next.signInEpoch !== scope.signInEpoch)
      )
        reading = null
      scope = { databaseEpoch: next.databaseEpoch, signInEpoch: next.signInEpoch }
      const complete =
        answer.is === 'read' &&
        answer.reading.walked.walk !== 'no-ledger' &&
        answer.reading.walked.rowsUnread === 0 &&
        (answer.reading.walked.ledgersSkipped ?? 0) === 0
      if (answer.is === 'read' && complete) reading = answer.reading
      publish({ status: complete ? 'ready' : 'unavailable', reading })
    },
    unavailable: () => publish({ status: 'unavailable', reading }),
  })
  return {
    refresh: lane.refresh,
    changed(message: LimitsDisplayChanged): void {
      if (scope !== null && !newerOrSame(message, scope)) return
      scope = { databaseEpoch: message.databaseEpoch, signInEpoch: message.signInEpoch }
      lane.changeScope()
      if (message.why !== 'unavailable') reading = null
      publish({ status: 'unavailable', reading })
      if (message.why === 'closed') lane.close()
    },
    close: lane.close,
  }
}
