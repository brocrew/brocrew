import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { PieceRow } from '../src/shared/tasks'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * A to-do for a person.
 *
 * A helper (Ada) asks the person to do something only they can do, with `request_action`: it is
 * in their queue as a to-do, with its files kept for the piece, and the piece can wait on it. The
 * person answers Done or Can't do it, with a note, through their window, and Ada is told once,
 * in words that say what the person did. A request that is no to-do is not answered this way.
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

/** While set, every resume waits for it: the conversation stays starting until it settles. */
let resumesWait: Promise<void> | null = null
/** How many resumes have been asked for. */
let resumesAsked = 0

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
    resumesAsked++
    if (resumesWait !== null) await resumesWait
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

describe('a to-do for a person', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-to-do-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-to-do-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_800_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    const issued = new FakeProviderSessions()
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
      endingWaitMs: 1_000,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      statesMoved: () => undefined,
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    resumesWait = null
    resumesAsked = 0
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

  /** Words this app put in front of Ada: delivered, or held for her next turn. */
  const toldAda = (ada: string): string[] =>
    store
      .events(ada)
      .map((entry) => entry.event)
      .flatMap((event) =>
        event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
      )
  const aToDo = async (
    ada: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    call(agentToolsFor(host, ada), 'request_action', { piece: 'W1.1', ...args })

  it('is in the person’s queue as a to-do, with its files kept for the piece, and the piece can wait on it', async () => {
    const { ada, piece } = await aHelperWithAPiece()
    const folder = store.recordedOne(ada)?.cwd
    if (folder === undefined) throw new Error('Ada has no folder')
    writeFileSync(join(folder, 'steps.md'), '# Steps\n\nSign in, then press Allow.\n')
    const asked = await aToDo(ada, {
      action: 'Sign in to the store and press Allow on the new app.',
      resources: ['steps.md'],
    })
    expect(asked, JSON.stringify(asked)).toMatchObject({ outcome: 'ok' })
    const id = asked.question as string
    const [kept] = store.resourcesOf(piece)
    expect(kept).toMatchObject({ name: 'steps.md', role: 'made' })
    const row = host.questionsForAPerson().rows.find((one) => one.request.requestId === id)
    expect(row?.action).toEqual({
      text: 'Sign in to the store and press Allow on the new app.',
      files: [{ resource: kept?.resource, name: 'steps.md' }],
    })
    // The piece waits on it, by the id the tool returned.
    expect(await waitsOn(ada, { person: id })).toMatchObject({ outcome: 'ok' })
    expect(pieceOf(ada, piece)?.statusLine?.on).toEqual({ kind: 'person', request: id })
  })

  it('Done tells the helper once that the person did it; a second answer is refused and tells nobody', async () => {
    const { ada } = await aHelperWithAPiece()
    const asked = await aToDo(ada, { action: 'Press Allow on the new app.' })
    const id = asked.question as string
    expect(await host.answerAction(ada, id, true, null, window)).toMatchObject({ outcome: 'taken' })
    await waitFor(
      () => toldAda(ada).some((text) => text.startsWith('A person did what you asked them to do')),
      'Ada to be told',
    )
    const told = toldAda(ada).filter((text) => text.includes(id))
    expect(told).toHaveLength(1)
    expect(told[0]).toBe(
      `A person did what you asked them to do about W1.1, quoting ${id}.\n\nYou asked: Press Allow on the new app.`,
    )
    expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).not.toContain(id)
    expect(await host.answerAction(ada, id, false, 'too late', window)).toMatchObject({
      outcome: 'refused',
    })
    await settle()
    expect(toldAda(ada).filter((text) => text.includes(id))).toHaveLength(1)
  })

  it('Can’t do it tells the helper so, with the person’s note', async () => {
    const { ada } = await aHelperWithAPiece()
    const asked = await aToDo(ada, { action: 'Press Allow on the new app.' })
    const id = asked.question as string
    expect(
      await host.answerAction(ada, id, false, 'I have no account there.', window),
    ).toMatchObject({ outcome: 'taken' })
    await waitFor(() => toldAda(ada).some((text) => text.includes(id)), 'Ada to be told')
    expect(toldAda(ada).find((text) => text.includes(id))).toBe(
      `A person could not do what you asked them to do about W1.1, quoting ${id}.\n\nYou asked: Press Allow on the new app.\n\nTheir note: I have no account there.`,
    )
  })

  it('a question that is no to-do is not answered as one', async () => {
    const { ada } = await aHelperWithAPiece()
    const id = await asks(ada, 'a-person')
    expect(await host.answerAction(ada, id, true, null, window)).toMatchObject({
      outcome: 'refused',
      stillOpen: false,
    })
    expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(id)
    expect(
      host.questionsForAPerson().rows.find((one) => one.request.requestId === id),
    ).not.toHaveProperty('action')
  })

  it('refuses a to-do that says nothing, or names no piece the helper holds', async () => {
    const { ada } = await aHelperWithAPiece()
    const blank = await aToDo(ada, { action: '   ' })
    expect(blank.outcome, JSON.stringify(blank)).toBe('refused')
    expect(JSON.stringify(blank.detail)).toContain('action must say what to do')
    const elsewhere = await aToDo(ada, { piece: 'W9.9', action: 'Press Allow.' })
    expect(elsewhere.outcome, JSON.stringify(elsewhere)).toBe('refused')
    expect(host.questionsForAPerson().rows).toEqual([])
  })

  it('the listed row names the agent a wait on an agent is on', async () => {
    const { brobot, ada } = await aHelperWithAPiece()
    const other = await aPieceGiven(brobot, 'Write the copy', false)
    const listedAda = () =>
      [...host.resumableSessions(), ...host.unresumableSessions()].find(
        (one) => one.sessionId === ada,
      )
    // The row reads its newest open piece, W1.2: it waits on W1.1, which Ada holds.
    const theNewest = (on: Record<string, unknown>) =>
      call(agentToolsFor(host, ada), 'update_work', { piece: other.label, status: 'waiting', on })
    expect(await theNewest({ agent: 'W1.1' })).toMatchObject({ outcome: 'ok' })
    expect(listedAda()?.waitingOnPurpose).toMatchObject({ label: other.label, agentName: 'Ada' })
    const ofItsGiver = await asks(ada, 'the-parent')
    expect(await theNewest({ agent: ofItsGiver })).toMatchObject({ outcome: 'ok' })
    expect(listedAda()?.waitingOnPurpose).toMatchObject({
      agentName: host.whatToCallTheConversation(brobot),
    })
  })

  it('its giver may answer it for the person, and the helper reads that its giver answered, by name', async () => {
    const { brobot, ada } = await aHelperWithAPiece()
    const asked = await aToDo(ada, { action: 'Press Allow on the new app.' })
    const id = asked.question as string
    // Its giver sees it as it sees a question routed to a person.
    const listed = await call(agentToolsFor(host, brobot), 'list_questions', {})
    expect(JSON.stringify(listed)).toContain(id)
    const relayed = await call(agentToolsFor(host, brobot), 'answer_question', {
      question: id,
      asked_by: ada,
      answers: [{ part: 'answer', answer: ['Done'] }],
    })
    expect(relayed, JSON.stringify(relayed)).toMatchObject({ outcome: 'ok' })
    await waitFor(() => toldAda(ada).some((text) => text.includes(id)), 'Ada to be told')
    const told = toldAda(ada).filter((text) => text.includes(id))
    expect(told).toHaveLength(1)
    expect(told[0]).toBe(
      `${host.nameByItsWorkUnder(brobot, store.piecesOwnedBy(ada)[0]?.piece ?? null)} answered for the person about W1.1: done, quoting ${id}.\n\nYou asked: Press Allow on the new app.`,
    )
    expect(told[0]).not.toContain('A person')
    // Its card closes as a question's does, and the person's answer after it is refused.
    expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).not.toContain(id)
    expect(await host.answerAction(ada, id, true, null, window)).toMatchObject({
      outcome: 'refused',
    })
  })

  it('a to-do and a question about a piece end when its holder hands the piece back, and the person’s answer then tells nobody', async () => {
    const { ada } = await aHelperWithAPiece()
    const asked = await aToDo(ada, { action: 'Press Allow on the new app.' })
    const toDo = asked.question as string
    const question = await asks(ada, 'a-person')
    const queued = () => host.questionsForAPerson().rows.map((one) => one.request.requestId)
    expect(queued()).toEqual(expect.arrayContaining([toDo, question]))
    const replied = await call(agentToolsFor(host, ada), 'reply_to_parent', {
      piece: 'W1.1',
      outcome: 'done',
      summary: 'Finished another way.',
    })
    expect(replied, JSON.stringify(replied)).toMatchObject({ outcome: 'ok' })
    await settle()
    expect(queued()).not.toContain(toDo)
    expect(queued()).not.toContain(question)
    const late = await host.answerAction(ada, toDo, true, null, window)
    expect(late).toEqual({
      outcome: 'refused',
      reason: 'The work that question was about was handed back, so your answer was not sent.',
      stillOpen: false,
    })
    await settle()
    expect(toldAda(ada).filter((text) => text.includes(toDo))).toEqual([])
  })

  it('the listed row names the agent a wait its giver set on its own question is on', async () => {
    const { brobot, ada } = await aHelperWithAPiece()
    const gave = await ok(agentToolsFor(host, brobot), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'writer',
      new: true,
      title: 'Write the copy',
      brief: 'write the copy',
    })
    const bea = gave.agent as string
    await waitFor(
      () => store.piecesOwnedBy(bea).some((one) => one.state === 'stalled'),
      'the writer’s brief to end',
    )
    const ofBea = await ok(agentToolsFor(host, brobot), 'ask_question', {
      question: 'which tone?',
      who_answers: 'an-agent',
      agent: bea,
    })
    const id = ofBea.question as string
    expect(
      await call(agentToolsFor(host, brobot), 'update_work', {
        piece: 'W1.1',
        status: 'waiting on the tone',
        on: { agent: id },
      }),
    ).toMatchObject({ outcome: 'ok' })
    const row = [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (one) => one.sessionId === ada,
    )
    expect(row?.waitingOnPurpose).toMatchObject({
      label: 'W1.1',
      on: { kind: 'agent', request: id },
      agentName: host.whatToCallTheConversation(bea),
    })
  })

  describe('a question passed up ends with the piece the question it carries is about', () => {
    /** Ada asks BroBot about W1.1, and BroBot passes it up to the person. */
    const passedUpToThePerson = async (): Promise<{
      brobot: string
      ada: string
      asked: string
      passedUp: string
    }> => {
      const { brobot, ada } = await aHelperWithAPiece()
      const asked = await asks(ada, 'the-parent')
      const passed = await ok(agentToolsFor(host, brobot), 'pass_question_up', {
        question: asked,
        asked_by: ada,
        who_answers: 'a-person',
      })
      const passedUp = passed.question as string
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
        passedUp,
      )
      return { brobot, ada, asked, passedUp }
    }
    const stateOf = (askedBy: string, requestId: string): string | undefined =>
      store.routedRequestsOf(askedBy).find((one) => one.requestId === requestId)?.state
    /** The person takes the conversation over and stops it. */
    const stopped = async (conversation: string): Promise<void> => {
      await host.look(conversation, window, true)
      await host.close(conversation, window)
      await settle()
    }
    /** The store refuses to write a row of this type from now on. */
    const failsToWrite = (type: string): void => {
      const append = store.append.bind(store)
      store.append = (sessionId, ordinal, event, at) => {
        if (event.type === type) throw new Error('the disk is full')
        append(sessionId, ordinal, event, at)
      }
    }
    /** The row in its owner's ledger that ends a piece, by how it ended. */
    const ENDS_THE_PIECE = {
      'work-replied': 'work_replied',
      'work-withdrawn': 'work_taken_back',
      'work-closed': 'work_closed',
    } as const

    for (const [how, ending, said, end] of [
      [
        'handed back',
        'work-replied',
        'The work that question was about was handed back, so your answer was not sent.',
        (ada: string) =>
          call(agentToolsFor(host, ada), 'reply_to_parent', {
            piece: 'W1.1',
            outcome: 'done',
            summary: 'Finished another way.',
          }),
      ],
      [
        'taken back',
        'work-withdrawn',
        'The work that question was about was taken back, so your answer was not sent.',
        (_ada: string, brobot: string) =>
          call(agentToolsFor(host, brobot), 'withdraw_task', { piece: 'W1.1' }),
      ],
      [
        'closed',
        'work-closed',
        'The work that question was about was closed by the one that gave it, so your answer was not sent.',
        (_ada: string, brobot: string) =>
          call(agentToolsFor(host, brobot), 'update_work', { piece: 'W1.1', close: true }),
      ],
    ] as const) {
      it(`when the piece is ${how}, both questions end, the queue drops it, and the person’s answer is refused`, async () => {
        const { brobot, ada, asked, passedUp } = await passedUpToThePerson()
        expect(await end(ada, brobot)).toMatchObject({ outcome: 'ok' })
        await settle()
        // The conversation that passed it up goes on being recorded after the row.
        await host.send(brobot, 'What next?', window)
        await settle()
        expect(
          store
            .events(brobot)
            .some((entry) => entry.event.type === 'user_turn' && entry.event.text === 'What next?'),
        ).toBe(true)
        expect(stateOf(ada, asked)).toBe(ending)
        expect(stateOf(brobot, passedUp)).toBe(ending)
        // The Events tab says how its work ended.
        const itsRow = store
          .events(brobot)
          .find((entry) => entry.event.type === 'question_ended_with_its_piece')?.event
        expect(itsRow === undefined ? null : describeEvent(itsRow)).toBe(
          `${passedUp} · ended: its work was ${how}`,
        )
        expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).not.toContain(
          passedUp,
        )
        expect(
          await host.respondUserInput(
            brobot,
            passedUp,
            { kind: 'answer', answers: { answer: 'the home page' } },
            window,
          ),
        ).toEqual({ outcome: 'refused', reason: said, stillOpen: false })
      })

      for (const [which, failing] of [
        ['a copy that cannot be ended', 'question_ended_with_its_piece'],
        ['a piece that cannot be ended', ENDS_THE_PIECE[ending]],
      ] as const) {
        it(`when the piece is ${how}, its row and the copy’s are one transaction: ${which} ends neither`, async () => {
          const { brobot, ada, asked, passedUp } = await passedUpToThePerson()
          failsToWrite(failing)
          await end(ada, brobot)
          await settle()
          expect(
            store.events(ada).filter((entry) => entry.event.type === ENDS_THE_PIECE[ending]),
          ).toEqual([])
          expect([stateOf(ada, asked), stateOf(brobot, passedUp)]).toEqual(['open', 'open'])
          expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
            passedUp,
          )
        })
      }
    }

    it('ends the copies with the piece of an owner nothing runs, in the same transaction', async () => {
      const { brobot, ada, asked, passedUp } = await passedUpToThePerson()
      await stopped(ada)
      await ok(agentToolsFor(host, brobot), 'withdraw_task', { piece: 'W1.1' })
      await settle()
      expect([stateOf(ada, asked), stateOf(brobot, passedUp)]).toEqual([
        'work-withdrawn',
        'work-withdrawn',
      ])
    })

    it('…and when the copy cannot be ended, ends neither', async () => {
      const { brobot, ada, asked, passedUp } = await passedUpToThePerson()
      await stopped(ada)
      failsToWrite('question_ended_with_its_piece')
      await call(agentToolsFor(host, brobot), 'withdraw_task', { piece: 'W1.1' })
      await settle()
      expect(store.events(ada).filter((entry) => entry.event.type === 'work_taken_back')).toEqual(
        [],
      )
      expect([stateOf(ada, asked), stateOf(brobot, passedUp)]).toEqual(['open', 'open'])
    })

    /**
     * Ada gives part of W1.1 to Bea; Bea asks Ada about it, Ada passes it up to BroBot, and BroBot
     * to the person.
     */
    const aChainOfTwoPassers = async (): Promise<{
      brobot: string
      ada: string
      bea: string
      label: string
      original: string
      copy: string
      copyOfTheCopy: string
    }> => {
      const { brobot, ada } = await aHelperWithAPiece()
      const gave = await ok(agentToolsFor(host, ada), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'writer',
        new: true,
        title: 'Write the copy',
        brief: 'write the copy',
      })
      const bea = gave.agent as string
      const label = gave.label as string
      await waitFor(
        () => store.piecesOwnedBy(bea).some((one) => one.state === 'stalled'),
        'the writer’s brief to end',
      )
      const asked = await ok(agentToolsFor(host, bea), 'ask_question', {
        piece: label,
        question: 'which tone?',
        who_answers: 'the-parent',
      })
      const original = asked.question as string
      const once = await ok(agentToolsFor(host, ada), 'pass_question_up', {
        question: original,
        asked_by: bea,
        who_answers: 'the-parent',
      })
      const copy = once.question as string
      const twice = await ok(agentToolsFor(host, brobot), 'pass_question_up', {
        question: copy,
        asked_by: ada,
        who_answers: 'a-person',
      })
      const copyOfTheCopy = twice.question as string
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
        copyOfTheCopy,
      )
      return { brobot, ada, bea, label, original, copy, copyOfTheCopy }
    }
    /** How each ending is asked for in the chain: Bea hands it back, or Ada takes it back or closes it. */
    const IN_THE_CHAIN = [
      [
        'handed back',
        'work-replied',
        (bea: string, _ada: string, label: string) =>
          call(agentToolsFor(host, bea), 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'Written.',
          }),
      ],
      [
        'taken back',
        'work-withdrawn',
        (_bea: string, ada: string, label: string) =>
          call(agentToolsFor(host, ada), 'withdraw_task', { piece: label }),
      ],
      [
        'closed',
        'work-closed',
        (_bea: string, ada: string, label: string) =>
          call(agentToolsFor(host, ada), 'update_work', { piece: label, close: true }),
      ],
    ] as const

    it('ends each copy up a longer chain when the piece is handed back', async () => {
      const { brobot, ada, bea, label, original, copy, copyOfTheCopy } = await aChainOfTwoPassers()
      await ok(agentToolsFor(host, bea), 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'Written.',
      })
      await settle()
      expect([stateOf(bea, original), stateOf(ada, copy), stateOf(brobot, copyOfTheCopy)]).toEqual([
        'work-replied',
        'work-replied',
        'work-replied',
      ])
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).not.toContain(
        copyOfTheCopy,
      )
    })

    for (const [how, ending, end] of IN_THE_CHAIN) {
      it(`when the piece is ${how} while a conversation that passed it up is starting, waits for that start and ends every copy in the same transaction`, async () => {
        const { brobot, ada, bea, label, original, copy, copyOfTheCopy } =
          await aChainOfTwoPassers()
        await stopped(brobot)
        let letItStart = (): void => {}
        resumesWait = new Promise<void>((resolve) => (letItStart = resolve))
        const asked = resumesAsked
        const starting = host.send(brobot, 'Carry on.', window)
        await waitFor(() => resumesAsked > asked, 'BroBot’s start to be under way')
        let ended = false
        const answered = end(bea, ada, label).then((answer) => {
          ended = true
          return answer
        })
        await settle()
        // Nothing ends while it waits: the copy in BroBot's ledger could not be written yet.
        expect(ended).toBe(false)
        expect([
          stateOf(bea, original),
          stateOf(ada, copy),
          stateOf(brobot, copyOfTheCopy),
        ]).toEqual(['open', 'open', 'open'])
        letItStart()
        await starting
        expect(await answered).toMatchObject({ outcome: 'ok' })
        await settle()
        expect([
          stateOf(bea, original),
          stateOf(ada, copy),
          stateOf(brobot, copyOfTheCopy),
        ]).toEqual([ending, ending, ending])
        // …written into its ledger once its start had landed, which goes on being recorded.
        const kinds = store.events(brobot).map((entry) => entry.event.type)
        expect(kinds.lastIndexOf('launched')).toBeLessThan(
          kinds.indexOf('question_ended_with_its_piece'),
        )
        await host.send(brobot, 'What next?', window)
        await settle()
        expect(
          store
            .events(brobot)
            .some((entry) => entry.event.type === 'user_turn' && entry.event.text === 'What next?'),
        ).toBe(true)
        expect(
          (
            await host.respondUserInput(
              brobot,
              copyOfTheCopy,
              { kind: 'answer', answers: { answer: 'a warm tone' } },
              window,
            )
          ).outcome,
        ).toBe('refused')
      })
    }

    for (const [how, ending, end] of IN_THE_CHAIN) {
      it(`when the piece is ${how} while a conversation that passed it up stays starting, nothing ends and the same call ends it once it has started`, async () => {
        const { brobot, ada, bea, label, original, copy, copyOfTheCopy } =
          await aChainOfTwoPassers()
        await stopped(brobot)
        let letItStart = (): void => {}
        resumesWait = new Promise<void>((resolve) => (letItStart = resolve))
        const asked = resumesAsked
        const starting = host.send(brobot, 'Carry on.', window)
        await waitFor(() => resumesAsked > asked, 'BroBot’s start to be under way')
        expect(await end(bea, ada, label)).toMatchObject({
          outcome: 'refused',
          rail: 'a-conversation-with-its-questions-is-starting',
          retryable: true,
          remedy: 'make-the-same-call-when-this-settles',
          reason: `${label} wasn't ${how}: a conversation with a question about it is still starting. Try again in a moment.`,
        })
        expect(
          store.events(bea).filter((entry) => entry.event.type === ENDS_THE_PIECE[ending]),
        ).toEqual([])
        expect([
          stateOf(bea, original),
          stateOf(ada, copy),
          stateOf(brobot, copyOfTheCopy),
        ]).toEqual(['open', 'open', 'open'])
        letItStart()
        await starting
        expect(await end(bea, ada, label)).toMatchObject({ outcome: 'ok' })
        await settle()
        expect([
          stateOf(bea, original),
          stateOf(ada, copy),
          stateOf(brobot, copyOfTheCopy),
        ]).toEqual([ending, ending, ending])
      })
    }

    it('a close it refuses writes none of the call: no status line', async () => {
      const { brobot, ada, bea, label, copyOfTheCopy } = await aChainOfTwoPassers()
      const raised = store.questionsRaisedIn.bind(store)
      store.questionsRaisedIn = (sessionId, unread) => {
        if (sessionId === brobot) throw new Error('the disk could not be read')
        return raised(sessionId, unread)
      }
      expect(
        await call(agentToolsFor(host, ada), 'update_work', {
          piece: label,
          status: 'no longer needed',
          close: true,
        }),
      ).toMatchObject({ outcome: 'refused', rail: 'its-questions-could-not-all-be-read' })
      store.questionsRaisedIn = raised
      const kinds = store.events(bea).map((entry) => entry.event.type)
      expect(kinds).not.toContain('work_status_set')
      expect(kinds).not.toContain('work_closed')
      expect(stateOf(brobot, copyOfTheCopy)).toBe('open')
    })

    for (const [how, ending, end] of IN_THE_CHAIN) {
      it(`when the piece is ${how} and the copy in between is no well-formed question, nothing ends; restored, the same call ends all three`, async () => {
        const { brobot, ada, bea, label, original, copy, copyOfTheCopy } =
          await aChainOfTwoPassers()
        // Ada's copy loses its prompt; its row is still JSON. A note from BroBot grows Ada's record,
        // so what was read of it before is read again.
        const row = db
          .prepare(
            `SELECT id, payload FROM events WHERE session_id = ? AND type = 'question_asked'
               AND json_extract(payload, '$.requestId') = ?`,
          )
          .get(ada, copy) as { id: string; payload: string }
        const aNote = async (): Promise<void> => {
          await ok(agentToolsFor(host, brobot), 'message_agent', {
            agent: ada,
            kind: 'note',
            text: 'A note.',
          })
          await settle()
        }
        db.prepare(`UPDATE events SET payload = json_remove(payload, '$.prompt') WHERE id = ?`).run(
          row.id,
        )
        await aNote()
        expect(await end(bea, ada, label)).toMatchObject({
          outcome: 'refused',
          rail: 'its-questions-could-not-all-be-read',
          retryable: true,
          reason: `${label} wasn't ${how}: its questions couldn't all be read. Try again; if it fails again, ask a person.`,
        })
        await settle()
        expect(
          store.events(bea).filter((entry) => entry.event.type === ENDS_THE_PIECE[ending]),
        ).toEqual([])
        expect(store.piecesOwnedBy(bea).every((piece) => piece.state !== 'answered')).toBe(true)
        expect([
          stateOf(bea, original),
          stateOf(ada, copy),
          stateOf(brobot, copyOfTheCopy),
        ]).toEqual(['open', 'open', 'open'])
        expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
          copyOfTheCopy,
        )
        db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
        await aNote()
        expect(await end(bea, ada, label)).toMatchObject({ outcome: 'ok' })
        await settle()
        expect([
          stateOf(bea, original),
          stateOf(ada, copy),
          stateOf(brobot, copyOfTheCopy),
        ]).toEqual([ending, ending, ending])
      })
    }

    /** Ada's routing of her copy, as stored, and a note that grows her record so it is read again. */
    const adasRouting = (
      ada: string,
      brobot: string,
      copy: string,
    ): { readonly id: string; readonly payload: string; readonly reread: () => Promise<void> } => {
      const row = db
        .prepare(
          `SELECT id, payload FROM events WHERE session_id = ? AND type = 'request_routed'
             AND json_extract(payload, '$.requestId') = ?`,
        )
        .get(ada, copy) as { id: string; payload: string }
      return {
        ...row,
        reread: async () => {
          await ok(agentToolsFor(host, brobot), 'message_agent', {
            agent: ada,
            kind: 'note',
            text: 'A note.',
          })
          await settle()
        },
      }
    }
    const endedCopies = (conversation: string): number =>
      store
        .events(conversation)
        .filter((entry) => entry.event.type === 'question_ended_with_its_piece').length

    for (const [how, ending, end] of IN_THE_CHAIN) {
      it(`when the piece is ${how} and the routing of the copy in between names nobody it went to, nothing ends; restored, the same call ends all three`, async () => {
        const { brobot, ada, bea, label, original, copy, copyOfTheCopy } =
          await aChainOfTwoPassers()
        // Ada's routing of her copy loses its parent; its row is still JSON, and every question row
        // is whole.
        const routing = adasRouting(ada, brobot, copy)
        db.prepare(`UPDATE events SET payload = json_remove(payload, '$.parent') WHERE id = ?`).run(
          routing.id,
        )
        await routing.reread()
        expect(await end(bea, ada, label)).toMatchObject({
          outcome: 'refused',
          rail: 'its-questions-could-not-all-be-read',
          retryable: true,
          reason: `${label} wasn't ${how}: its questions couldn't all be read. Try again; if it fails again, ask a person.`,
        })
        await settle()
        expect(
          store.events(bea).filter((entry) => entry.event.type === ENDS_THE_PIECE[ending]),
        ).toEqual([])
        expect([endedCopies(ada), endedCopies(brobot)]).toEqual([0, 0])
        expect([stateOf(bea, original), stateOf(brobot, copyOfTheCopy)]).toEqual(['open', 'open'])
        expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
          copyOfTheCopy,
        )
        db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(routing.payload, routing.id)
        await routing.reread()
        expect(await end(bea, ada, label)).toMatchObject({ outcome: 'ok' })
        await settle()
        expect([
          stateOf(bea, original),
          stateOf(ada, copy),
          stateOf(brobot, copyOfTheCopy),
        ]).toEqual([ending, ending, ending])
      })
    }

    it('a question addressed to a person whose routing lost who gave the work still ends with every copy of it', async () => {
      const { brobot, ada } = await aHelperWithAPiece()
      const gave = await ok(agentToolsFor(host, ada), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'writer',
        new: true,
        title: 'Write the copy',
        brief: 'write the copy',
      })
      const bea = gave.agent as string
      const label = gave.label as string
      await waitFor(
        () => store.piecesOwnedBy(bea).some((one) => one.state === 'stalled'),
        'the writer’s brief to end',
      )
      // Bea asks the person; Ada, who gave the work, passes it to BroBot, and BroBot to the person.
      const asked = await ok(agentToolsFor(host, bea), 'ask_question', {
        piece: label,
        question: 'which tone?',
        who_answers: 'a-person',
      })
      const original = asked.question as string
      const once = await ok(agentToolsFor(host, ada), 'pass_question_up', {
        question: original,
        asked_by: bea,
        who_answers: 'the-parent',
      })
      const copy = once.question as string
      const twice = await ok(agentToolsFor(host, brobot), 'pass_question_up', {
        question: copy,
        asked_by: ada,
        who_answers: 'a-person',
      })
      const copyOfTheCopy = twice.question as string
      // Bea's routing loses who gave the work. Still a well-formed routing to a person: a question
      // raised where nobody gave the work names nobody.
      db.prepare(
        `UPDATE events SET payload = json_remove(payload, '$.parent')
          WHERE session_id = ? AND type = 'request_routed' AND json_extract(payload, '$.requestId') = ?`,
      ).run(bea, original)
      await ok(agentToolsFor(host, ada), 'message_agent', {
        agent: bea,
        kind: 'note',
        text: 'A note.',
      })
      await settle()
      expect(
        await call(agentToolsFor(host, bea), 'reply_to_parent', {
          piece: label,
          outcome: 'done',
          summary: 'Written.',
        }),
      ).toMatchObject({ outcome: 'ok' })
      await settle()
      expect([stateOf(bea, original), stateOf(ada, copy), stateOf(brobot, copyOfTheCopy)]).toEqual([
        'work-replied',
        'work-replied',
        'work-replied',
      ])
    })

    for (const [what, damage] of [
      ['the conversation it went to is named by a number', `json_set(payload, '$.parent', 7)`],
      ['it went nowhere a routing goes', `json_set(payload, '$.to', 'somebody')`],
      ['its request is named by a number', `json_set(payload, '$.requestId', 7)`],
      ['the refusal it carries is no words', `json_set(payload, '$.because', 7)`],
    ] as const) {
      it(`when the piece is handed back and the routing of the copy in between is no well-formed routing — ${what} — nothing ends`, async () => {
        const { brobot, ada, bea, label, original, copy, copyOfTheCopy } =
          await aChainOfTwoPassers()
        const routing = adasRouting(ada, brobot, copy)
        db.prepare(`UPDATE events SET payload = ${damage} WHERE id = ?`).run(routing.id)
        await routing.reread()
        expect(
          await call(agentToolsFor(host, bea), 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'Written.',
          }),
        ).toMatchObject({ outcome: 'refused', rail: 'its-questions-could-not-all-be-read' })
        expect([endedCopies(ada), endedCopies(brobot)]).toEqual([0, 0])
        expect([stateOf(bea, original), stateOf(brobot, copyOfTheCopy)]).toEqual(['open', 'open'])
      })
    }

    for (const [what, whose, damage] of [
      [
        'its prompt is no text',
        'ada',
        `json_set(payload, '$.prompt', json('{"words":"which tone?"}'))`,
      ],
      [
        'the question it carries is named by a number',
        'ada',
        `json_set(payload, '$.passedUpFrom', 7)`,
      ],
      ['its questions are no list', 'ada', `json_set(payload, '$.questions', 'which tone?')`],
      [
        'its questions are a list written as words',
        'ada',
        `json_set(payload, '$.questions', '[]')`,
      ],
      [
        'its questions are not questions',
        'ada',
        `json_set(payload, '$.questions', json('[{"id":1}]'))`,
      ],
      ['it is named by a number', 'ada', `json_set(payload, '$.requestId', 7)`],
      [
        'it offers a move that is no move',
        'ada',
        `json_set(payload, '$.move', json('{"to":"W9"}'))`,
      ],
      [
        'it asks for a to-do that is none',
        'ada',
        `json_set(payload, '$.action', json('{"files":"none"}'))`,
      ],
      ['the piece it is about is named by a number', 'bea', `json_set(payload, '$.piece', 7)`],
    ] as const) {
      it(`when the piece is handed back and a question on its chain is no well-formed question — ${what} — nothing ends`, async () => {
        const chain = await aChainOfTwoPassers()
        const { brobot, ada, bea, label, original, copy, copyOfTheCopy } = chain
        db.prepare(
          `UPDATE events SET payload = ${damage} WHERE session_id = ? AND type = 'question_asked'
             AND json_extract(payload, '$.requestId') = ?`,
        ).run(chain[whose], whose === 'ada' ? copy : original)
        // A note from its giver grows the damaged record, so it is read again.
        await ok(agentToolsFor(host, whose === 'ada' ? brobot : ada), 'message_agent', {
          agent: chain[whose],
          kind: 'note',
          text: 'A note.',
        })
        await settle()
        expect(
          await call(agentToolsFor(host, bea), 'reply_to_parent', {
            piece: label,
            outcome: 'done',
            summary: 'Written.',
          }),
        ).toMatchObject({ outcome: 'refused', rail: 'its-questions-could-not-all-be-read' })
        expect(store.events(bea).filter((entry) => entry.event.type === 'work_replied')).toEqual([])
        expect(stateOf(brobot, copyOfTheCopy)).toBe('open')
        if (whose === 'ada')
          expect([stateOf(bea, original), stateOf(ada, copy)]).toEqual(['open', 'open'])
      })
    }

    it('a hand-back whose main document it does not list is refused at once, with no wait for a start', async () => {
      const { brobot, bea, label } = await aChainOfTwoPassers()
      await stopped(brobot)
      let letItStart = (): void => {}
      resumesWait = new Promise<void>((resolve) => (letItStart = resolve))
      const asked = resumesAsked
      const starting = host.send(brobot, 'Carry on.', window)
      await waitFor(() => resumesAsked > asked, 'BroBot’s start to be under way')
      try {
        let answer: Record<string, unknown> | null = null
        void call(agentToolsFor(host, bea), 'reply_to_parent', {
          piece: label,
          outcome: 'done',
          summary: 'Written.',
          result_document: 'not-listed.md',
        }).then((said) => (answer = said))
        await settle()
        // Answered well inside one wait for a start, which is a second here.
        expect(answer).toMatchObject({ outcome: 'refused', rail: 'result-document-not-returned' })
      } finally {
        letItStart()
      }
      await starting
    })

    it('when a row of a conversation that passed it up cannot be read, nothing ends', async () => {
      const { brobot, ada, bea, label, original, copy, copyOfTheCopy } = await aChainOfTwoPassers()
      const raised = store.questionsRaisedIn.bind(store)
      store.questionsRaisedIn = (sessionId, unread) => {
        const read = raised(sessionId, unread)
        // As the store notes a row it could not read, and reads on.
        if (sessionId === brobot) unread?.in(sessionId)(0)
        return read
      }
      expect(
        await call(agentToolsFor(host, bea), 'reply_to_parent', {
          piece: label,
          outcome: 'done',
          summary: 'Written.',
        }),
      ).toMatchObject({
        outcome: 'refused',
        rail: 'its-questions-could-not-all-be-read',
        reason: `${label} wasn't handed back: its questions couldn't all be read. Try again; if it fails again, ask a person.`,
      })
      store.questionsRaisedIn = raised
      expect([stateOf(bea, original), stateOf(ada, copy), stateOf(brobot, copyOfTheCopy)]).toEqual([
        'open',
        'open',
        'open',
      ])
    })

    for (const [how, ending, end] of IN_THE_CHAIN) {
      for (const [where, passer] of [
        ['the first conversation that passed it up', 'ada'],
        ['the second', 'brobot'],
      ] as const) {
        it(`when the piece is ${how} and ${where} cannot be read, nothing ends and the same call then ends it`, async () => {
          const chain = await aChainOfTwoPassers()
          const { brobot, ada, bea, label, original, copy, copyOfTheCopy } = chain
          const raised = store.questionsRaisedIn.bind(store)
          store.questionsRaisedIn = (sessionId, unread) => {
            if (sessionId === chain[passer]) throw new Error('the disk could not be read')
            return raised(sessionId, unread)
          }
          expect(await end(bea, ada, label)).toMatchObject({
            outcome: 'refused',
            rail: 'its-questions-could-not-all-be-read',
            retryable: true,
            remedy: 'make-the-same-call-when-this-settles',
            reason: `${label} wasn't ${how}: its questions couldn't all be read. Try again; if it fails again, ask a person.`,
          })
          store.questionsRaisedIn = raised
          await settle()
          expect(
            store.events(bea).filter((entry) => entry.event.type === ENDS_THE_PIECE[ending]),
          ).toEqual([])
          expect([
            stateOf(bea, original),
            stateOf(ada, copy),
            stateOf(brobot, copyOfTheCopy),
          ]).toEqual(['open', 'open', 'open'])
          expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toContain(
            copyOfTheCopy,
          )
          expect(await end(bea, ada, label)).toMatchObject({ outcome: 'ok' })
          await settle()
          expect([
            stateOf(bea, original),
            stateOf(ada, copy),
            stateOf(brobot, copyOfTheCopy),
          ]).toEqual([ending, ending, ending])
        })
      }
    }
  })
})
