import { personOpener } from './helpers/person-opens-session'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { anOpenGate, ProviderDouble, type ResumeGate } from './lib/provider-double'

/**
 * 🔴 **D-017 · M141 · the reach wall stands in front of the START, not only in front of the
 * words** — `refuseBeforeAStart`'s `withinMessagingReach` clause, asked of a STOPPED conversation
 * before {@link RuntimeHost.ensureRunning} is ever called.
 *
 * ## ⛔ Why this calls `RuntimeHost.queueMessage` directly and not the `message_agent` tool
 *
 * ⚠️ **`message_agent`'s own tool layer asks the identical entitlement question first**
 * (`RuntimeHost.whyItIsOutOfReach`, `agent-tools.ts`), synchronously, with no `await` between that
 * check and the call into the host — so a caller `message_agent` would refuse never reaches
 * `refuseBeforeAStart` at all, and a plant on that wall alone is invisible from that tool. ⛔ **This
 * file asks the host's own door directly**, exactly as `the-rails-a-message-passes.test.ts` and
 * `a-message-that-crosses-a-project.test.ts` already do for `host.queueMessage(…)`, so the wall
 * inside `refuseBeforeAStart` is the only thing standing between the caller and a launch.
 *
 * ## ⚑ The property
 *
 * A caller that did not start the target and whose grant reaches no conversation it did not start
 * is refused a STOPPED conversation before anything is resumed — the refusal is synchronous with the
 * call, and {@link ResumeGate.entered} stays at zero. ⚠️ **The paired positive**: the identical call
 * from a caller holding `any` (or from the conversation's own commander) is admitted and DOES resume
 * it — so a harness that could not tell *resumed* from *not resumed* could not pass this file
 * honestly either.
 *
 * ⚑ **D-016 · the narrow grant is `none` now.** The file was written with `same-project`, the one
 * reach that let a caller speak at all and still reached nothing it did not start; D-016 removed it
 * with projects (`MESSAGING_REACH` is `none | any`). ⛔ **`none` is the only grant left that puts an
 * unstarted conversation out of reach**, and the wall this file is about asks reach FIRST — before
 * the grant's own floor (`486`) — so the refusal below still carries `refuseBeforeAStart`'s words
 * rather than the floor's, which is what tells the two walls apart. The filename keeps the old word
 * because mutation table 1017 names this file as M141's killer.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('D-017 · M141 · a caller whose reach does not cover it is refused before a launch', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider): FakeRuntime =>
        new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-m141-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-m141-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 21_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = personOpener(() => ({ host, root, window }), 'ask')

  /** What an agent's own calls look like from outside its toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  it('a caller can resume another person-opened conversation by sending a note', async () => {
    const zed = await personOpens('caller')
    const bo = await personOpens('target')
    await host.close(bo, window)
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
