import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
/** An outbound Message or Ask uses an exact conversation address on either provider. */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

interface Answer {
  readonly structured: Record<string, unknown>
  readonly text: string
}

describe('a profile name reaches its one conversation', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-profile-name-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-profile-name-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const fullCall = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Answer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = await tool.call(args)
    return { structured: answer.structured as Record<string, unknown>, text: answer.text }
  }
  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => (await fullCall(toolset, name, args)).structured

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** `giver` gives a new `worker` a piece, and the worker's first turn is recorded. */
  const giveAWorker = async (giver: AgentToolset, title: string, label: string) => {
    await callOn(giver, 'create_agent', { profile_slug: 'worker' })
    const given = await callOn(giver, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      to: 'new',
      conversation_title: title,
      title,
      brief: title.toLowerCase(),
    })
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label, started: true })
    const worker = given.agent as string
    await waitFor(() => ledger(worker).some((event) => event.type === 'turn'), `${label}’s turn`)
    return worker
  }

  interface World {
    readonly giver: string
    readonly giverTools: AgentToolset
    readonly worker: string
    readonly caller: string
    readonly callerTools: AgentToolset
  }
  const aWorld = async (): Promise<World> => {
    const giver = await personOpens(DEFAULT_PROFILE_ID)
    const giverTools = agentToolsFor(host, giver)
    const worker = await giveAWorker(giverTools, 'Plan the openings', 'W1.1')
    const caller = await personOpens('reviewer')
    expect(store.rootOf(caller)?.label).toBe('W2')
    return { giver, giverTools, worker, caller, callerTools: agentToolsFor(host, caller) }
  }

  const aNote = (agent: string): Record<string, unknown> => ({
    agent,
    text: 'Always end with one question that checks understanding.',
  })
  const aQuestion = (agent: string): Record<string, unknown> => ({
    agent,
    who_answers: 'an-agent',
    question: 'Which exercise comes first?',
  })

  it('a label and a conversation id reach the same exact recipient', async () => {
    const { worker, caller, callerTools } = await aWorld()

    for (const spelled of ['W1.1', worker]) {
      const note = await callOn(callerTools, 'message_agent', aNote(spelled))
      expect(note, `${spelled}: ${JSON.stringify(note)}`).toMatchObject({
        outcome: 'ok',
        agent: worker,
      })
      const asked = await callOn(callerTools, 'ask_question', aQuestion(spelled))
      expect(asked, `${spelled}: ${JSON.stringify(asked)}`).toMatchObject({
        outcome: 'ok',
        went_to: 'an-agent',
        agent: worker,
      })
    }
    const sent = ledger(caller).filter((event) => event.type === 'message_sent')
    expect(sent).toHaveLength(2)
    for (const one of sent) expect(one).toMatchObject({ to: worker })
    const routed = ledger(caller).filter((event) => event.type === 'request_routed')
    expect(routed).toHaveLength(2)
    for (const one of routed) expect(one).toMatchObject({ parent: worker })
  })

  it('a profile name with several conversations sends no Message or Ask', async () => {
    const { worker, caller, callerTools } = await aWorld()
    const second = await personOpens('worker')
    const queued = vi.spyOn(host, 'queueMessage')
    const rowsBefore = ledger(caller).length

    for (const [tool, args] of [
      ['message_agent', aNote('worker')],
      ['ask_question', aQuestion('worker')],
    ] as const) {
      const said = await fullCall(callerTools, tool, args)
      expect(said.structured, said.text).toMatchObject({ outcome: 'refused' })
      expect(said.text).toMatch(/^Not sent: /)
      expect(said.text).not.toContain('W1.1')
      expect(said.text).not.toContain('W3')
    }
    expect(queued).not.toHaveBeenCalled()
    expect(
      ledger(caller)
        .slice(rowsBefore)
        .filter((event) => event.type === 'message_sent' || event.type === 'request_routed'),
    ).toEqual([])

    // The next call names one of the labels, and each reaches its own conversation.
    for (const [label, id] of [
      ['W1.1', worker],
      ['W3', second],
    ] as const) {
      expect(await callOn(callerTools, 'message_agent', aNote(label))).toMatchObject({
        outcome: 'ok',
        agent: id,
      })
    }
  })

  it('refuses a profile name after gives on both providers, while each label reaches its own provider', async () => {
    const giver = await personOpens(DEFAULT_PROFILE_ID)
    const tools = agentToolsFor(host, giver)
    const claude = await giveAWorker(tools, 'Plan the fictional catalogue', 'W1.1')
    const given = await callOn(tools, 'give_work', {
      to: 'new',
      conversation_title: 'Review the fictional catalogue',
      profile: 'worker',
      provider: 'codex',
      title: 'Review the fictional catalogue',
      brief: 'Review the fictional catalogue.',
      definition_of_done: 'The fictional catalogue review is recorded.',
    })
    expect(given, JSON.stringify(given)).toMatchObject({
      outcome: 'ok',
      label: 'W1.2',
      started: true,
    })
    const codex = given.agent as string
    expect(codex).not.toBe(claude)
    await waitFor(() => ledger(codex).some((event) => event.type === 'turn'), 'the Codex turn')
    expect(store.recordedOne(claude)?.provider).toBe('claude')
    expect(store.recordedOne(codex)?.provider).toBe('codex')

    const queued = vi.spyOn(host, 'queueMessage')
    const before = ledger(giver).length
    const refused = await fullCall(tools, 'message_agent', aNote('worker'))
    expect(refused.structured, refused.text).toMatchObject({
      outcome: 'refused',
      rail: 'no-such-agent',
    })
    expect(queued).not.toHaveBeenCalled()
    expect(
      ledger(giver)
        .slice(before)
        .filter((event) => event.type === 'message_sent'),
    ).toEqual([])

    for (const [label, id, provider] of [
      ['W1.1', claude, 'claude'],
      ['W1.2', codex, 'codex'],
    ] as const) {
      const firstCall = queued.mock.calls.length
      expect(await callOn(tools, 'message_agent', aNote(label))).toMatchObject({
        outcome: 'ok',
        agent: id,
      })
      expect(queued.mock.calls[firstCall]?.[0]).toBe(id)
      expect(store.recordedOne(id)?.provider).toBe(provider)
      expect(
        ledger(giver)
          .filter((event) => event.type === 'message_sent')
          .at(-1),
      ).toMatchObject({
        to: id,
      })
    }
  })

  it('requires an exact address even when a profile has one conversation', async () => {
    const { caller, callerTools } = await aWorld()
    for (const profile of ['worker', 'reviewer']) {
      const message = await callOn(callerTools, 'message_agent', aNote(profile))
      expect(message).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
    }
    const self = await callOn(callerTools, 'message_agent', aNote(caller))
    expect(self).toMatchObject({ outcome: 'refused', rail: 'that-agent-is-you' })
  })

  it('reaches the chosen archived conversation by its label and keeps both archived', async () => {
    const { worker, callerTools } = await aWorld()
    expect(await host.archiveConversation(worker)).toMatchObject({ done: true })
    const another = await personOpens('worker')
    expect(await host.archiveConversation(another)).toMatchObject({ done: true })
    const workerArchived = host.whenItWasArchived(worker)
    const anotherArchived = host.whenItWasArchived(another)
    expect(await callOn(callerTools, 'message_agent', aNote('W1.1'))).toMatchObject({
      outcome: 'ok',
      agent: worker,
    })
    expect(await callOn(callerTools, 'ask_question', aQuestion('W3'))).toMatchObject({
      outcome: 'ok',
      agent: another,
    })
    expect(host.whenItWasArchived(worker)).toBe(workerArchived)
    expect(host.whenItWasArchived(another)).toBe(anotherArchived)
  })

  it('uses the same address for an interrupting Message and a plain one', async () => {
    const { giverTools, worker, callerTools } = await aWorld()
    expect(
      await callOn(callerTools, 'message_agent', { ...aNote('W1.1'), interrupt: true }),
    ).toMatchObject({ outcome: 'ok', agent: worker })
    expect(await callOn(giverTools, 'message_agent', aNote(worker))).toMatchObject({
      outcome: 'ok',
      agent: worker,
    })
  })

  it('reaches a second conversation of the caller’s profile by that conversation’s own address', async () => {
    const { caller, callerTools } = await aWorld()
    const other = await personOpens('reviewer')
    expect(caller).not.toBe(other)
    expect(await callOn(callerTools, 'message_agent', aNote('W3'))).toMatchObject({
      outcome: 'ok',
      agent: other,
    })
  })

  it('uses the same refusal for a task outside the sender’s work and an invented task', async () => {
    const { worker, caller, callerTools } = await aWorld()
    const namedMessage = (piece: string) =>
      fullCall(callerTools, 'message_agent', {
        agent: 'W1.1',
        piece,
        text: 'Always end with one question that checks understanding.',
      })

    const refused = await namedMessage('W1.1')
    expect(refused.structured, refused.text).toMatchObject({
      outcome: 'refused',
      rail: 'no-piece-by-that-name',
    })
    expect(refused.text).toMatch(/^Not sent: /)
    expect((await namedMessage('W9.9')).text).toBe(refused.text)
    expect(ledger(caller).filter((event) => event.type === 'message_sent')).toEqual([])

    const note = await callOn(callerTools, 'message_agent', aNote('W1.1'))
    expect(note, JSON.stringify(note)).toMatchObject({ outcome: 'ok', agent: worker })
  })
})
