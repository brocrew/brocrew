import { type TranscriptEvent } from '../../src/shared/conversation-events'
import { personOpener } from '../helpers/person-opens-session'
import { FakeProviderSessions, type AgentToolset } from '@brobot2/runtime'
import { createSessionStore } from '../../src/main/db/session-store'
import { RuntimeHost } from '../helpers/giver-notice-host'
import {
  closeHostFixture,
  fixtureDatabase,
  fixtureFolder,
  latestToolset,
  numberedFixtureHostPaths,
  RecordingSink,
} from './host-fixture'
import { ToolWatchingResumeRuntime } from './provider-double'

export function clockedQuestionFixture(suite: string, now: () => number) {
  const userData = fixtureFolder(`brobot2-${suite}-`)
  const root = fixtureFolder(`brobot2-${suite}-root-`)
  const db = fixtureDatabase(userData)
  const store = createSessionStore(db, now)
  const handed: AgentToolset[] = []
  const issued = new FakeProviderSessions()
  const host = new RuntimeHost({
    store,
    ...numberedFixtureHostPaths(() => userData, now),
    createRuntime: (provider) => new ToolWatchingResumeRuntime(provider, handed, issued),
  })
  const window = new RecordingSink('webContents:1')
  const ledger = (sessionId: string) => store.events(sessionId).map((entry) => entry.event)
  const wordsIn = (sessionId: string): readonly { type: string; text: string; kind?: string }[] =>
    ledger(sessionId).filter(
      (event): event is TranscriptEvent & { type: 'user_turn' | 'message_queued'; text: string } =>
        event.type === 'user_turn' || event.type === 'message_queued',
    )
  const openRequestOf = (sessionId: string) => {
    const row = store
      .routedRequestsOf(sessionId)
      .filter((one) => one.went.is === 'the-parent')
      .at(-1)
    if (row === undefined) throw new Error(`no routed question in ${sessionId}`)
    return row
  }
  return {
    host,
    store,
    window,
    ledger,
    wordsIn,
    openRequestOf,
    personOpens: personOpener(() => ({ host, root, window }), 'ask'),
    latestToolset: () => latestToolset(handed),
    close: () => closeHostFixture(host, db, userData, root),
  }
}
