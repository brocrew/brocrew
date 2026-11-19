import { personOpener } from './helpers/person-opens-session'
import { RecordingSink, numberedFixtureHostPaths, closeHostFixture } from './lib/host-fixture'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { anOpenGate, ProviderDouble, type ResumeGate } from './lib/provider-double'

/**
 * A caller that did not start a stopped conversation reaches it all the same, and its message
 * starts it: reach no longer reads a per-agent grant, so a value left in the retired
 * `can_message` column changes nothing. The host's own door is asked directly, so the wall in
 * front of the start (`refuseBeforeAStart`) is the only thing between the caller and a launch.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('a caller that did not start a stopped conversation reaches it and starts it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let window: RecordingSink
  let gate: ResumeGate

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-m141-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-m141-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    let clock = 21_000_000
    const tick = (): number => clock++
    store = createSessionStore(db, tick)
    handles = []
    const issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = new RuntimeHost({
      store,
      ...numberedFixtureHostPaths(() => userData, tick),
      createRuntime: (provider: Provider): FakeRuntime =>
        new ProviderDouble(provider, handles, issued, gate),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await closeHostFixture(host, db, userData, root)
  })

  const personOpens = personOpener(() => ({ host, root, window }), 'ask')

  /** What an agent's own calls look like from outside its toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  it('a sibling reaches a stopped conversation and its message resumes it, whatever the retired can_message column holds', async () => {
    const zed = await personOpens('caller')
    const bo = await personOpens('target')
    await host.close(bo, window)
    db.prepare(`UPDATE agent_identity SET can_message = 'none' WHERE slug = 'caller'`).run()

    // Counted after both sessions have started and Bo has stopped, so only this call's launch counts.
    const handlesBefore = handles.length
    const sent = await host.queueMessage(
      bo,
      'are you there',
      speakingAs(zed),
      [],
      'work',
      {},
      'follow-up',
    )
    expect(sent.outcome).not.toBe('refused')
    expect(gate.entered).toBe(1)
    expect(handles.length).toBe(handlesBefore + 1)
  })
})
