/**
 * An agent's profile name reaches its conversation at `message_agent` and `ask_question`.
 *
 *  1. A profile name with exactly one conversation in the caller's reach names that conversation,
 *     as its label and its id do.
 *  2. A profile name with several is refused, nothing is sent or asked, and the refusal lists their
 *     labels; the next call names one of them.
 *  3. The reach is the one every agent address has: a profile whose conversations are out of reach
 *     is refused as a name nobody holds, and only the conversations in reach are counted.
 *  4. A follow-up naming a piece the caller did not give says to send the words as a note to the
 *     same agent, without the piece, and that note goes.
 *
 * The fixture: a person's conversation `W1` gives `W1.1` to a new `worker`; a person's second
 * conversation, `W2`, run by `reviewer`, is the caller that gave nothing.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
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

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** `giver` gives a new `worker` a piece, and the worker's first turn is recorded. */
  const giveAWorker = async (giver: AgentToolset, title: string, label: string) => {
    const given = await callOn(giver, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
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
    kind: 'note',
    text: 'Always end with one question that checks understanding.',
  })
  const aQuestion = (agent: string): Record<string, unknown> => ({
    agent,
    who_answers: 'an-agent',
    question: 'Which exercise comes first?',
  })

  it('a profile name with one conversation in reach names it, as its label and its id do', async () => {
    const { worker, caller, callerTools } = await aWorld()

    for (const spelled of ['worker', 'Worker', 'W1.1', worker]) {
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
    expect(sent).toHaveLength(4)
    for (const one of sent) expect(one).toMatchObject({ to: worker })
    const routed = ledger(caller).filter((event) => event.type === 'request_routed')
    expect(routed).toHaveLength(4)
    for (const one of routed) expect(one).toMatchObject({ parent: worker })
  })

  it('a profile name with several conversations in reach is refused with their labels, and nothing is sent or asked', async () => {
    const { worker, caller, callerTools } = await aWorld()
    const second = await personOpens('worker')
    const queued = vi.spyOn(host, 'queueMessage')
    const raised = vi.spyOn(host, 'raiseAQuestion')
    const rowsBefore = ledger(caller).length

    for (const [tool, args] of [
      ['message_agent', aNote('worker')],
      ['ask_question', aQuestion('worker')],
    ] as const) {
      const said = await fullCall(callerTools, tool, args)
      expect(said.structured, said.text).toMatchObject({
        outcome: 'refused',
        rail: 'that-agent-has-several-conversations',
        permanence: 'permanent',
        retryable: false,
      })
      const detail = said.structured.detail as { agent: string; conversations: string[] }
      expect(detail.agent).toBe('worker')
      expect([...detail.conversations].sort()).toEqual(['W1.1', 'W3'])
      expect(said.text).toMatch(
        /^refused \(that-agent-has-several-conversations\): make the same call with agent set to one of worker’s conversations: (?:W1\.1 or W3|W3 or W1\.1)\. It has more than one you can reach, so nothing was done\./,
      )
    }
    expect(queued).not.toHaveBeenCalled()
    expect(raised).not.toHaveBeenCalled()
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
    const ambiguous = await fullCall(tools, 'message_agent', aNote('worker'))
    expect(ambiguous.structured, ambiguous.text).toMatchObject({
      outcome: 'refused',
      rail: 'that-agent-has-several-conversations',
      detail: { agent: 'worker', conversations: expect.arrayContaining(['W1.1', 'W1.2']) },
    })
    expect((ambiguous.structured.detail as { conversations: string[] }).conversations).toHaveLength(
      2,
    )
    expect(ambiguous.text).toContain('W1.1')
    expect(ambiguous.text).toContain('W1.2')
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

  it('a profile name keeps the reach every address has: out of reach is no agent, and only what is in reach is counted', async () => {
    const { giver, giverTools, worker } = await aWorld()
    // A person's own conversation with the same agent, which the giver did not start.
    const personsWorker = await personOpens('worker')
    expect(store.rootOf(personsWorker)?.label).toBe('W3')

    // Before the narrowing both are in the giver's reach.
    const both = await callOn(giverTools, 'ask_question', aQuestion('worker'))
    expect(both, JSON.stringify(both)).toMatchObject({
      outcome: 'refused',
      rail: 'that-agent-has-several-conversations',
    })

    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canMessage: 'none' })).toBe(true)

    // Only the worker it started is in reach now, so the name names that one.
    const one = await callOn(giverTools, 'ask_question', aQuestion('worker'))
    expect(one, JSON.stringify(one)).toMatchObject({ outcome: 'ok', agent: worker })

    // The reviewer's conversation is out of reach: told as a name nobody holds.
    const strange = await fullCall(giverTools, 'ask_question', aQuestion('reviewer'))
    const nobody = await fullCall(giverTools, 'ask_question', aQuestion('nobody-by-this-name'))
    expect(strange.structured.outcome).toBe('refused')
    expect(strange.structured.rail).toBe(nobody.structured.rail)
    expect(strange.text.replace('reviewer', 'X')).toBe(
      nobody.text.replace('nobody-by-this-name', 'X'),
    )
    expect(JSON.stringify(strange.structured)).not.toContain('sess_')
    expect(ledger(giver).filter((event) => event.type === 'request_routed')).toHaveLength(1)
  })

  it('a profile name whose only conversation is the caller’s own names the caller', async () => {
    const { callerTools } = await aWorld()
    const said = await callOn(callerTools, 'message_agent', aNote('reviewer'))
    expect(said, JSON.stringify(said)).toMatchObject({
      outcome: 'refused',
      rail: 'that-agent-is-you',
    })
  })

  it('counts archived conversations, and a single archived target can still receive a note', async () => {
    const { worker, callerTools } = await aWorld()
    expect(await host.archiveConversation(worker)).toMatchObject({ done: true })
    expect(await callOn(callerTools, 'message_agent', aNote('worker'))).toMatchObject({
      outcome: 'ok',
      agent: worker,
    })
    const another = await personOpens('worker')
    expect(await host.archiveConversation(another)).toMatchObject({ done: true })
    expect(await callOn(callerTools, 'ask_question', aQuestion('worker'))).toMatchObject({
      outcome: 'refused',
      rail: 'that-agent-has-several-conversations',
      detail: { conversations: expect.arrayContaining(['W1.1', 'W3']) },
    })
  })

  it('lists every reachable label in detail and caps the labels in the refusal prose at five', async () => {
    const { callerTools } = await aWorld()
    for (let i = 0; i < 6; i++) await personOpens('worker')
    const said = await fullCall(callerTools, 'message_agent', aNote('worker'))
    const labels = (said.structured.detail as { conversations: string[] }).conversations
    expect(labels).toHaveLength(7)
    expect(said.text).toContain(labels.slice(0, 5).join(', ') + ' and 2 more, all in the detail')
    expect(said.text).not.toContain(labels[5])
    expect(said.text).not.toContain(labels[6])
  })

  it('keeps message and interrupt permissions after resolving a profile name', async () => {
    const { giverTools, worker, callerTools } = await aWorld()
    expect(
      await callOn(callerTools, 'message_agent', { ...aNote('worker'), interrupt: true }),
    ).toMatchObject({
      outcome: 'refused',
      rail: 'that-agent-is-not-below-you',
    })
    expect(store.setCapabilities('reviewer', { canMessage: 'none' })).toBe(true)
    const denied = await fullCall(callerTools, 'message_agent', aNote('worker'))
    const unknown = await fullCall(callerTools, 'message_agent', aNote('nobody-by-this-name'))
    expect(denied.structured.rail).toBe(unknown.structured.rail)
    expect(denied.structured.outcome).toBe('refused')
    expect(await callOn(giverTools, 'message_agent', aNote('worker'))).toMatchObject({
      outcome: 'ok',
      agent: worker,
    })
  })

  it('counts the caller alongside other reachable conversations of its profile', async () => {
    const { caller, callerTools } = await aWorld()
    const other = await personOpens('reviewer')
    for (const [tool, args] of [
      ['message_agent', aNote('reviewer')],
      ['ask_question', aQuestion('reviewer')],
    ] as const) {
      const said = await callOn(callerTools, tool, args)
      expect(said).toMatchObject({
        outcome: 'refused',
        rail: 'that-agent-has-several-conversations',
        detail: { conversations: expect.arrayContaining(['W2', 'W3']) },
      })
    }
    expect(caller).not.toBe(other)
  })

  it('a follow-up on a piece the caller did not give says to send it as a note to the same agent, and that note goes', async () => {
    const { worker, caller, callerTools } = await aWorld()
    const followUp = (piece: string) =>
      fullCall(callerTools, 'message_agent', {
        agent: 'W1.1',
        kind: 'follow-up',
        piece,
        text: 'Always end with one question that checks understanding.',
      })

    const refused = await followUp('W1.1')
    expect(refused.structured, refused.text).toMatchObject({
      outcome: 'refused',
      rail: 'not-a-piece-you-gave',
    })
    expect(refused.text).toBe(
      'refused (not-a-piece-you-gave): send it as kind note to W1.1, leaving out piece: that is not a piece you gave that agent, so nothing was sent. This exact call can never succeed.',
    )
    // A piece no one holds is told in the same words: the sentence does not say whether it exists.
    expect((await followUp('W9.9')).text).toBe(refused.text)
    expect(ledger(caller).filter((event) => event.type === 'message_sent')).toEqual([])

    const note = await callOn(callerTools, 'message_agent', aNote('W1.1'))
    expect(note, JSON.stringify(note)).toMatchObject({ outcome: 'ok', agent: worker })
  })
})
