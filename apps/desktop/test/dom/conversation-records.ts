import { reactive } from 'vue'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import type { CreatedSession, RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import { attentionQueue, type AttentionRequest } from '../../src/renderer/src/lib/attention'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { META } from './harness'

/** Conversation records the DOM tests build, each the way the window receives one. */

const AT = 1_700_000_000_000

/**
 * A conversation as the store holds a live one: `reactive`, open, and fed one row per ordinal, a
 * second apart.
 */
export function liveRecord(events: TranscriptEvent[], meta: CreatedSession): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = meta
  record.phase = 'open'
  for (const event of events) {
    const ordinal = record.nextOrdinal
    acceptEvent(record, { sessionId: record.sessionId, ordinal, at: AT + ordinal * 1_000, event })
  }
  return record
}

/** A Codex conversation: the host's echo of its provider on `meta`. */
export const CODEX_META: CreatedSession = {
  ...META,
  provider: 'codex',
  providerHome: '/homes/codex',
  ref: { provider: 'codex', sessionId: 'th_1', cwd: '/work', rotation: 0 },
}

/** A live Codex conversation, over {@link CODEX_META} with `meta` on top. */
export function liveCodexRecord(
  events: TranscriptEvent[],
  meta: Partial<CreatedSession> = {},
): SessionRecord {
  return liveRecord(events, { ...CODEX_META, ...meta })
}

/** A command permission Home answers in place: allow or deny, once. */
export const COMMAND_PERMISSION: TranscriptEvent = {
  type: 'permission_request',
  id: 'perm-1',
  kind: 'command',
  action: 'Bash',
  detail: 'pnpm test:e2e --project=chromium',
  scope: {
    cwd: '/Users/alex/dev/x',
    paths: ['write /Users/alex/dev/x/out.txt'],
    networkHosts: [],
    persistence: 'once',
    amendments: [],
    availableDecisions: ['allow', 'deny'],
    underDisclosed: false,
  },
}

/** A live Codex conversation holding one event, as Home and the attention queue read it. */
export function homeConversation(sessionId: string, event: TranscriptEvent, at: number): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'codex',
    cwd: `/Users/alex/dev/${sessionId}`,
    profileId: 'default',
    approvalMode: 'ask',
    planNeedsGoAhead: false,
    liveness: { state: 'live', since: at },
  } as never
  acceptEvent(record, { sessionId, ordinal: 0, event, at } as RuntimeEventMessage)
  return record
}

/** The attention queue over conversations every one of which waits on a permission. */
export const queueOf = (...records: unknown[]): AttentionRequest[] =>
  attentionQueue(records as never, () => 'waiting: permission')

/** A conversation the rail can draw: live, idle, and the host has said so. */
export function idleConversation(sessionId: string): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'claude',
    cwd: '/Users/alex/dev/brobot',
    profileId: 'default',
    liveness: { state: 'live', since: AT },
  } as CreatedSession
  record.phase = 'open'
  applyEvent(record.control, { type: 'status', state: 'idle' }, AT)
  return record
}

/** A conversation a window took over: it has a commander and may be handed back. */
export const CLAIMED: CreatedSession = {
  ...META,
  profileId: 'default',
  ref: null,
  config: { ...META.config, model: 'm' },
  liveness: { ...META.liveness, signInSuperseded: false },
  hasACommander: true,
  startedWithoutAWindow: true,
  mayHandItBack: true,
}
