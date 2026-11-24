import type { RuntimeEvent, SessionRef } from '@brobot2/runtime'

import { applyEvent, type TranscriptState } from '../lib/core-transcript'

const ref: SessionRef = {
  provider: 'claude',
  sessionId: 'sess-abc',
  cwd: '/tmp/scratch',
  rotation: 0,
}

const scope = {
  cwd: '/tmp/scratch',
  paths: ['write /tmp/scratch/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function permissionRequest(id = 'req_1'): RuntimeEvent {
  return { type: 'permission_request', id, kind: 'file', action: 'Write', detail: 'out.txt', scope }
}

function feed(state: TranscriptState, ...events: RuntimeEvent[]): TranscriptState {
  for (const event of events) applyEvent(state, event)
  return state
}

export { feed, permissionRequest, ref }
