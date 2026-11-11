import type { AgentState, ScheduleLevel } from '../../../shared/agent-state-contracts'
import type { SessionRecord } from './session-record'

/** Older envelopes keep their existing projection; current envelopes use only core's state. */
export function stateForRecord(
  record: Pick<SessionRecord, 'agentState'>,
  legacy: () => AgentState,
): AgentState | undefined {
  return record.agentState === undefined ? legacy() : (record.agentState ?? undefined)
}

/**
 * A partial history cannot establish a one-shot job's first listing. Keep its
 * schedule, but leave that time unknown until a complete fold supplies it.
 */
export function scheduleHere(
  record: Pick<SessionRecord, 'control' | 'transcript' | 'window'>,
): ScheduleLevel {
  const schedule = record.control.schedule
  if (record.control === record.transcript && !record.window.hasOlder) return schedule
  return { ...schedule, jobs: schedule.jobs.map((job) => ({ ...job, listedSince: undefined })) }
}

