import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../../src/main/db/connection'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { agentIdentityRowId } from '../../src/main/db/identity'

/** Historical fixture rows use only columns shipped before connection defaults existed. */
export function legacyIdentity(db: AppDatabase, slug: string, provider: Provider): void {
  db.prepare(
    `INSERT INTO agent_identity (id,slug,display_name,provider,created_by,created_at)
    VALUES (?,?,NULL,?,'a-person',100)`,
  ).run(agentIdentityRowId(slug), slug, provider)
}

export function legacyConversation(
  db: AppDatabase,
  input: {
    id: string
    profileId: string
    provider: Provider
    cwd: string
    approvalMode: 'ask' | 'auto'
  },
): void {
  legacyIdentity(db, input.profileId, input.provider)
  db.prepare(
    `INSERT INTO provider_session
    (id,provider,cwd,status,approval_mode,profile_id,agent_identity_id,created_at,updated_at)
    VALUES (?,?,?,'idle',?,?,?,100,100)`,
  ).run(
    input.id,
    input.provider,
    input.cwd,
    input.approvalMode,
    input.profileId,
    agentIdentityRowId(input.profileId),
  )
}

/** Write historical payloads directly, without letting the current store normalize their bytes. */
export function legacyEvents(
  db: AppDatabase,
  sessionId: string,
  events: readonly TranscriptEvent[],
  firstAt: number,
): void {
  const insert = db.prepare(
    'INSERT INTO events (id,session_id,generation,ordinal,type,payload,created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
  )
  for (const [ordinal, event] of events.entries())
    insert.run(
      `${sessionId}-${ordinal}`,
      sessionId,
      ordinal,
      event.type,
      JSON.stringify(event),
      firstAt + ordinal,
    )
}
