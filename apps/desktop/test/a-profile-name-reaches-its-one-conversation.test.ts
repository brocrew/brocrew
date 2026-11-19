import { answerOn } from './helpers/call-tool'
import { recordFixtureStarts } from './lib/provider-double'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
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
  fixtureHostPaths,
} from './lib/host-fixture'
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

interface Answer {
  readonly structured: Record<string, unknown>
  readonly text: string
}

describe('messages and questions use conversation addresses', () => {
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

  const fixturePaths = () => fixtureHostPaths(() => userData)

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
      resourcesRoot: fixturePaths().resourcesRoot,
      createRuntime: recordFixtureStarts(handles, issued),
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
    kind: 'note',
    text: 'Always end with one question that checks understanding.',
  })
  const aQuestion = (agent: string): Record<string, unknown> => ({
    agent,
    who_answers: 'an-agent',
    question: 'Which exercise comes first?',
  })

  it('a task label and an id both reach the same conversation', async () => {
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

  it('refuses a profile name without recording a message or question', async () => {
    const { caller, callerTools } = await aWorld()
    for (const spelling of ['worker', 'Worker']) {
      const sent = await fullCall(callerTools, 'message_agent', aNote(spelling))
      expect(sent.structured, sent.text).toMatchObject({
        outcome: 'refused',
        rail: 'no-such-agent',
      })
      const asked = await fullCall(callerTools, 'ask_question', aQuestion(spelling))
      expect(asked.structured, asked.text).toMatchObject({
        outcome: 'refused',
        rail: 'no-agent-you-can-ask-by-that-name',
      })
    }
    expect(
      ledger(caller).filter((event) =>
        ['message_sent', 'question_asked', 'request_routed'].includes(event.type),
      ),
    ).toEqual([])
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
    const ambiguous = await fullCall(tools, 'message_agent', aNote('worker'))
    expect(ambiguous.structured, ambiguous.text).toMatchObject({
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

  it('keeps explicit addresses distinct after a retired message grant', async () => {
    const { giver, giverTools, worker } = await aWorld()
    const personsWorker = await personOpens('worker')
    expect(store.rootOf(personsWorker)?.label).toBe('W3')
    db.prepare("UPDATE agent_identity SET can_message = 'none' WHERE slug = ?").run(
      DEFAULT_PROFILE_ID,
    )

    expect(await callOn(giverTools, 'ask_question', aQuestion('W1.1'))).toMatchObject({
      outcome: 'ok',
      agent: worker,
    })
    expect(await callOn(giverTools, 'ask_question', aQuestion('W3'))).toMatchObject({
      outcome: 'ok',
      agent: personsWorker,
    })
    expect(ledger(giver).filter((event) => event.type === 'request_routed')).toHaveLength(2)
  })

  it('addresses the caller itself by its own label', async () => {
    const { callerTools } = await aWorld()
    const said = await callOn(callerTools, 'message_agent', aNote('W2'))
    expect(said, JSON.stringify(said)).toMatchObject({
      outcome: 'refused',
      rail: 'that-agent-is-you',
    })
  })

  it('can send a note by the label of an archived conversation', async () => {
    const { worker, callerTools } = await aWorld()
    expect(await host.archiveConversation(worker)).toMatchObject({ done: true })
    expect(await callOn(callerTools, 'message_agent', aNote('W1.1'))).toMatchObject({
      outcome: 'ok',
      agent: worker,
    })
  })

  it('resolves the same explicit address for interrupting and plain messages', async () => {
    const { giverTools, worker, callerTools } = await aWorld()
    expect(
      await callOn(callerTools, 'message_agent', { ...aNote('W1.1'), interrupt: true }),
    ).toMatchObject({ outcome: 'ok' })
    expect(await callOn(giverTools, 'message_agent', aNote('W1.1'))).toMatchObject({
      outcome: 'ok',
      agent: worker,
    })
  })

  it('ignores old kind values and checks the optional task reference', async () => {
    const { worker, caller, callerTools } = await aWorld()
    const tool = callerTools.tools.find((candidate) => candidate.name === 'message_agent')
    expect(tool?.input).not.toHaveProperty('kind')
    const args = { agent: worker, text: 'Keep the examples short.' }
    const refusalAt = async (piece: string) => {
      const { text, structured } = await answerOn(callerTools, 'message_agent', { ...args, piece })
      expect(structured).toMatchObject({
        outcome: 'refused',
        rail: 'no-piece-by-that-name',
        detail: { piece },
      })
      const detail = structured?.detail as Record<string, unknown>
      return {
        text,
        structured: { ...structured, detail: { ...detail, piece: '<task>' } },
      }
    }
    expect(await refusalAt('W1.1')).toEqual(await refusalAt('W9.9'))
    expect(ledger(caller).filter((event) => event.type === 'message_sent')).toEqual([])
    for (const legacy of [{}, { kind: 'follow-up' }, { kind: false }]) {
      expect(await callOn(callerTools, 'message_agent', { ...args, ...legacy })).toMatchObject({
        outcome: 'ok',
        agent: worker,
        kind: 'note',
      })
    }
    expect(ledger(caller).filter((event) => event.type === 'message_sent')).toHaveLength(3)
  })
})
