import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { anOpenGate, ProviderDouble, type ResumeGate } from './lib/provider-double'

/**
 * 🔴 **D-017 · a start that costs one launch or none** — the recipe every delivery to a stopped
 * conversation shares now ({@link RuntimeHost}'s `ensureRunning`/`afterWhatArrivedFirst`).
 *
 * ⚑ **Two agents' messages arriving while nothing is running share ONE start, in the order they
 * arrived** — `afterWhatArrivedFirst` chains every delivery to one conversation behind whatever
 * arrived before it, so a second caller never launches a resume of its own; it rides the first's.
 *
 * ⚑ **A caller outside a conversation's reach is refused before anything starts** — the rails a
 * message meets are asked of a stopped conversation exactly as they would be of a running one, and
 * a refusal spends no launch. ⚑ **D-017 · R12 — and it is refused BY the reach rail**, the one a
 * running conversation meets: `no-such-agent` is said only of an id no conversation has.
 *
 * ⚑ **One host, a real Close, real messages — the only double is the provider**, held at its own
 * door with {@link ResumeGate} so a test can watch a resume arrive and count it.
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

describe('D-017 · a start that costs one launch or none', () => {
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

  const buildHost = (
    over: SessionStore = store,
    runtime: (provider: Provider) => FakeRuntime = (provider) =>
      new ProviderDouble(provider, handles, issued, gate),
  ): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: runtime,
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d017-launch-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d017-launch-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 17_000_000
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

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** ⚑ Every way words reach a conversation — a busy one HOLDS them, an idle one takes a turn. */
  const wordsIn = (sessionId: string): string[] =>
    events(sessionId).flatMap((event) =>
      event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
    )

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  it('two agents’ messages that arrive while nothing is running: one start, and delivery in the order they arrived', async () => {
    const ada = await personOpens('ada')
    const bo = await personOpens('bo')
    await host.close(bo, window)

    let release: () => void = () => {}
    gate.held = new Promise<void>((resolve) => {
      release = resolve
    })
    const handlesBefore = handles.length

    // ⚑ Fired without awaiting — Ada's first message finds Bo stopped and starts it. ⚠️ **D-016 ·
    // a note**: a follow-up names a piece its sender gave, and Ada gave Bo none.
    const first = callOn(agentToolsFor(host, ada), 'message_agent', {
      agent: bo,
      text: 'first',
      kind: 'note',
    })
    await waitFor(() => gate.entered > 0, 'the first delivery to reach the provider')
    // ⚑ **The resume is blocked before `super.resume` returns**, so no handle exists for it yet.
    expect(gate.entered).toBe(1)
    expect(handles.length).toBe(handlesBefore)

    // ⚑ Fired without awaiting too — it must NOT launch a second resume of its own.
    const second = callOn(agentToolsFor(host, ada), 'message_agent', {
      agent: bo,
      text: 'second',
      kind: 'note',
    })
    await letItSettle()
    // 🔴 **The property this file exists to pin**: however many deliveries are waiting on the same
    // stopped conversation, only ONE resume is ever attempted.
    expect(gate.entered).toBe(1)

    release()
    const [firstAnswer, secondAnswer] = await Promise.all([first, second])

    expect(firstAnswer).toMatchObject({ outcome: 'ok', agent: bo })
    expect(secondAnswer).toMatchObject({ outcome: 'ok', agent: bo })
    // ⚑ **Still exactly one resume** for the whole test, after both deliveries have landed.
    expect(gate.entered).toBe(1)
    expect(wordsIn(bo)).toEqual(['first', 'second'])
  })

  it('a caller out of reach is refused a stopped conversation before anything starts — no launch is spent on a refusal', async () => {
    const zed = await personOpens('worker')
    const bo = await personOpens('reviewer')
    await host.close(bo, window)
    // ⚑ **`none`, since D-016 took `same-project`**: the reach vocabulary is `none | any`, so the
    // one grant that keeps Zed from a conversation it did not start is the one that keeps it from
    // every conversation — the argument-independent wall (`486`), asked of a STOPPED conversation
    // exactly as of a running one, before anything is started for it.
    expect(store.setCapabilities('worker', { canMessage: 'none' })).toBe(true)

    const handlesBefore = handles.length
    const refused = await callOn(agentToolsFor(host, zed), 'message_agent', {
      agent: bo,
      text: 'are you there',
      kind: 'note',
    })

    // ⚑ **The reach rail, not `no-such-agent`** — the refusal `message_agent` gives for a running
    // conversation too, naming the grant that decided it, and nothing else.
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'may-not-message',
      detail: { reach: 'none' },
    })
    // ⛔ **Nothing was started for a refusal**: no launch was attempted for Bo.
    expect(handles.length).toBe(handlesBefore)

    // ⚑ **THE PAIR**: the identical call, from a caller whose reach is the default (unnarrowed),
    // succeeds — and DOES start Bo.
    const ada = await personOpens(DEFAULT_PROFILE_ID)
    const beforeTheSend = handles.length
    const sent = await callOn(agentToolsFor(host, ada), 'message_agent', {
      agent: bo,
      text: 'are you there',
      kind: 'note',
    })
    expect(sent).toMatchObject({ outcome: 'ok', agent: bo })
    expect(handles.length).toBe(beforeTheSend + 1)
  })
})
