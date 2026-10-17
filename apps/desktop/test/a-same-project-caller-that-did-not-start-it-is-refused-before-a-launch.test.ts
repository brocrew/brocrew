import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
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

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider): FakeRuntime =>
        new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /** What an agent's own calls look like from outside its toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  it('🔴 refused before a resume is attempted — no launch is spent on a caller outside its reach', async () => {
    const zed = await personOpens('caller')
    const bo = await personOpens('target')
    await host.close(bo, window)
    // ⚑ **`none`** (D-016 — this read `same-project`, which went with projects): `none` never admits
    // a conversation Zed did not start — {@link reachesWhatItDidNotStart}. Zed never spawned Bo; they
    // are two sibling top-level conversations opened by the same window. ⚠️ The grant's own floor
    // (`486`) would refuse `none` too, and in other words — the message asserted below is what says
    // the reach wall in front of the start answered first.
    expect(store.setCapabilities('caller', { canMessage: 'none' })).toBe(true)

    // ⚑ **Baseline AFTER both sessions have started and Bo has stopped**: `personOpens` itself
    // starts a handle for each of them, so what this test counts from here is launches this call
    // causes, never the fixture's own.
    const handlesBefore = handles.length

    // ⛔ **`'follow-up'`, deliberately**: a WORK message would meet `assertMayAssign`'s own wall
    // first (`can_assign_work`, a different column), which would refuse this call for a second
    // reason and leave the entitlement wall this test is about unmeasured.
    let refusal: unknown = null
    try {
      await host.queueMessage(bo, 'are you there', speakingAs(zed), [], 'work', {}, 'follow-up')
    } catch (error) {
      refusal = error
    }
    expect(refusal, 'a caller outside its reach must be refused, not admitted').toBeInstanceOf(
      Error,
    )
    // 🔴 **The property this test exists to pin**: a refusal that costs nothing. `resume` was never
    // entered — the reach wall stood in front of the START itself, and not only in front of the
    // words a running Bo would have refused a moment later. ⚠️ **Asked before the exact wording
    // below**, so a caller that was resumed and THEN refused for some other reason still fails this
    // line rather than being let through by a looser message match.
    expect(gate.entered).toBe(0)
    expect(handles.length).toBe(handlesBefore)
    // ⚑ **`refuseBeforeAStart`'s own words** — the wall this file is about, and not one of the
    // capability rails a resumed Bo would have refused with instead.
    expect((refusal as Error).message).toMatch(/unknown session/)

    // ⚑ **THE PAIR, one fact over**: the identical call, from a caller whose reach is `any`,
    // succeeds — and DOES resume Bo. Without this half, a harness that could not tell *resumed*
    // from *not resumed* would have passed the refusal above for the wrong reason.
    expect(store.setCapabilities('caller', { canMessage: 'any' })).toBe(true)
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
