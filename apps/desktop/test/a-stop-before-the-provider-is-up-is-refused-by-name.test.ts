import {
  closeHostFixture,
  fixtureDatabase,
  fixtureFolder,
  numberedFixtureHostPaths,
  RecordingSink,
  waitFor,
} from './lib/host-fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase } from '../src/main/db/connection'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'

/**
 * 🔴 **The composer offers Stop whenever the host says active, so a Stop pressed before the provider
 * is up must be answered by name** (the 0.2.40 daily bug's second half).
 *
 * The host names `active` for a conversation whose start is still in flight (a reserved slot with no
 * session), and the composer now reads that state. A Stop pressed in that moment has no live turn to
 * ask, and the host's answer is the one the window already draws beside the conversation — *"session
 * is still starting"* — rather than a crash or a silent nothing. ⚑ Pinned here so offering Stop for
 * the host's `active` never becomes a button that fails without a sentence.
 */

class SlowToStart extends FakeRuntime {
  constructor(
    provider: Provider,
    sessions: FakeProviderSessions,
    private readonly startGate: Promise<void>,
  ) {
    super(provider, { sessions })
  }
  override async start(options: Parameters<FakeRuntime['start']>[0]) {
    await this.startGate
    return super.start(options)
  }
}

describe('a Stop before the provider is up', () => {
  let db: AppDatabase
  let host: RuntimeHost
  let userData: string
  let root: string
  let clock: number
  let window: RecordingSink
  let letItStart: () => void

  beforeEach(() => {
    userData = fixtureFolder('brobot2-244-')
    root = fixtureFolder('brobot2-244-root-')
    db = fixtureDatabase(userData)
    clock = 5_000_000
    const gate = new Promise<void>((resolve) => {
      letItStart = resolve
    })
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store: createSessionStore(db, () => clock++),
      ...numberedFixtureHostPaths(
        () => userData,
        () => clock++,
      ),
      createRuntime: (provider: Provider) => new SlowToStart(provider, sessions, gate),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    letItStart()
    await closeHostFixture(host, db, userData, root)
  })

  it('⚑ the host calls a conversation whose start is in flight active, and a Stop on it is refused as still starting', async () => {
    const creating = host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: root },
      window,
    )
    await waitFor(
      () => host.agentCard('sess_1', THE_APP_ITSELF, 'sess_1')?.state.is === 'active',
      'the host to call the starting conversation active',
    )
    await expect(host.interrupt('sess_1', window)).rejects.toThrow(/still starting/)
    // ⚑ The control one fact over: once it is up and nothing runs, there is no `active` and the same
    // Stop is no longer refused for starting.
    letItStart()
    await creating
    expect(host.agentCard('sess_1', THE_APP_ITSELF, 'sess_1')?.state).toEqual({ is: 'idle' })
  })
})
