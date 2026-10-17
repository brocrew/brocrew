import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  type AgentToolAnswer,
  type FakeSessionHandle,
  type ModelChoice,
  type ProviderRuntimeContext,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # 🔴 D-042 · F1 — a give naming another pair keeps the one a PERSON set live
 *
 * ⚑ **682's `R31c` stamp, where it still decides since D-042**: a wake replays every row (R1), so
 * the stamp a person's live change writes (`aPersonSetItsModelOrEffort`, the window's
 * `setSessionSetting` door) matters at ONE place — a give to a conversation its giver already has,
 * naming another model and effort (`give_work`'s `model` / `effort`, D-042 · R4). There
 * `RuntimeHost.switchedFor` answers `a-person-chose-it` and leaves the pair alone, and the give's
 * answer says so (`whatItRunsOnSaid`'s *"a person chose that for this conversation"*).
 *
 * ⚑ **Mutation row `682` M27** deletes that check; the wake tests could no longer see it, since a
 * wake replays the row whether a person stamped it or not. This file is its killer: the same give,
 * once over a person's live pair and once over none (the CONTROL), and the two must differ — kept
 * and said kept, against switched and said switched.
 *
 * ⚑ Harness: `a-persons-choice-holds-the-whole-launch.test.ts`' — each HOME answers its own list,
 * a PM on Claude in `auto`, the worker given its first piece by the PM's give; and
 * `a-spawn-reaches-the-provider-with-a-persons-model.test.ts`' switch — the first piece taken back
 * (a helper still holding stalled work refuses a give: `its-work-has-stalled`), then a second give
 * naming the pair.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  readonly messages: RuntimeEventMessage[] = []
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))

/**
 * ⚑ Two listed models: `wide` offers low and high, `narrow` low, medium and high. ⚑ `wide` names
 * `low` as its own default, so the person's pick of `wide` lands on `low` whichever way the door
 * resolves the effort — the one it runs at (`low`, which `wide` offers) or the row's default.
 */
const WIDE: ModelChoice = {
  id: 'wide',
  label: 'Wide',
  efforts: levels('low', 'high'),
  defaultEffort: 'low',
}
const NARROW: ModelChoice = {
  id: 'narrow',
  label: 'Narrow',
  efforts: levels('low', 'medium', 'high'),
  defaultEffort: 'medium',
  isDefault: true,
}

interface World {
  started: { provider: Provider; options: StartOptions }[]
  resumed: { provider: Provider; options: ResumeOptions }[]
  listed: string[]
  lists: Record<string, ModelChoice[] | Error>
}

/** `394`'s double, keeping every start and resume, answering each HOME its own list. */
class HomeListDouble extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly world: World,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    this.world.started.push({ provider: this.provider, options })
    return super.start(options)
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    this.world.resumed.push({ provider: this.provider, options })
    return super.resume(ref, options)
  }
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    const profile = basename(dirname(context.providerHome))
    this.world.listed.push(`${profile}/${this.provider}`)
    const answer = this.world.lists[`${profile}/${this.provider}`] ?? this.world.lists['*'] ?? []
    if (answer instanceof Error) throw answer
    return answer
  }
}

