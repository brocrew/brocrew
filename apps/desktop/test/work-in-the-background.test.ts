import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  capabilitiesFor,
  type AgentToolset,
  type FakeSessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { derivePieces, type PieceRow } from '../src/shared/tasks'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 D-013 · work running in the background isn't stalled (plan §3.7, §7)
 *
 * ⚑ BroBot saw both halves live on `83be6132` (F019): Camille ran `sleep 40` in the background and
 * ended its turn, so its work read *stalled* and its giver was told it wasn't moving; then its
 * background wake answered, and nothing recorded that as a turn.
 *
 * ⚑ Now, in the fold every reader composes from:
 *  - §1 a drive that ends with waking background work pending holds the work `working`, and says
 *    WHAT is still running (a giver can tell a build from a server that never ends);
 *  - §2 when that work ends, the wake is a drive of its own, and it stalls the work only if it too
 *    ends with the work open and nothing left running — *"it stalls only if that ends with no
 *    reply"*;
 *  - §3 only where the provider wakes the model: Codex's background terminals drive nothing (`275`).
 */

let ordinal = 0
let clock = 7_000_000

const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})

// ⚑ **D-016** — the piece is given (`work_given`, in the owner's ledger), under the giver's root.
const assigned: TranscriptEvent = {
  type: 'work_given',
  piece: 'work_7',
  label: 'W1.7',
  parent: 'work_root_ayo',
  givenBy: 'sess_ayo',
  title: 'Build the index',
  brief: 'build the index',
}
const working: TranscriptEvent = { type: 'status', state: 'working' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const aCard: TranscriptEvent = { type: 'status', state: 'waiting_permission' }
const turnEnds: TranscriptEvent = { type: 'turn', state: 'completed' }
const turnInterrupted: TranscriptEvent = { type: 'turn', state: 'interrupted' }
// ⚑ **F097 · the giver's note opens the turn**: one a person's own words opened would leave the work
// waiting on them at its end, and these drives are about the background, not about who wrote.
const aTurnOpens: TranscriptEvent = {
  type: 'user_turn',
  text: 'build the index',
  attribution: 'app_authored',
  relayedFrom: 'sess_ayo',
  says: 'note',
}
const running = (...items: { id: string; description?: string }[]): TranscriptEvent =>
  ({ type: 'background_work', running: items, source: 'test' }) as TranscriptEvent
const ended = (id: string): TranscriptEvent =>
  ({
    type: 'background_work',
    ended: { id, outcome: 'completed' },
    source: 'test',
  }) as TranscriptEvent
const jobs = (...items: { id: string; schedule?: string }[]): TranscriptEvent =>
  ({ type: 'scheduled_work', jobs: items, source: 'test' }) as TranscriptEvent
const replied: TranscriptEvent = {
  type: 'work_replied',
  piece: 'work_7',
  outcome: 'done',
  summary: 'built',
  resources: [],
}

const theTask = (entries: TranscriptEvent[], backgroundWakesIt = true): PieceRow => {
  ordinal = 0
  clock = 7_000_000
  const found = derivePieces('sess_camille', entries.map(row), { backgroundWakesIt })[0]
  if (found === undefined) throw new Error('no piece was folded')
  return found
}

/** ⚑ Camille takes W1.7, starts `sleep 40` in the background, and its turn ends. */
const endedOverASleep: TranscriptEvent[] = [
  assigned,
  aTurnOpens,
  working,
  running({ id: 'bg_1', description: 'sleep 40' }),
  turnEnds,
  idle,
]

describe('§1 · a drive that ends with waking background work pending', () => {
  it('🔴 holds the work working, and says what is still running', () => {
    const task = theTask(endedOverASleep)
    expect(task.state).toBe('working')
    expect(task.stalledBecause).toBeNull()
    expect(task.inTheBackground).toEqual(['sleep 40'])
  })

  it('⚑ a scheduled wake-up holds it the same way, named with its schedule', () => {
    const task = theTask([
      assigned,
      aTurnOpens,
      working,
      jobs({ id: 'c1', schedule: '*/5 * * * *' }),
      turnEnds,
      idle,
    ])
    expect(task.state).toBe('working')
    expect(task.inTheBackground).toEqual(['a scheduled wake-up (*/5 * * * *)'])
  })

  it('⛔ THE CONTROL — nothing in the background: the turn end stalls it, as it always did', () => {
    const task = theTask([assigned, aTurnOpens, working, turnEnds, idle])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(task.inTheBackground).toBeUndefined()
  })

  it('⚑ an interrupted turn keeps its own cause through the idle that follows it', () => {
    const task = theTask([
      assigned,
      aTurnOpens,
      working,
      running({ id: 'bg_1', description: 'sleep 40' }),
      turnInterrupted,
      idle,
      ended('bg_1'),
    ])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'turn_interrupted' })
  })
})

