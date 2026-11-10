import type { Provider } from '@brobot2/shared'
import { logInfo } from '../logging/log'

type Condition =
  | 'bearer'
  | 'accepting'
  | 'current'
  | 'bridge-closed'
  | 'lease-invalid'
  | 'view-invalid'
  | 'incarnation-retired'
  | 'entry-replaced'
  | 'run-replaced'
  | 'workspace-ended'
  | 'plugin-blocked'
  | 'installation-replaced'
  | 'run-installation-replaced'
  | 'run-ended'
  | 'admission-error'
  | 'broker-discovery'
type AdmissionError =
  | 'unknown'
  | 'state-corrupt'
  | 'state-conflict'
  | 'state-busy'
  | 'state-unsafe-path'
  | 'state-limit'
  | 'state-missing-guard'
  | 'state-unsupported'
  | 'supervisor-unavailable'
  | 'broker-invalid'
  | 'broker-unauthorized'
  | 'broker-unavailable'
  | 'broker-denied'
  | 'broker-busy'
  | 'broker-cancelled'
  | 'broker-deadline'
  | 'broker-downstream'
export interface AdmissionFailure {
  condition: Condition
  error?: AdmissionError
}
export type AdmissionObserver = (failure: AdmissionFailure) => void
export function observeAdmission(
  observer: AdmissionObserver | undefined,
  failure: AdmissionFailure,
) {
  try {
    observer?.(failure)
  } catch {
    /* An observer grants no authority. */
  }
}

type AdmissionEventName =
  | 'launch-attachment'
  | 'launch-discovery'
  | 'route-configured'
  | 'source-refresh'
  | 'release-received'
  | 'source-retired'
  | 'route-issued'
  | 'route-close-start'
  | 'route-close-complete'
  | 'http-bearer-refused'
  | 'http-broker-refused'
type IdentityName =
  | 'workspace'
  | 'source'
  | 'lease'
  | 'epoch'
  | 'route'
  | 'hostRun'
  | 'request'
  | 'launch'
  | 'incarnation'
  | 'attachmentRoute'
  | 'server'
  | 'plugin'
type Identity = IdentityName
type TraceContext = Partial<Record<Identity, string>>
type LaunchStage = 'initial-read' | 'before-send-read' | 'provider-discovery' | 'provider-launch'
type LaunchOutcome =
  'configured' | 'empty' | 'failed' | 'discovered' | 'unavailable' | 'timeout' | 'cancelled'
interface LaunchTraceDetail extends TraceContext {
  stage?: LaunchStage
  outcome?: LaunchOutcome
  provider?: Provider
  failureStage?: string
  configuredTools?: readonly string[]
  discoveredTools?: readonly string[]
  configuredCount?: number
  discoveredCount?: number
  serverCount?: number
  pending?: readonly string[]
  off?: readonly string[]
  unknown?: boolean
}
export interface RouteAdmissionEvent extends LaunchTraceDetail {
  process: string
  sequence: number
  event: AdmissionEventName
  condition?: AdmissionFailure['condition']
  error?: AdmissionFailure['error']
}
export type RouteAdmissionSink = (event: RouteAdmissionEvent) => void
export interface RouteAdmissionTrace {
  context: TraceContext
  emit(
    event: RouteAdmissionEvent['event'],
    detail?: Partial<AdmissionFailure> & LaunchTraceDetail,
    request?: string,
  ): void
}

let sequence = 0

export function createRouteAdmissionTrace(sink?: RouteAdmissionSink) {
  return (context: TraceContext): RouteAdmissionTrace => ({
    context,
    emit(event, detail, request) {
      try {
        sink?.({
          ...context,
          process: String(process.pid),
          sequence: ++sequence,
          event,
          ...detail,
          request,
        })
      } catch {
        // Diagnostics cannot interrupt the operation being observed.
      }
    },
  })
}

/** A route admission step, as one log line carrying whatever the event holds. */
export function recordRouteAdmissionTrace(event: RouteAdmissionEvent): void {
  logInfo('route', event.event, { ...event })
}
