import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { PieceRow } from '../src/shared/tasks'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * A wait names what will end it.
 *
 * A helper (Ada) marks a piece as waiting on purpose with `update_work`'s `on`: another piece or a
 * question it asked an agent, a question it asked a person, a time, or a background task in its
 * own conversation. Each is checked before anything is written, and the line keeps it. A wait that
 * names nothing — `waiting: true`, as before — is refused, and so is a wait on the person that
 * names a question only asked in chat. A mark from before a wait named its target is listed for
 * the person as a wait that needs classifying, until a new line replaces it.
 *
 * A real `RuntimeHost` over a real SQLite ledger, real migrations and the real tools; the only
 * double is the provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Long enough for every pump and every flush a row arms to have run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

/** The provider double: it keeps the handles it gives out, so a test can report background work. */
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
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
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

describe('a wait names what will end it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let counter: number
  let clock: number
  let window: RecordingSink
  let buildHost: () => RuntimeHost
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-wait-on-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-wait-on-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_800_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    const issued = new FakeProviderSessions()
    buildHost = () =>
      new RuntimeHost({
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
        startGapMs: 1,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
        statesMoved: () => undefined,
      })
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const call = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
  const ok = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const answer = await call(toolset, name, args)
    expect(answer, JSON.stringify(answer)).toMatchObject({ outcome: 'ok' })
    return answer
  }
  const pieceOf = (owner: string, piece: string): PieceRow | undefined =>
    store.piecesOwnedBy(owner).find((one) => one.piece === piece)
  const statusRows = (owner: string): TranscriptEvent[] =>
    store
      .events(owner)
      .map((entry) => entry.event)
      .filter((event) => event.type === 'work_status_set')
  const anHourAhead = (): string => new Date(clock + 3_600_000).toISOString()

  /** BroBot gives a piece to its worker, minted Ada the first time; the brief's turn ends with it open. */
  const aPieceGiven = async (
    brobot: string,
    title: string,
    first: boolean,
  ): Promise<{ ada: string; piece: string; label: string }> => {
    const given = await ok(agentToolsFor(host, brobot), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      ...(first ? { new: true } : {}),
      title,
      brief: title.toLowerCase(),
    })
    const ada = given.agent as string
    const piece = given.piece as string
    await waitFor(() => pieceOf(ada, piece)?.state === 'stalled', `the brief of ${title} to end`)
    await settle()
    return { ada, piece, label: given.label as string }
  }
  const aHelperWithAPiece = async (): Promise<{ brobot: string; ada: string; piece: string }> => {
    const { sessionId: brobot } = await host.createSession(
      { provider: 'claude', profileId: DEFAULT_PROFILE_ID, approvalMode: 'auto', cwd: root },
      window,
    )
    await settle()
    const { ada, piece } = await aPieceGiven(brobot, 'Build the pages', true)
    return { brobot, ada, piece }
  }
  /** Ada asks about W1.1, of her giver or of a person; the question's id. */
  const asks = async (ada: string, whoAnswers: 'the-parent' | 'a-person'): Promise<string> => {
    const asked = await ok(agentToolsFor(host, ada), 'ask_question', {
      piece: 'W1.1',
      question: 'which pages first?',
      who_answers: whoAnswers,
    })
    await settle()
    return asked.question as string
  }
  const waitsOn = async (
    ada: string,
    on: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    call(agentToolsFor(host, ada), 'update_work', { piece: 'W1.1', status: 'waiting', on })

  describe('a wait on each kind is kept on the line', () => {
    it('another agent’s piece, by its label', async () => {
      const { ada, piece } = await aHelperWithAPiece()
      const other = await ok(agentToolsFor(host, ada), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'writer',
        new: true,
        title: 'Write the copy',
        brief: 'write the copy',
      })
      await settle()
      expect(await waitsOn(ada, { agent: other.label })).toMatchObject({ outcome: 'ok' })
      expect(pieceOf(ada, piece)).toMatchObject({
        state: 'waiting-on-purpose',
        statusLine: { waiting: true, on: { kind: 'agent', piece: other.piece, label: 'W1.1.1' } },
      })
    })

    it('a question it asked its giver, and a question it asked a person', async () => {
      const { ada, piece } = await aHelperWithAPiece()
      const ofItsGiver = await asks(ada, 'the-parent')
      expect(await waitsOn(ada, { agent: ofItsGiver })).toMatchObject({ outcome: 'ok' })
      expect(pieceOf(ada, piece)?.statusLine?.on).toEqual({ kind: 'agent', request: ofItsGiver })
      const ofAPerson = await asks(ada, 'a-person')
      expect(await waitsOn(ada, { person: ofAPerson })).toMatchObject({ outcome: 'ok' })
      expect(pieceOf(ada, piece)?.statusLine?.on).toEqual({ kind: 'person', request: ofAPerson })
      // ⚑ The person's question is in their queue: the wait and its queue item are one request.
      expect(host.questionsForAPerson().rows.map((row) => row.request.requestId)).toContain(
        ofAPerson,
      )
    })

    it('its giver may mark it waiting on a question its holder asked a person', async () => {
      const { brobot, ada, piece } = await aHelperWithAPiece()
      const ofAPerson = await asks(ada, 'a-person')
      expect(
        await call(agentToolsFor(host, brobot), 'update_work', {
          piece: 'W1.1',
          status: 'Ada asked which pages come first',
          on: { person: ofAPerson },
        }),
      ).toMatchObject({ outcome: 'ok' })
      expect(pieceOf(ada, piece)?.statusLine).toMatchObject({
        by: brobot,
        on: { kind: 'person', request: ofAPerson },
      })
    })

    it('a time ahead', async () => {
      const { ada, piece } = await aHelperWithAPiece()
      const at = anHourAhead()
      expect(await waitsOn(ada, { time: at })).toMatchObject({ outcome: 'ok' })
      expect(pieceOf(ada, piece)?.statusLine?.on).toEqual({ kind: 'time', at: Date.parse(at) })
    })

    it('a background task running in its conversation', async () => {
      const { ada, piece } = await aHelperWithAPiece()
      const handle = handles.at(-1)
      if (handle === undefined) throw new Error('no provider session was started')
      handle.simulateBackgroundWork({ running: [{ id: 'task_build', kind: 'local_bash' }] })
      await settle()
      expect(await waitsOn(ada, { event: 'task_build' })).toMatchObject({ outcome: 'ok' })
      expect(pieceOf(ada, piece)?.statusLine?.on).toEqual({
        kind: 'event',
        background: 'task_build',
      })
    })

    it('and the listed row carries what it waits on', async () => {
      const { ada } = await aHelperWithAPiece()
      const at = anHourAhead()
      await waitsOn(ada, { time: at })
      const row = [...host.resumableSessions(), ...host.unresumableSessions()].find(
        (one) => one.sessionId === ada,
      )
      expect(row?.waitingOnPurpose).toEqual({
        label: 'W1.1',
        status: 'waiting',
        on: { kind: 'time', at: Date.parse(at) },
      })
    })
  })

  describe('a wait that names nothing that will end it is refused, and nothing is written', () => {
    const refusedFor = async (
      args: Record<string, unknown>,
      said: string,
      setUp?: (ada: string, brobot: string) => Promise<Record<string, unknown>>,
    ): Promise<void> => {
      const { brobot, ada } = await aHelperWithAPiece()
      const extra = setUp === undefined ? {} : await setUp(ada, brobot)
      const before = statusRows(ada).length
      const answer = await call(agentToolsFor(host, ada), 'update_work', {
        piece: 'W1.1',
        status: 'waiting',
        ...args,
        ...extra,
      })
      expect(answer.outcome, JSON.stringify(answer)).toBe('refused')
      expect(JSON.stringify(answer.detail)).toContain(said)
      expect(statusRows(ada)).toHaveLength(before)
    }

    it('waiting alone, as before', () =>
      refusedFor(
        { waiting: true },
        'waiting is replaced by on, which names what ends the wait. Send one of: on: {person: ',
      ))

    it('two things at once', () =>
      refusedFor(
        { on: { time: anHourAhead(), agent: 'W1.1' } },
        'on must name exactly one of agent, person, time, event',
      ))

    it('a question asked only in chat: the person has no request', () =>
      refusedFor(
        { on: { person: 'which pages first?' } },
        'a question in your reply is not a request, so ask with ask_question(who_answers: a-person), or ask them to do something with request_action, first',
      ))

    it('a question to its giver named as the person’s', () =>
      refusedFor(
        {},
        'on.person names a question that waits on an agent: name it as on.agent',
        async (ada) => ({
          on: { person: await asks(ada, 'the-parent') },
        }),
      ))

    it('a question to a person named as an agent’s', () =>
      refusedFor(
        {},
        'on.agent names a question that waits on a person: name it as on.person',
        async (ada) => ({
          on: { agent: await asks(ada, 'a-person') },
        }),
      ))

    it('the piece itself', () =>
      refusedFor({ on: { agent: 'W1.1' } }, 'a piece cannot wait on itself'))

    it('another piece its holder holds too', () =>
      refusedFor(
        {},
        "on.agent names W1.2, which this piece's holder holds too: an agent cannot wait on itself. Name what W1.2 waits on instead, or set the status without on",
        async (_ada, brobot) => {
          const other = await aPieceGiven(brobot, 'Write the copy', false)
          return { on: { agent: other.label } }
        },
      ))

    it('its giver marking it waiting on another piece the same holder holds', async () => {
      const { brobot, ada, piece } = await aHelperWithAPiece()
      const other = await aPieceGiven(brobot, 'Write the copy', false)
      const before = statusRows(ada).length
      const answer = await call(agentToolsFor(host, brobot), 'update_work', {
        piece: 'W1.1',
        status: 'waiting on the copy',
        on: { agent: other.label },
      })
      expect(answer.outcome, JSON.stringify(answer)).toBe('refused')
      expect(JSON.stringify(answer.detail)).toContain('an agent cannot wait on itself')
      expect(statusRows(ada)).toHaveLength(before)
      expect(pieceOf(ada, piece)?.statusLine?.on).toBeUndefined()
    })

    it('a piece that has ended', () =>
      refusedFor({}, 'which has ended: say what the piece waits on now', async (_ada, brobot) => {
        const other = await aPieceGiven(brobot, 'Write the copy', false)
        await ok(agentToolsFor(host, brobot), 'update_work', { piece: other.label, close: true })
        await settle()
        return { on: { agent: other.label } }
      }))

    it('a time already past', () =>
      refusedFor({ on: { time: new Date(clock - 60_000).toISOString() } }, 'on.time is not ahead'))

    it('a time more than 30 days ahead', () =>
      refusedFor(
        { on: { time: new Date(clock + 31 * 24 * 3_600_000).toISOString() } },
        'on.time is more than 30 days ahead',
      ))

    it('a job or task that is not running in its conversation', () =>
      refusedFor(
        { on: { event: 'task_nobody_started' } },
        'on.event names no scheduled job or background task',
      ))
  })

  it('a piece neither the caller nor its holder may name gets the answer a label that names nothing gets', async () => {
    const { ada } = await aHelperWithAPiece()
    // Another person's conversation, of another profile, gives work to an agent of a third: none of
    // it is Ada's or her giver's to name.
    const { sessionId: stranger } = await host.createSession(
      { provider: 'claude', profileId: 'stranger', approvalMode: 'auto', cwd: root },
      window,
    )
    await settle()
    const theirs = await ok(agentToolsFor(host, stranger), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'outsider',
      new: true,
      title: 'Their work',
      brief: 'their work',
    })
    const theirLabel = theirs.label as string
    const said = async (agent: string): Promise<unknown> => (await waitsOn(ada, { agent })).detail
    const nothing = await said('W99.9')
    expect(JSON.stringify(nothing)).toContain(
      'on.agent names no open piece and no question you asked',
    )
    expect(await said(theirLabel)).toEqual(nothing)
    // Ended, it still says nothing about it.
    await ok(agentToolsFor(host, stranger), 'update_work', { piece: theirLabel, close: true })
    await settle()
    expect(await said(theirLabel)).toEqual(nothing)
  })

  describe('a mark from before a wait named its target is listed for the person', () => {
    beforeEach(() => {
      // Build historical rows before any reconciliation receipts exist; the next life reads them.
      ;(host as unknown as { workReconciler: { close(): void } }).workReconciler.close()
    })
    /**
     * A mark as the app wrote it before `on`: `waiting: true` and nothing it waits on. ⚑ Written
     * while Ada runs nothing, so no running life of hers numbers a row the same.
     */
    const anOldMark = async (ada: string, piece: string, by: string): Promise<number> => {
      await host.closeAll()
      await settle()
      const markedAt = clock++
      store.append(
        ada,
        store.nextOrdinal(ada),
        { type: 'work_status_set', piece, line: 'until the designs land', by, waiting: true },
        markedAt,
      )
      host = buildHost()
      await waitFor(
        () => host.workIncidentsForAPerson().rows.some((one) => one.piece === piece),
        'the historical wait ladder',
      )
      return markedAt
    }

    it('as a wait that needs classifying, with its holder and giver, until a line names its target', async () => {
      const { brobot, ada, piece } = await aHelperWithAPiece()
      const markedAt = await anOldMark(ada, piece, brobot)
      expect(pieceOf(ada, piece)?.state).toBe('waiting-on-purpose')
      expect(host.workIncidentsForAPerson().rows).toEqual([
        {
          piece,
          label: 'W1.1',
          title: 'Build the pages',
          holder: ada,
          holderName: 'Ada',
          giver: brobot,
          giverName: host.whatToCallTheConversation(brobot),
          kind: 'wait-needs-classification',
          since: markedAt,
          told: { holder: expect.any(Number), giver: expect.any(Number) },
        },
      ])
      // A line that says what the piece waits on takes it off the list.
      expect(await waitsOn(ada, { time: anHourAhead() })).toMatchObject({ outcome: 'ok' })
      expect(host.workIncidentsForAPerson().rows).toEqual([])
    })

    it('and not once the piece has ended', async () => {
      const { brobot, ada, piece } = await aHelperWithAPiece()
      await anOldMark(ada, piece, brobot)
      expect(host.workIncidentsForAPerson().rows).toHaveLength(1)
      await ok(agentToolsFor(host, brobot), 'update_work', { piece: 'W1.1', close: true })
      await settle()
      expect(host.workIncidentsForAPerson().rows).toEqual([])
    })

    it('and a wait that names its target is no incident', async () => {
      const { ada } = await aHelperWithAPiece()
      expect(await waitsOn(ada, { time: anHourAhead() })).toMatchObject({ outcome: 'ok' })
      expect(host.workIncidentsForAPerson().rows).toEqual([])
    })
  })
})