describe('D-042 · F1 — a give naming another pair keeps the one a person set live (682 M27)', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let world: World
  const window = new Window('webContents:1')
  const tick = (): number => clock++
  const homes = (): string => join(userData, 'provider-homes')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-m27-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-m27-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 6_827_000
    store = createSessionStore(db, tick)
    counter = 0
    world = {
      started: [],
      resumed: [],
      listed: [],
      // ⚑ The worker's own home lists BOTH models, so the person's pick and the give's are each a
      // listed pair, and neither is refused for being unknown.
      lists: { 'worker/claude': [WIDE, NARROW], '*': [NARROW] },
    }
    const handles: FakeSessionHandle[] = []
    const issued = new FakeProviderSessions()
    const gate = anOpenGate()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new HomeListDouble(provider, handles, issued, gate, world),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(homes(), profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(homes(), provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      listProfiles: () => [
        'brobot',
        ...(existsSync(homes()) ? readdirSync(homes()).filter((one) => one !== 'brobot') : []),
      ],
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): number =>
    events(sessionId).filter((event) => event.type === 'turn').length
  const runningOf = (sessionId: string): string | undefined =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )?.running
  const rowOf = (sessionId: string) =>
    db
      .prepare(
        'SELECT model, reasoning_effort, model_or_effort_set_by_a_person_at AS setLive FROM provider_session WHERE id = ?',
      )
      .get(sessionId) as {
      model: string | null
      reasoning_effort: string | null
      setLive: number | null
    }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<AgentToolAnswer> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return tool.call(args)
  }
  const structured = (answer: AgentToolAnswer): Record<string, unknown> =>
    answer.structured as Record<string, unknown>

  /**
   * ⚑ A worker the PM's give started on `narrow` at `low`, its brief's turn over; a person then
   * TAKES IT OVER in their window and — when `personPicks` — sets its model live through the
   * window's door (`setSessionSetting`, the path that stamps the row); the person closes it; the PM
   * takes its stalled first piece back, which wakes the worker to hear so. ⚑ The control walks the
   * identical path and changes nothing in the window.
   */
  const aWorkerReadyForMore = async (
    personPicks: boolean,
  ): Promise<{ pm: string; worker: string }> => {
    expect(
      store.createAgentIdentity(
        { slug: 'worker', displayName: null, provider: 'claude' },
        { by: 'a-person' },
      ),
    ).not.toBeNull()
    mkdirSync(join(homes(), 'worker', 'claude'), { recursive: true })
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
      window,
    )
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'first',
      brief: 'go',
      model: 'narrow',
      effort: 'low',
    })
    expect(structured(given).outcome, given.text).toBe('ok')
    expect(structured(given).started, given.text).toBe(true)
    const worker = structured(given).agent as string
    const first = structured(given).label as string
    await waitFor(() => turnsIn(worker) > 0, 'the first piece’s turn to end')
    expect(rowOf(worker)).toMatchObject({ model: 'narrow', reasoning_effort: 'low', setLive: null })

    // ⚑ A person takes it over in their window — in both arms, so the two differ by the pick alone.
    host.claimSession(worker, window)
    if (personPicks) {
      // 🔴 **The window's live door** — `wide` keeps the `low` it runs at, since `wide` offers it.
      await executeRuntimeCommand(host, window, {
        kind: 'setSessionSetting',
        sessionId: worker,
        body: { kind: 'model', value: 'wide' },
      })
    }
    await host.close(worker, window)
    await waitFor(() => runningOf(worker) === 'not-running', 'the worker to be over')

    // ⚑ Its first piece taken back: a give to a helper still holding stalled work is refused
    // (`its-work-has-stalled`), and taking it back wakes the helper to hear so — on its row's pair.
    const turns = turnsIn(worker)
    const resumed = world.resumed.length
    const took = await callOn(pm, 'withdraw_task', { piece: first })
    expect(structured(took).outcome, took.text).toBe('ok')
    await waitFor(
      () => world.resumed.length > resumed && turnsIn(worker) > turns,
      'the worker to hear its piece was taken back',
    )
    return { pm, worker }
  }

  /** ⚑ The SAME give in both arms: more work, naming `narrow` at `high` — another listed pair. */
  const giveMoreNaming = async (pm: string): Promise<AgentToolAnswer> => {
    const answered = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'and then',
      brief: 'and then',
      model: 'narrow',
      effort: 'high',
    })
    expect(structured(answered).outcome, answered.text).toBe('ok')
    // ⚑ The conversation it HAS: no start, so the pair is the give's to switch or to leave.
    expect(structured(answered).started, answered.text).toBe(false)
    return answered
  }

  it('🔴 a pair a PERSON set live is KEPT by a give naming another — and the answer says a person chose it', async () => {
    const { pm, worker } = await aWorkerReadyForMore(true)
    // ⚑ The premise: the person's pick is on the row, and stamped as theirs.
    expect(rowOf(worker)).toMatchObject({ model: 'wide', reasoning_effort: 'low' })
    expect(rowOf(worker).setLive).toEqual(expect.any(Number))

    const answered = await giveMoreNaming(pm)

    // ⛔ Not switched: the answer names the person's pair, and why the named one went unused.
    expect(structured(answered).runs_on).toEqual({ model: 'wide', effort: 'low' })
    expect(answered.text).toContain('It keeps running on “wide” at low effort')
    expect(answered.text).toContain(
      'a person chose that for this conversation, so the model and effort you named were not used.',
    )
    expect(answered.text).not.toContain('from this piece on')
    // ⛔ …and the recorded pair every later start replays is the person's, still stamped.
    expect(rowOf(worker)).toMatchObject({ model: 'wide', reasoning_effort: 'low' })
    expect(rowOf(worker).setLive).toEqual(expect.any(Number))
  })

  it('⛔ CONTROL · the identical give over a pair NOBODY set live switches it — from this piece on', async () => {
    const { pm, worker } = await aWorkerReadyForMore(false)
    // ⚑ The premise: the give's own pair, and no stamp.
    expect(rowOf(worker)).toMatchObject({ model: 'narrow', reasoning_effort: 'low', setLive: null })

    const answered = await giveMoreNaming(pm)

    expect(structured(answered).runs_on).toEqual({ model: 'narrow', effort: 'high' })
    expect(answered.text).toContain('It now runs on “narrow” at high effort')
    expect(answered.text).toContain('from this piece on.')
    expect(answered.text).not.toContain('a person chose that')
    // ⚑ …and the row every later start replays holds the give's pair.
    expect(rowOf(worker)).toMatchObject({
      model: 'narrow',
      reasoning_effort: 'high',
      setLive: null,
    })
  })
})
