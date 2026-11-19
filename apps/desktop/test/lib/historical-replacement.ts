import type { FakeProviderSessions, SessionRef } from '@brobot2/runtime'
import type { SessionStore } from '../../src/main/db/session-store'
import { newQueuedMessageId } from '../../src/main/runtime/queued-message'

type HistoryStore = Pick<
  SessionStore,
  'append' | 'create' | 'find' | 'nextOrdinal' | 'parentOf' | 'recordedOne'
>

export function seedHistoricalSuccessor(
  store: HistoryStore,
  previous: string,
  successor: string,
  at: number,
  native?: { sessions: FakeProviderSessions; home: string },
  history: 'complete' | 'reverse-only' = 'complete',
): string {
  const row = store.recordedOne(previous)
  if (row?.profileId == null) throw new Error(`no recorded profile for ${previous}`)
  const parent = store.parentOf(previous)
  store.create({
    id: successor,
    profileId: row.profileId,
    provider: row.provider,
    approvalMode: store.find(previous)?.approvalMode ?? 'ask',
    cwd: row.cwd,
    ...(parent === null ? {} : { parentSessionId: parent }),
    ...(native === undefined ? {} : { launchedAs: row.profileId }),
  })
  if (native !== undefined) {
    const ref: SessionRef = {
      provider: row.provider,
      sessionId: native.sessions.nextId(row.provider),
      cwd: row.cwd,
      rotation: 0,
    }
    native.sessions.record(ref.sessionId, {
      cwd: ref.cwd,
      rotation: ref.rotation,
      providerHome: native.home,
    })
    store.append(successor, 0, { type: 'session', state: 'started', ref }, at)
  }
  recordHistoricalReplacement(store, previous, successor, at, history)
  return successor
}

export function recordHistoricalReplacement(
  store: Pick<SessionStore, 'append' | 'nextOrdinal'>,
  previous: string,
  successor: string,
  at: number,
  history: 'complete' | 'reverse-only' = 'complete',
): void {
  if (history === 'complete') {
    store.append(
      previous,
      store.nextOrdinal(previous),
      { type: 'replaced_by', sessionId: successor },
      at,
    )
  }
  store.append(
    successor,
    store.nextOrdinal(successor),
    { type: 'replaces', sessionId: previous },
    at,
  )
}

export function recordHistoricallyMovedNote(
  store: Pick<SessionStore, 'append' | 'events' | 'nextOrdinal'>,
  previous: string,
  successor: string,
  text: string,
  at: number,
): void {
  const note = store
    .events(previous)
    .map(({ event }) => event)
    .findLast((event) => event.type === 'message_queued' && event.text === text)
  if (note?.type !== 'message_queued') throw new Error(`no recorded note: ${text}`)
  store.append(
    previous,
    store.nextOrdinal(previous),
    { type: 'message_unqueued', messageId: note.messageId, reason: 'abandoned', text },
    at,
  )
  store.append(
    successor,
    store.nextOrdinal(successor),
    { ...note, messageId: newQueuedMessageId(), forItsNextStart: true },
    at,
  )
}
