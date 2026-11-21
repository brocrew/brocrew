import type { TranscriptEvent } from '../src/shared/conversation-events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { ProviderDouble, anOpenGate } from './lib/provider-double'
import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { waitFor } from './lib/scripted-codex-host'
import { homesUnder } from './helpers/scratch-host'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const levels = (...ids: string[]): { id: string; label: string }[] =>
  ids.map((id) => ({ id, label: id }))

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
  handles: FakeSessionHandle[]
  resumed: { provider: Provider; options: ResumeOptions }[]
}

describe('a give applies named settings after a person choice', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let counter: number
  let clock: number
  let world: World
  const window = new RecordingSink('webContents:1')
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
      handles: [],
      resumed: [],
    }
    const handles = world.handles
    const issued = new FakeProviderSessions()
    const gate = anOpenGate()
    class ListedChoices extends ProviderDouble {
      override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
        world.resumed.push({ provider: this.provider, options })
        return super.resume(ref, options)
      }
      override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
        await super.listModels(context)
        return [WIDE, NARROW]
      }
    }
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      ...homesUnder(() => userData),
      createRuntime: (provider: Provider) => new ListedChoices(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(homes(), profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      listProfiles: () => [
        'brobot',
        ...(existsSync(homes()) ? readdirSync(homes()).filter((one) => one !== 'brobot') : []),
      ],
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
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

  const aWorkerReadyForMore = async (
    personPicks: 'model' | 'effort' | 'both' | false,
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
      to: 'new',
      conversation_title: 'first',
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

    host.claimSession(worker, window)
    if (personPicks === 'model' || personPicks === 'both') {
      await executeRuntimeCommand(host, window, {
        kind: 'setSessionSetting',
        sessionId: worker,
        body: { kind: 'model', value: 'wide' },
      })
    }
    if (personPicks === 'effort' || personPicks === 'both') {
      await executeRuntimeCommand(host, window, {
        kind: 'setSessionSetting',
        sessionId: worker,
        body: { kind: 'reasoningEffort', value: 'high' },
      })
    }
    await host.close(worker, window)
    await waitFor(() => runningOf(worker) === 'not-running', 'the worker to be over')

    const turns = turnsIn(worker)
    const resumed = world.resumed.length
    const took = await callOn(pm, 'withdraw_task', { piece: first })
    expect(structured(took).outcome, took.text).toBe('ok')
    expect(world.resumed.length).toBe(resumed)
    const told = await callOn(pm, 'message_agent', { agent: worker, text: 'that piece is off' })
    expect(structured(told).outcome, told.text).toBe('ok')
    await waitFor(
      () => world.resumed.length > resumed && turnsIn(worker) > turns,
      'the worker to hear its piece was taken back',
    )
    return { pm, worker }
  }

  const giveMoreNaming = async (
    pm: string,
    worker: string,
    choice: Record<string, string> = { model: 'narrow', effort: 'high' },
  ): Promise<AgentToolAnswer> => {
    const answered = await callOn(pm, 'give_work', {
      to: worker,
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'and then',
      brief: 'and then',
      ...choice,
    })
    expect(structured(answered).outcome, answered.text).toBe('ok')
    expect(structured(answered).started, answered.text).toBe(false)
    return answered
  }

  describe.each(['model', 'effort', 'both'] as const)('after a person sets %s', (prior) => {
    it.each(['model', 'effort', 'both', 'omitted'] as const)(
      'applies requested %s and retains provenance',
      async (requested) => {
        const { pm, worker } = await aWorkerReadyForMore(prior)
        const was = rowOf(worker)
        expect(was.setLive).toEqual(expect.any(Number))
        const choice = {
          ...(requested === 'model' || requested === 'both'
            ? { model: was.model === 'wide' ? 'narrow' : 'wide' }
            : {}),
          ...(requested === 'effort' || requested === 'both'
            ? { effort: was.reasoning_effort === 'high' ? 'low' : 'high' }
            : {}),
        }
        const turns = turnsIn(worker)
        const answered = await giveMoreNaming(pm, worker, choice)
        const pair = {
          model: choice.model ?? was.model,
          effort: choice.effort ?? was.reasoning_effort,
        }
        expect(structured(answered).runs_on).toEqual(pair)
        expect(structured(answered).receipt).toMatchObject({ recipient: { id: worker } })
        expect(rowOf(worker)).toEqual({
          model: pair.model,
          reasoning_effort: pair.effort,
          setLive: was.setLive,
        })
        expect(store.recordedOne(worker)?.provider).toBe('claude')
        await waitFor(() => turnsIn(worker) > turns, 'the new brief to finish its turn')
        expect(world.handles.at(-1)?.settings).toMatchObject({
          model: { requested: pair.model, effective: pair.model },
          reasoningEffort: { requested: pair.effort, effective: pair.effort },
        })
      },
    )
  })

  it.each([
    [{ model: 'missing' }, 'model-not-in-the-list'],
    [{ effort: 'missing' }, 'effort-not-offered'],
    [{ provider: 'codex', model: 'narrow' }, 'its-provider-is-fixed'],
  ] as const)(
    'refuses invalid choices %j without changing person settings',
    async (choice, rail) => {
      const { pm, worker } = await aWorkerReadyForMore('both')
      const was = rowOf(worker)
      const answered = await callOn(pm, 'give_work', {
        to: worker,
        profile: 'worker',
        title: 'invalid',
        brief: 'invalid',
        definition_of_done: 'Done.',
        ...choice,
      })
      expect(structured(answered)).toMatchObject({ outcome: 'refused', rail })
      expect(rowOf(worker)).toEqual(was)
      expect(store.recordedOne(worker)?.provider).toBe('claude')
    },
  )

  it('⛔ CONTROL · the identical give over a pair NOBODY set live switches it — from this piece on', async () => {
    const { pm, worker } = await aWorkerReadyForMore(false)
    expect(rowOf(worker)).toMatchObject({ model: 'narrow', reasoning_effort: 'low', setLive: null })

    const answered = await giveMoreNaming(pm, worker)

    expect(structured(answered).runs_on).toEqual({ model: 'narrow', effort: 'high' })
    expect(structured(answered).receipt).toMatchObject({ recipient: { id: worker } })
    expect(rowOf(worker)).toMatchObject({
      model: 'narrow',
      reasoning_effort: 'high',
      setLive: null,
    })
  })
})