describe('§2 · the wake is a drive of its own, and it stalls only if it ends with no reply', () => {
  it('🔴 the background ends and wakes it; the wake ends with the work open — now it stalls', () => {
    const task = theTask([
      ...endedOverASleep,
      ended('bg_1'),
      // ⚑ The wake: the provider runs the model with nobody sending a message — no `user_turn`,
      // and no `turn` at its end (`session-machine.ts`' unbidden burst).
      working,
      idle,
    ])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(task.inTheBackground).toBeUndefined()
  })

  it('🔴 …and while the wake runs, it is working — the end of the background alone is not the answer', () => {
    const task = theTask([...endedOverASleep, ended('bg_1'), working])
    expect(task.state).toBe('working')
  })

  it('🔴 the background ends and NO wake follows — the hold goes, and the work stalls', () => {
    const task = theTask([...endedOverASleep, ended('bg_1')])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(task.inTheBackground).toBeUndefined()
  })

  it('⚑ a wake that replies closes it — no stall at all', () => {
    const task = theTask([...endedOverASleep, ended('bg_1'), working, replied, idle])
    expect(task.state).toBe('answered')
  })

  it('⚑ a wake that starts MORE background work holds it again, on what now runs', () => {
    const task = theTask([
      ...endedOverASleep,
      ended('bg_1'),
      working,
      running({ id: 'bg_2', description: 'npm run build' }),
      idle,
    ])
    expect(task.state).toBe('working')
    expect(task.inTheBackground).toEqual(['npm run build'])
  })

  it('⛔ F019’s second half — a wake over NO background (a stall first) ends and stalls again', () => {
    const task = theTask([
      assigned,
      aTurnOpens,
      working,
      turnEnds,
      idle,
      // ⚑ The wake raises a card and ends straight after it: the card is still the wake.
      working,
      aCard,
      idle,
    ])
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
  })

  it('⚑ a recurring wake-up keeps holding it — something will drive it again', () => {
    const task = theTask([
      assigned,
      aTurnOpens,
      working,
      jobs({ id: 'c1', schedule: '*/5 * * * *' }),
      turnEnds,
      idle,
      working,
      idle,
    ])
    expect(task.state).toBe('working')
    expect(task.inTheBackground).toEqual(['a scheduled wake-up (*/5 * * * *)'])
  })
})

describe('§3 · only where the provider wakes the model', () => {
  it('🔴 Codex: a background terminal drives nothing, so the turn end stalls the work', () => {
    const task = theTask(endedOverASleep, false)
    expect(task).toMatchObject({ state: 'stalled', stalledBecause: 'turn_ended' })
    expect(task.inTheBackground).toBeUndefined()
  })

  it('⚑ the capability each provider declares is what the store hands the fold', () => {
    expect(capabilitiesFor('claude').backgroundWake.state).toBe('available')
    expect(capabilitiesFor('codex').backgroundWake.state).toBe('absent')
  })
})

describe('§4 · through the host: no stall notice while the build runs, and what runs is said', () => {
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
  class Watching extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly order: AgentToolset[],
      private readonly handles: FakeSessionHandle[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.order.push(options.agentTools)
      this.handles.push(handle as FakeSessionHandle)
      return handle
    }
  }

  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let order: AgentToolset[]
  let handles: FakeSessionHandle[]
  let window: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d013-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    store = createSessionStore(db)
    order = []
    handles = []
    let counter = 0
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new Watching(provider, order, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  const ledger = (sessionId: string) => store.events(sessionId).map((entry) => entry.event)
  const cards = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))
  const noticed = (pm: string): boolean =>
    ledger(pm).some(
      (event) =>
        (event.type === 'user_turn' || event.type === 'message_queued') &&
        isGiverStallNotice(event.text),
    )

  /**
   * ⚑ A PM a person opened gives a worker on `provider` work, and its turn parks on a card.
   *
   * 🔴 **D-014 · re-aimed** — work goes only to a conversation the giver STARTED, so the worker is
   * the PM's own child rather than a second conversation a person opened. ⚠️ A person takes it over
   * so the window can answer its card (only a person answers for a person).
   *
   * ⚑ **D-016** — `give_work` starts the worker and its brief is the worker's first turn, which is
   * the turn that parks. ⚠️ A give names no provider: a conversation it starts runs on the agent's
   * own, so the identity is created on `provider`.
   */
  const aWorkerOn = async (provider: Provider) => {
    host.createAgent({ slug: 'worker', displayName: null, provider })
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm' },
      window,
    )
    const pmTools = order.at(-1) as AgentToolset
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The build',
      brief: 'build it',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    expect(store.find(worker)?.provider).toBe(provider)
    const workerHandle = handles.at(-1) as FakeSessionHandle
    host.claimSession(worker, window)
    await waitFor(() => cards(worker).length > 0, 'the worker to park')
    return { pm, pmTools, worker, workerHandle }
  }

  const letTheTurnEnd = async (worker: string): Promise<void> => {
    await host.respondPermission(
      worker,
      cards(worker).at(-1) as string,
      { outcome: 'allow' },
      window,
    )
    await waitFor(() => ledger(worker).some((event) => event.type === 'turn'), 'the turn to end')
  }

  it('🔴 Claude: the turn ends over `sleep 40` — no notice to the giver, and list_tasks says what runs', async () => {
    const { pm, pmTools, worker, workerHandle } = await aWorkerOn('claude')
    workerHandle.simulateBackgroundWork({ running: [{ id: 'bg_1', description: 'sleep 40' }] })
    await letTheTurnEnd(worker)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(noticed(pm)).toBe(false)
    const listed = await callOn(pmTools, 'list_tasks', {})
    expect(JSON.stringify(listed)).toContain('"in_the_background":["sleep 40"]')
  })

  it('⛔ THE CONTROL — Codex: the same turn end over a background terminal stalls, and the giver is told', async () => {
    const { pm, worker, workerHandle } = await aWorkerOn('codex')
    workerHandle.simulateBackgroundWork({ running: [{ id: 'bg_1', description: 'sleep 40' }] })
    await letTheTurnEnd(worker)
    await waitFor(() => noticed(pm), 'the notice')
  })
})
