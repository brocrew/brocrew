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
  return {
    host,
    store,
    window,
    personOpens: personOpener(() => ({ host, root, window }), 'ask'),
    latestToolset: () => latestToolset(handed),
    close: () => closeHostFixture(host, db, userData, root),
  }
}
