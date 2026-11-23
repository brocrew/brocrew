import { rmSync } from 'node:fs'
import { FakeProviderSessions, type FakeSessionHandle, type RuntimeEvent } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { createSessionStore } from '../../src/main/db/session-store'
import { RuntimeHost } from '../helpers/giver-notice-host'
import type { RuntimeStatesMessage } from '../../src/shared/runtime-ipc'
import {
  ObservedProviderLaunches,
  fixtureFolder,
  fixtureDatabase,
  numberedFixtureHostPaths,
  RecordingSink,
} from './host-fixture'

export interface TurnEnds {
  held: Promise<void> | null
  release: () => void
}

function heldTurnProvider(
  provider: Provider,
  handles: FakeSessionHandle[],
  sessions: FakeProviderSessions,
  ends: TurnEnds,
) {
  return new ObservedProviderLaunches(provider, sessions, (_kind, _options, handle) => {
    handles.push(handle)
    const theirSend = handle.send.bind(handle)
    const theirs = handle.events.bind(handle)
    const theirStatus = handle.status.bind(handle)
    let running = false
    handle.send = (...words: Parameters<FakeSessionHandle['send']>) => {
      running = ends.held !== null
      return theirSend(...words)
    }
    handle.events = () =>
      (async function* heldAtItsEnd(): AsyncGenerator<RuntimeEvent> {
        for await (const event of theirs()) {
          if (event.type === 'turn') {
            if (ends.held !== null) await ends.held
            running = false
          }
          yield event
        }
      })()
    handle.status = () => (running ? 'working' : theirStatus())
  })
}

/** The two reply-attention suites share the same host, clock and held-turn provider. */
export function heldTurnHostFixture(prefix: string, idleStopAfterMs: number) {
  const userData = fixtureFolder(`${prefix}-`)
  const root = fixtureFolder(`${prefix}-root-`)
  const db = fixtureDatabase(userData)
  let clock = 9_000_000
  const tick = () => clock++
  const store = createSessionStore(db, tick)
  const handles: FakeSessionHandle[] = []
  const pushed: RuntimeStatesMessage[] = []
  const turnEnds: TurnEnds = { held: null, release: () => undefined }
  const issued = new FakeProviderSessions()
  const host = new RuntimeHost({
    store,
    ...numberedFixtureHostPaths(() => userData, tick),
    createRuntime: (provider) => heldTurnProvider(provider, handles, issued, turnEnds),
    statesMoved: (message) => pushed.push(message),
    idleStopAfterMs,
  })
  const window = new RecordingSink('webContents:1')
  // Preserve the suites' first-error propagation and cleanup order.
  const cleanUp = async (): Promise<void> => {
    turnEnds.release()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  }
  return { userData, root, db, store, host, handles, turnEnds, window, pushed, tick, cleanUp }
}
