import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { createSessionRecord } from '../../src/renderer/src/lib/session-record'

/** What every ordinary host row shares: an idle, finished conversation of a non-BroBot agent. */
export const ordinaryRowBase = {
  provider: 'claude' as const,
  status: 'idle' as const,
  state: { is: 'idle' as const },
  named: null,
  approvalMode: 'ask' as const,
  profileId: 'recipe-worker',
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  lastEnding: 'completed' as const,
}

/** A conversation this window holds — its row is drawn from its record. */
export const heldRecord = (
  sessionId: string,
  cwd: string,
  now: number,
  profileId = 'recipe-worker',
): unknown => {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd,
    profileId,
    ref: { provider: 'claude', sessionId: 'live', cwd, rotation: 0 },
    approvalMode: 'ask',
    planNeedsGoAhead: false,
    liveness: { state: 'live', since: now },
  } as never
  return record
}

export type RailApi = {
  runtime: {
    listResumable: () => Promise<ResumableSessionInfo[]>
    listUnresumable: () => Promise<UnresumableSessionInfo[]>
  }
}

export const stubbed = (): { api?: RailApi } => window as unknown as { api?: RailApi }

/** An ordinary conversation nothing runs: the host lists it, idle. */
export const openableRow = (cwd: string, updatedAt: number): ResumableSessionInfo => ({
  ...ordinaryRowBase,
  cwd,
  updatedAt,
  running: 'not-running',
  sessionId: 'sess_openable',
  ref: { provider: 'claude', sessionId: 'thread-1', cwd, rotation: 0 },
  resumeRefusal: null,
})
