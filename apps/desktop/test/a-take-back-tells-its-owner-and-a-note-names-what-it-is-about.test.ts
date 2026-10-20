import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import {
  aFollowUpOnAPieceYouGaveAnother,
  aFollowUpOnAPieceYouHold,
  aTakeBackOfAPieceYouHold,
  aTakeBackOfAPieceYouHoldThatEnded,
  aTakeBackOfYourOwnWork,
  agentToolsFor,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  agentName,
  type QuestionAskedEvent,
  type RequestRoutedEvent,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'

/**
 * # D-016 · a take-back tells its owner, and a note names what it is about
 *
 * This file pins the corners of three verbs that the wider files around them leave open, each one
 * a sentence a model reads and acts on:
 *
 * 1. `withdraw_task` tells the OWNER of the piece it took back (an app notice,
 *    `a-piece-taken-back`), and the notice is only true of the conversation that really held the
 *    piece. It says to stop and not to reply, and it lists the pieces the owner gave that are
 *    still open, and only those. A conversation that was replaced (its provider no longer had it)
 *    is not told, because the one in its place never held the piece, and the answer says so.
 * 2. `message_agent` names the piece it is about. A follow-up naming the sender's own root is
 *    refused by its own word (`that-is-your-own-work`), a note naming a name that is not the
 *    sender's to name is refused `no-piece-by-that-name`, and a note naming a real piece carries
 *    it into the answer and onto the sender's receipt. 🔴 **F086 · a note names a piece its sender
 *    holds once it has ended, as one it gave**; a follow-up still names only one it gave, and a
 *    piece neither held nor given — ended or not, a predecessor's included — is still refused.
 *    🔴 **F087 · a follow-up naming a piece its sender holds that has ended, or gave another agent,
 *    is refused saying so**, with the call that goes; only a name that is neither keeps the guess.
 *    🔴 **F088 · and the receiver is told which piece**: the line that says who sent it says what the
 *    message is about, by label and title, and how that piece ended — when the words go, a restart
 *    between included.
 *    🔴 **F089 · a take-back naming a piece its caller holds says what it is** — open, with the doors
 *    that take it; ended, with how, when and by whom; its root, with the person's — and a name that is
 *    none of the caller's keeps the word's own sentence.
 * 3. `ask_question` finds its piece among what the asker holds AND has received (D-022 · R4: a
 *    piece whose give still waits behind the asker's turn does not count, so one received is
 *    inferred): no name and several received is told to name one, no name and none held is told
 *    there is no piece, and a question about the giver of a conversation's own root goes to a
 *    person, never to a parent nobody gave.
 *
 * Real host, real SQLite ledger, real migrations, over `FakeRuntime`. The harness is
 * `taking-work-back.test.ts`'s, less its send gate, which no test here needs. Every refusal is
 * read beside the same call one fact over, admitted.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const waitFor = async (ready: () => boolean, what: string, tries = 300): Promise<void> => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
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

/** `FakeRuntime` with the toolset each launch was handed captured, so a test can act as that agent. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

type WordsInARow = TranscriptEvent & { type: 'user_turn' | 'message_queued'; text: string }

describe('D-016 · a take-back tells its owner, and a note names what it is about', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
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
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-takeback-notes-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-takeback-notes-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_200_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
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

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** The words a model reads, and the payload beside them. */
  const callWithWords = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const wordsIn = (sessionId: string): WordsInARow[] =>
    ledger(sessionId).filter(
      (event): event is WordsInARow =>
        event.type === 'user_turn' || event.type === 'message_queued',
    )

  /** The app notices a take-back wrote into one conversation. */
  const takeBackNoticesIn = (sessionId: string): WordsInARow[] =>
    wordsIn(sessionId).filter(
      (one) => (one as { appNotice?: string }).appNotice === 'a-piece-taken-back',
    )

  const theNoticeIn = async (sessionId: string): Promise<string> => {
    await waitFor(() => takeBackNoticesIn(sessionId).length > 0, 'the owner to be told')
    const told = takeBackNoticesIn(sessionId)[0]
    if (told === undefined) throw new Error('no take-back notice was written')
    return told.text
  }

  const sentBy = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).filter((event) => event.type === 'message_sent')

  const askedIn = (sessionId: string): QuestionAskedEvent[] =>
    ledger(sessionId).filter(
      (event): event is QuestionAskedEvent => event.type === 'question_asked',
    )

  const routedIn = (sessionId: string): RequestRoutedEvent[] =>
    ledger(sessionId).filter(
      (event): event is RequestRoutedEvent => event.type === 'request_routed',
    )

  const theOpenCard = (sessionId: string): string | null => {
    const rows = ledger(sessionId)
    const settled = new Set(
      rows
        .filter((event) => event.type === 'user_decision')
        .map((event) => (event as { requestId: string }).requestId),
    )
    const open = rows
      .filter((event) => event.type === 'permission_request')
      .map((event) => (event as { id: string }).id)
      .filter((id) => !settled.has(id))
    return open.at(-1) ?? null
  }

  const turnsOn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = turnsOn(sessionId)
    await waitFor(() => theOpenCard(sessionId) !== null, 'a permission card')
    const id = theOpenCard(sessionId)
    if (id === null) throw new Error('no open permission request on the ledger')
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(() => turnsOn(sessionId) > before, 'the turn to reach its own terminal')
  }

  const isIdle = (sessionId: string): boolean => {
    const last = ledger(sessionId)
      .filter((event) => event.type === 'status')
      .at(-1) as { state?: string } | undefined
    return last?.state === 'idle'
  }

  /** A give, answered `ok`, with the piece it wrote down. `under` names the giver's own piece. */
  const aGive = async (
    tools: AgentToolset,
    profile: string,
    title: string,
    under?: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
      ...(under === undefined ? {} : { piece: under }),
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /** A PM a person opened, and one worker it gave a piece to, whose first turn parks on a card. */
  const aPmAndItsWorker = async (
    title = 'the first piece',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
    label: string
  }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await aGive(pmTools, 'worker', title)
    return {
      pm,
      worker: given.agent,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      piece: given.piece,
      label: given.label,
    }
  }

  /** One piece, given and ANSWERED, and its worker let go idle: it holds nothing open. */
  const workAlreadyAnswered = async (): Promise<Awaited<ReturnType<typeof aPmAndItsWorker>>> => {
    const made = await aPmAndItsWorker('read the brief and report')
    const replied = await callOn(made.workerTools, 'reply_to_parent', {
      piece: made.label,
      outcome: 'done',
      summary: 'the brief is read',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    await letTheTurnFinish(made.worker)
    await waitFor(() => isIdle(made.worker), 'the worker to go idle')
    return made
  }

  /** The app's own Close: it stops the process and never ends the conversation (D-017). */
  const stop = async (sessionId: string): Promise<void> => {
    await host.close(sessionId, THE_APP_ITSELF)
    await waitFor(
      () =>
        ![...host.resumableSessions()].some(
          (row) => row.sessionId === sessionId && row.running !== 'not-running',
        ),
      'the conversation to be over',
    )
  }

  const openPiecesOf = (sessionId: string) =>
    store.piecesOwnedBy(sessionId).filter((one) => TASK_IS_OPEN[one.state])

  /** ⚑ **F088 · what a provider was handed**, whole — the double echoes each turn it is given. */
  const heardBy = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ')
        ? [event.text.slice('echo: '.length)]
        : [],
    )

  /** ⚑ The turn that carried these words, as its provider was handed it. */
  const theTurnCarrying = async (sessionId: string, words: string): Promise<string> => {
    await waitFor(() => heardBy(sessionId).some((one) => one.includes(words)), `"${words}"`)
    return heardBy(sessionId).find((one) => one.includes(words)) ?? ''
  }

  const nameOf = (profile: string): string => agentName(profile, store.agentIdentities())

  it('a piece taken back from a conversation that was replaced is not told to the one that took its place', async () => {
    const { pm, worker, pmTools, label } = await aPmAndItsWorker('the piece')

    // The paired positive first: a stopped owner that was NOT replaced is told, and its answer says so.
    await bringIdentityIntoBeing('helper')
    const second = await aGive(pmTools, 'helper', 'second piece')
    const helper = second.agent
    expect(helper).not.toBe(worker)
    await stop(helper)
    const backFromHelper = await callWithWords(pmTools, 'withdraw_task', { piece: second.label })
    expect(backFromHelper.structured.outcome, JSON.stringify(backFromHelper.structured)).toBe('ok')
    // ⚑ **D-022 · R3 — `sent`**: the notice went out as the helper's turn, and only then does the
    // answer say *told*. ⛔ The boolean it replaced is gone, not false.
    expect(backFromHelper.structured.delivery).toBe('sent')
    expect(backFromHelper.structured).not.toHaveProperty('told')
    expect(backFromHelper.text).toContain('has been told.')
    expect(backFromHelper.text).not.toContain('could not be told')
    const helperWasTold = await theNoticeIn(helper)
    expect(helperWasTold).toContain(second.label)

    // Now the worker: stopped, forgotten by its provider, and replaced by a follow-up.
    await stop(worker)
    issued.forgetAll()
    const woken = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })
    expect(woken.outcome, JSON.stringify(woken)).toBe('ok')
    const next = woken.went_to as string
    // The premise: a new conversation stands in the worker's place, and the piece is stalled at the old one.
    expect(typeof next).toBe('string')
    expect(next).not.toBe(worker)
    const before = store.piecesOwnedBy(worker)[0]
    expect(before?.state).toBe('stalled')
    expect(before?.stalledBecause).toBe('could_not_be_reopened')
    await waitFor(
      () => wordsIn(next).some((one) => one.text.includes('carry on')),
      'the follow-up to reach the conversation that took its place',
    )
    expect(takeBackNoticesIn(next)).toEqual([])

    const back = await callWithWords(pmTools, 'withdraw_task', { piece: label })
    // Ok, else the premise is wrong: the piece was taken back, and it is the tell that is refused.
    expect(back.structured.outcome, JSON.stringify(back.structured)).toBe('ok')
    expect(back.structured.delivery).toBe('not-delivered')
    expect(back.structured).not.toHaveProperty('told')
    expect(back.text).toContain('could not be told')
    expect(back.text).not.toContain('has been told.')
    const row = ledger(worker).find((one) => one.type === 'work_taken_back')
    if (row === undefined) throw new Error('no work_taken_back row was written')
    expect((row as { by: string }).by).toBe(pm)
    // The tell is awaited inside withdraw_task, so nothing more is owed for this negative to be true.
    expect(takeBackNoticesIn(next)).toEqual([])
    expect(takeBackNoticesIn(worker)).toEqual([])
  })

  it('the tell to the owner says to stop and not to reply, and lists only the pieces it gave that are still open', async () => {
    const { worker, pmTools, workerTools, label } = await aPmAndItsWorker('the piece')
    await bringIdentityIntoBeing('grandchild')
    const first = await aGive(workerTools, 'grandchild', 'first child', label)
    const second = await aGive(workerTools, 'grandchild', 'second child', label)
    expect(second.label).not.toBe(first.label)
    // Both children went to the one conversation the worker has with that agent.
    const grandchild = first.agent
    expect(second.agent).toBe(grandchild)

    // The worker takes the first child back: it is withdrawn, the second is still open.
    const gone = await callOn(workerTools, 'withdraw_task', { piece: first.label })
    expect(gone.outcome, JSON.stringify(gone)).toBe('ok')
    const children = store.piecesOwnedBy(grandchild)
    expect(children.find((one) => one.piece === first.piece)?.state).toBe('withdrawn')
    const stillOpen = children.find((one) => one.piece === second.piece)
    expect(stillOpen && TASK_IS_OPEN[stillOpen.state]).toBe(true)

    const back = await callOn(pmTools, 'withdraw_task', { piece: label })
    expect(back.outcome, JSON.stringify(back)).toBe('ok')
    const told = await theNoticeIn(worker)

    expect(told).toContain('Stop working on it and do not reply_to_parent about it.')
    // The list is real and filtered: the second child is named, exactly as the sentence says it,
    // and the withdrawn first one is not. ⚑ D-016c (`72b78a37`) gave the owner a second act on
    // each: close it with update_work.
    expect(told).toContain(
      `Its open pieces ${second.label} are still yours: take each back with withdraw_task, or close it with update_work, if it is no longer needed.`,
    )
    expect(told).not.toContain(first.label)
  })

  it('a piece with no child is taken back with the stop and without a list of pieces', async () => {
    const { worker, pmTools, label } = await aPmAndItsWorker('the piece')
    const back = await callOn(pmTools, 'withdraw_task', { piece: label })
    expect(back.outcome, JSON.stringify(back)).toBe('ok')
    const told = await theNoticeIn(worker)

    // Read off a real notice: it names the piece and carries the stop, so its missing clause is an absence.
    expect(told).toContain('took back')
    expect(told).toContain(label)
    expect(told).toContain('Stop working on it and do not reply_to_parent about it.')
    expect(told).not.toContain('Its open pieces')
    expect(told).not.toContain('are still yours')
  })

  it("a follow-up that names the sender's own root is refused as its own work, and a note that names it is admitted", async () => {
    const { pm, worker, pmTools, piece, label } = await aPmAndItsWorker('the piece')
    const rootPiece = store.rootOf(pm)
    // The premise: a person opened the pm, so its root was given by nobody.
    expect(rootPiece?.givenBy).toBeNull()
    if (rootPiece === null) throw new Error('the pm has no root')

    const wordsBefore = wordsIn(worker).length
    const receiptsBefore = sentBy(pm).length
    const refused = await callOn(pmTools, 'message_agent', {
      kind: 'follow-up',
      agent: worker,
      text: 'about my own work',
      piece: rootPiece.label,
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('that-is-your-own-work')
    expect(refused.rail).not.toBe('not-a-piece-you-gave')
    expect(refused.rail).not.toBe('that-is-work-you-hold')
    expect(refused.permanence).toBe('permanent')
    expect(refused.remedy).toBeNull()
    // Nothing was sent, and the sender wrote no receipt.
    expect(wordsIn(worker)).toHaveLength(wordsBefore)
    expect(sentBy(pm)).toHaveLength(receiptsBefore)

    // The same follow-up naming the piece the pm GAVE is admitted...
    const admitted = await callOn(pmTools, 'message_agent', {
      kind: 'follow-up',
      agent: worker,
      text: 'about the piece I gave',
      piece: label,
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(admitted.piece).toBe(piece)
    // ...and a NOTE naming the root is admitted, carrying the root's id and label.
    const note = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'a note about my own work',
      piece: rootPiece.label,
    })
    expect(note.outcome, JSON.stringify(note)).toBe('ok')
    expect(note.kind).toBe('note')
    expect(note.piece).toBe(rootPiece.piece)
    expect(note.label).toBe(rootPiece.label)
    expect(sentBy(pm)).toHaveLength(receiptsBefore + 2)
  })

  it('a note names the piece it is about in its answer and on its receipt, and a name nothing answers to for that sender is refused', async () => {
    const { pm, worker, pmTools, piece, label } = await aPmAndItsWorker('the piece')
    const stranger = await personOpens('stranger')
    const strangerRoot = store.rootOf(stranger)?.label
    // The premise: the stranger holds a real root that the pm neither gave nor holds.
    expect(typeof strangerRoot).toBe('string')
    if (strangerRoot === undefined) throw new Error('the stranger has no root')

    const wordsBefore = wordsIn(worker).length
    const receiptsBefore = sentBy(pm).length
    for (const spelled of ['W99.99', strangerRoot]) {
      const refused = await callOn(pmTools, 'message_agent', {
        kind: 'note',
        agent: worker,
        text: 'fyi',
        piece: spelled,
      })
      expect(refused.outcome, `${spelled}: ${JSON.stringify(refused)}`).toBe('refused')
      expect(refused.rail, spelled).toBe('no-piece-by-that-name')
      expect(refused.permanence, spelled).toBe('permanent')
      expect(refused.remedy, spelled).toBeNull()
      expect(refused.detail, spelled).toMatchObject({ piece: spelled })
    }
    // Nothing was sent by either refusal.
    expect(wordsIn(worker)).toHaveLength(wordsBefore)
    expect(sentBy(pm)).toHaveLength(receiptsBefore)

    // The same note naming the piece the pm gave: answered with the piece, and receipted with it.
    const admitted = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'fyi',
      piece: label,
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(['sent', 'queued']).toContain(admitted.delivery)
    expect(admitted.kind).toBe('note')
    expect(admitted.piece).toBe(piece)
    expect(admitted.label).toBe(label)
    const receipt = sentBy(pm).at(-1) as { kind?: string; piece?: string; label?: string }
    expect(sentBy(pm)).toHaveLength(receiptsBefore + 1)
    expect(receipt.kind).toBe('note')
    expect(receipt.piece).toBe(piece)
    expect(receipt.label).toBe(label)
  })

  it('🔴 a note names a piece its sender holds once it has ended, as one it gave; a follow-up still names only one it gave, and a piece neither held nor given is refused', async () => {
    const { pm, worker, pmTools, workerTools, piece, label } = await aPmAndItsWorker('the piece')
    /** A note from `tools` to `to`, naming `named`. */
    const aNote = (tools: AgentToolset, to: string, named: string, text: string) =>
      callOn(tools, 'message_agent', { kind: 'note', agent: to, text, piece: named })
    /** It was admitted, naming the piece, and its sender wrote a receipt naming it too. */
    const admitted = (answer: Record<string, unknown>, sender: string, receipts: number): void => {
      expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
      expect(['sent', 'queued']).toContain(answer.delivery)
      expect(answer.kind).toBe('note')
      expect(answer.piece).toBe(piece)
      expect(answer.label).toBe(label)
      expect(sentBy(sender)).toHaveLength(receipts + 1)
      expect(sentBy(sender).at(-1)).toMatchObject({ kind: 'note', piece, label })
    }

    // ⚑ Held, and open: the worker's note to its giver, naming the piece it holds, is admitted.
    let receipts = sentBy(worker).length
    admitted(await aNote(workerTools, pm, label, 'about the open piece'), worker, receipts)
    // …and a follow-up naming it is refused as work it holds — a follow-up is a piece one gave.
    const heldOpen = await callOn(workerTools, 'message_agent', {
      kind: 'follow-up',
      agent: pm,
      text: 'a follow-up about the open piece',
      piece: label,
    })
    expect(heldOpen).toMatchObject({ outcome: 'refused', rail: 'that-is-work-you-hold' })

    // The worker answers it: the piece has ended, and list_tasks still lists it as work it holds.
    const replied = await callOn(workerTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe('answered')
    const board = await callOn(workerTools, 'list_tasks', { state: 'all' })
    expect(
      (board.you_hold as { label: string; state: string }[]).find((one) => one.label === label),
    ).toMatchObject({ state: 'answered' })

    // 🔴 Held, and ended: the worker's note naming it is admitted — it was refused
    // `no-piece-by-that-name`, a name the worker holds and list_tasks names.
    receipts = sentBy(worker).length
    admitted(await aNote(workerTools, pm, label, 'one more thing about it'), worker, receipts)
    await waitFor(
      () => wordsIn(pm).some((one) => one.text.includes('one more thing about it')),
      'the note to reach the giver',
    )
    // ⛔ A note changes nothing about the piece it names: it is still answered.
    expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe('answered')
    // ⛔ …and a follow-up naming it is still refused, as a piece it did not give — never as work it
    // holds, whose acts (ask about it, hand it back) an ended piece refuses.
    const heldEnded = await callOn(workerTools, 'message_agent', {
      kind: 'follow-up',
      agent: pm,
      text: 'a follow-up about the ended piece',
      piece: label,
    })
    expect(heldEnded).toMatchObject({
      outcome: 'refused',
      rail: 'not-a-piece-you-gave',
      permanence: 'permanent',
    })

    // ⚑ Given, and ended: the pm's note to the worker naming the piece it gave is admitted too.
    receipts = sentBy(pm).length
    admitted(await aNote(pmTools, worker, label, 'thanks for the piece'), pm, receipts)

    // ⛔ Neither held nor given, and ended: a piece the pm gave another conversation, answered there.
    await bringIdentityIntoBeing('helper')
    const other = await aGive(pmTools, 'helper', 'the other piece')
    expect(other.agent).not.toBe(worker)
    const otherReplied = await callOn(agentToolsFor(host, other.agent), 'reply_to_parent', {
      piece: other.label,
      outcome: 'done',
      summary: 'done',
    })
    expect(otherReplied.outcome, JSON.stringify(otherReplied)).toBe('ok')
    const receiptsBefore = sentBy(worker).length
    for (const spelled of [other.label, 'W99.99']) {
      const refused = await aNote(workerTools, pm, spelled, 'about somebody else’s piece')
      expect(refused, spelled).toMatchObject({
        outcome: 'refused',
        rail: 'no-piece-by-that-name',
        permanence: 'permanent',
        detail: { piece: spelled },
      })
    }
    expect(sentBy(worker)).toHaveLength(receiptsBefore)
  })

  it('🔴 a note names work its sender took on for a person once that work is answered', async () => {
    const { pm, worker, pmTools } = await aPmAndItsWorker('the piece')
    // ⚑ The finding's own case: work the pm took on for its person — given by nobody — answered.
    await host.send(pm, 'Please take on the trip plan.', window)
    const taken = await callOn(pmTools, 'take_on_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      title: 'Plan the trip',
      brief: 'plan the trip',
    })
    expect(taken.outcome, JSON.stringify(taken)).toBe('ok')
    const piece = taken.piece as string
    const label = taken.label as string
    expect(store.workById(piece)?.givenBy).toBeNull()
    const replied = await callOn(pmTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'planned',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    expect(store.piecesOwnedBy(pm).find((one) => one.piece === piece)?.state).toBe('answered')

    const receipts = sentBy(pm).length
    const note = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'the trip is planned',
      piece: label,
    })
    expect(note.outcome, JSON.stringify(note)).toBe('ok')
    expect(note).toMatchObject({ kind: 'note', piece, label })
    expect(sentBy(pm)).toHaveLength(receipts + 1)
    expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'note', piece, label })
    expect(store.piecesOwnedBy(pm).find((one) => one.piece === piece)?.state).toBe('answered')
  })

  it('⛔ a conversation standing in another’s place does not name the pieces that one held', async () => {
    const { pm, worker, pmTools, piece, label } = await aPmAndItsWorker('the piece')
    // The worker stopped, forgotten by its provider, and replaced by its giver's follow-up.
    await stop(worker)
    issued.forgetAll()
    const woken = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })
    expect(woken.outcome, JSON.stringify(woken)).toBe('ok')
    const next = woken.went_to as string
    expect(typeof next).toBe('string')
    expect(next).not.toBe(worker)
    await waitFor(
      () => wordsIn(next).some((one) => one.text.includes('carry on')),
      'the follow-up to reach the conversation that took its place',
    )
    // ⛔ The piece is the replaced worker's, and stays its own: the one in its place holds none of it.
    expect(store.piecesOwnedBy(next)).toEqual([])
    const refused = await callOn(agentToolsFor(host, next), 'message_agent', {
      kind: 'note',
      agent: pm,
      text: 'about the piece the conversation before me held',
      piece: label,
    })
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'no-piece-by-that-name',
      detail: { piece: label },
    })
    // ⚑ The control: its giver names it to the one in its place — a piece it gave.
    const given = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: next,
      text: 'about the piece I gave',
      piece: label,
    })
    expect(given).toMatchObject({ outcome: 'ok', kind: 'note', piece, label })
  })

  it('🔴 a follow-up naming a piece its sender holds that has ended says so, and the note it points to goes', async () => {
    const { pm, workerTools, piece, label } = await aPmAndItsWorker('the piece')
    const replied = await callOn(workerTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    const refused = await callWithWords(workerTools, 'message_agent', {
      kind: 'follow-up',
      agent: pm,
      text: 'one more thing',
      piece: label,
    })
    // ⚑ `not-a-piece-you-gave`, which is true — said with what the piece is, and the call that goes.
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      rail: 'not-a-piece-you-gave',
      permanence: 'permanent',
      retryable: false,
      reason: aFollowUpOnAPieceYouHold(label),
      detail: { agent: pm, piece, label },
    })
    expect(refused.text).toBe(
      `refused (not-a-piece-you-gave): ${aFollowUpOnAPieceYouHold(label)} ${permanenceInWords('not-a-piece-you-gave', 'permanent')}`,
    )
    expect(refused.text).toContain(`${label} is a piece you hold, not one you gave`)
    // ⛔ …and never the guess its word makes of a name it cannot place: this one is the sender's own.
    expect(refused.text).not.toContain('or to nothing at all')
    // ⚑ The act it names goes: the same call, as a note.
    const note = await callOn(workerTools, 'message_agent', {
      kind: 'note',
      agent: pm,
      text: 'one more thing',
      piece: label,
    })
    expect(note).toMatchObject({ outcome: 'ok', kind: 'note', piece, label })
  })

  it('🔴 a follow-up naming a piece its sender gave another agent says so, and the call it points to goes; a name it cannot place keeps the guess', async () => {
    const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker('the piece')
    await bringIdentityIntoBeing('helper')
    const other = await aGive(pmTools, 'helper', 'the other piece')
    expect(other.agent).not.toBe(worker)
    // The pm follows up the helper's piece, addressed to the worker.
    const refused = await callWithWords(pmTools, 'message_agent', {
      kind: 'follow-up',
      agent: worker,
      text: 'and the tests',
      piece: other.label,
    })
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      rail: 'not-a-piece-you-gave',
      permanence: 'permanent',
      reason: aFollowUpOnAPieceYouGaveAnother(other.label),
      detail: { agent: worker, piece: other.piece, label: other.label },
    })
    expect(refused.text).not.toContain('or to nothing at all')
    // ⚑ The call it names goes: the same follow-up, to the agent the piece's label names.
    const followed = await callOn(pmTools, 'message_agent', {
      kind: 'follow-up',
      agent: other.label,
      text: 'and the tests',
      piece: other.label,
    })
    expect(followed).toMatchObject({
      outcome: 'ok',
      kind: 'follow-up',
      agent: other.agent,
      piece: other.piece,
      label: other.label,
    })
    // ⛔ A name its sender can place nowhere keeps the word's own sentence, guess and all: a label
    // nobody was given, and — from the worker — a piece it neither holds nor gave.
    for (const [tools, to, spelled] of [
      [pmTools, worker, 'W99.99'],
      [workerTools, pm, other.label],
    ] as const) {
      const unplaced = await callOn(tools, 'message_agent', {
        kind: 'follow-up',
        agent: to,
        text: 'about a name',
        piece: spelled,
      })
      expect(unplaced, spelled).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-piece-you-gave',
        reason: refuseTool('not-a-piece-you-gave').reason,
        detail: { agent: to, piece: spelled },
      })
    }
  })

  it('🔴 a note naming a piece its sender gave says which in the line that names its sender, and how the piece ended; a note naming none is as it was', async () => {
    const made = await workAlreadyAnswered()
    const note = await callOn(made.pmTools, 'message_agent', {
      kind: 'note',
      agent: made.worker,
      text: 'thanks, one more thing',
      piece: made.label,
    })
    expect(note.outcome, JSON.stringify(note)).toBe('ok')
    const turn = await theTurnCarrying(made.worker, 'thanks, one more thing')
    // ⚑ The finding's own case: answered, where the line said only *"work that is now closed"* — and
    // it still says that first, then who is behind it, then what the message is about.
    const line = turn.split('\n')[0] ?? ''
    expect(
      line.startsWith(
        `Sent by ${nameOf('pm')} (pm), who gave you work that is now closed. A person is at`,
      ),
      line,
    ).toBe(true)
    const about = `only an approval needs the person directly. This message is about ${made.label} · read the brief and report (answered).`
    expect(line.slice(-about.length)).toBe(about)
    // ⛔ …and a note that names no piece carries no such sentence.
    await letTheTurnFinish(made.worker)
    const plain = await callOn(made.pmTools, 'message_agent', {
      kind: 'note',
      agent: made.worker,
      text: 'and nothing else',
    })
    expect(plain.outcome, JSON.stringify(plain)).toBe('ok')
    const plainTurn = await theTurnCarrying(made.worker, 'and nothing else')
    const plainLine = plainTurn.split('\n')[0] ?? ''
    expect(plainLine).toContain(
      `Sent by ${nameOf('pm')} (pm), who gave you work that is now closed. A person is at`,
    )
    expect(plainLine.endsWith('only an approval needs the person directly.')).toBe(true)
    expect(plainTurn).not.toContain('This message is about')
  })

  it('🔴 a helper’s note to its giver about the piece it holds says which, open and once answered', async () => {
    const { pm, workerTools, label } = await aPmAndItsWorker('the piece')
    // ⚑ A person opened the pm, so its window answers the pm's cards without taking it over.
    claimed.add(pm)
    const theFirstLine = (turn: string): string => turn.split('\n')[0] ?? ''

    const open = await callOn(workerTools, 'message_agent', {
      kind: 'note',
      agent: pm,
      text: 'halfway there',
      piece: label,
    })
    expect(open.outcome, JSON.stringify(open)).toBe('ok')
    const first = await theTurnCarrying(pm, 'halfway there')
    expect(theFirstLine(first)).toBe(
      `Sent by ${nameOf('worker')} (worker), another agent; it gave you no work. ` +
        `This message is about ${label} · the piece.`,
    )
    await letTheTurnFinish(pm)

    // The worker answers it; its reply reaches the pm as a turn of its own, which is let end.
    const heard = heardBy(pm).length
    const replied = await callOn(workerTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'built',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    await waitFor(() => heardBy(pm).length > heard, 'the reply to reach the pm')
    await letTheTurnFinish(pm)

    const after = await callOn(workerTools, 'message_agent', {
      kind: 'note',
      agent: pm,
      text: 'one file I forgot',
      piece: label,
    })
    expect(after.outcome, JSON.stringify(after)).toBe('ok')
    const second = await theTurnCarrying(pm, 'one file I forgot')
    expect(theFirstLine(second)).toBe(
      `Sent by ${nameOf('worker')} (worker), another agent; it gave you no work. ` +
        `This message is about ${label} · the piece (answered).`,
    )
  })

  it('🔴 a held note still says which piece it is about when a restart sends it', async () => {
    const { pmTools, worker, piece, label } = await aPmAndItsWorker('the piece')
    // ⚑ Held: the worker is parked on its brief's card.
    const held = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'noted for later',
      piece: label,
    })
    expect(held.delivery, JSON.stringify(held)).toBe('queued')
    // ⚑ Its row keeps the piece it names, and a start reads it back.
    expect(
      store.messagesWaitingIn(worker).find((one) => one.text === 'noted for later'),
    ).toMatchObject({ about: piece })
    // The quit, and the next launch: its own store object, over the same database.
    await host.closeAll()
    store = createSessionStore(db, tick)
    host = buildHost()
    await host.resumeSession(worker, window)
    const turn = await theTurnCarrying(worker, 'noted for later')
    expect(turn).toContain(
      `Sent by ${nameOf('pm')} (pm), who gave you ${label}. This message is about ${label} · the piece.`,
    )
    // ⛔ A row whose piece this app could not have written is read back without one.
    store.append(
      worker,
      store.nextOrdinal(worker),
      {
        type: 'message_queued',
        messageId: 'msg_by_hand',
        kind: 'work',
        text: 'x',
        about: 7,
      } as never,
      tick(),
    )
    expect(
      store.messagesWaitingIn(worker).find((one) => one.messageId === 'msg_by_hand'),
    ).not.toHaveProperty('about')
  })

  it('🔴 a held note handed to the conversation that took its receiver’s place keeps the piece it names, on its row too', async () => {
    const { pmTools, worker, piece, label } = await aPmAndItsWorker('the piece')
    const held = await callOn(pmTools, 'message_agent', {
      kind: 'note',
      agent: worker,
      text: 'noted for later',
      piece: label,
    })
    expect(held.delivery, JSON.stringify(held)).toBe('queued')
    // ⚑ Its provider forgets it, and then it stops: a stop holding a message starts it again at once,
    // that start finds nothing to reopen, and a new conversation takes its place, with the note.
    issued.forgetAll()
    await stop(worker)
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'replaced_by'),
      'a conversation to take its place',
    )
    const replaced = ledger(worker).find((event) => event.type === 'replaced_by') as {
      sessionId: string
    }
    const next = replaced.sessionId
    expect(next).not.toBe(worker)
    // ⚑ The note moved to it, and the row that holds it there names the piece — what a start after a
    // quit reads back.
    await waitFor(
      () => wordsIn(next).some((one) => one.text === 'noted for later'),
      'the note to move',
    )
    expect(
      wordsIn(next).find((one) => one.type === 'message_queued' && one.text === 'noted for later'),
    ).toMatchObject({ about: piece })
    const turn = await theTurnCarrying(next, 'noted for later')
    expect(turn).toContain(`This message is about ${label} · the piece`)
  })

  it('🔴 held messages that go as one turn each say what they are about, and only the one that names a piece', async () => {
    const { pmTools, worker, label } = await aPmAndItsWorker('the piece')
    // ⚑ Both held behind the brief's card, so they go out together, as one turn.
    for (const args of [
      { kind: 'note', agent: worker, text: 'first, about the piece', piece: label },
      { kind: 'note', agent: worker, text: 'second, about nothing' },
    ]) {
      const held = await callOn(pmTools, 'message_agent', args)
      expect(held.delivery, JSON.stringify(held)).toBe('queued')
    }
    await letTheTurnFinish(worker)
    const turn = await theTurnCarrying(worker, 'second, about nothing')
    // ⚑ One turn, each message under its own sender line: the first's says what it is about, ahead
    // of its words, and nothing between the first's words and the second's does.
    const about = `This message is about ${label} · the piece.`
    const first = turn.indexOf('first, about the piece')
    const second = turn.indexOf('second, about nothing')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(turn.indexOf(about)).toBeGreaterThan(-1)
    expect(turn.indexOf(about)).toBeLessThan(first)
    expect(turn.split(about)).toHaveLength(2)
    expect(turn.slice(first, second)).not.toContain('This message is about')
  })

  it('🔴 a take-back of a piece its caller holds, open, says so and names the doors that take it; nothing is taken back', async () => {
    const { worker, workerTools, piece, label } = await aPmAndItsWorker('the piece')
    const refused = await callWithWords(workerTools, 'withdraw_task', { piece: label })
    // ⚑ `not-a-piece-you-gave`, which is true — said with what the piece is, and the doors that take it.
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      rail: 'not-a-piece-you-gave',
      permanence: 'permanent',
      retryable: false,
      remedy: null,
      reason: aTakeBackOfAPieceYouHold(label),
      detail: { piece: label, label },
    })
    expect(refused.text).toBe(
      `refused (not-a-piece-you-gave): ${aTakeBackOfAPieceYouHold(label)} ${permanenceInWords('not-a-piece-you-gave', 'permanent')}`,
    )
    expect(refused.text).toContain(`${label} is a piece you hold, not one you gave`)
    // ⛔ …and never the guess its word makes of a name it cannot place: this one is the caller's own.
    expect(refused.text).not.toContain('or to nothing at all')
    // ⛔ Nothing was taken back: the piece is open, and no row says otherwise.
    expect(openPiecesOf(worker).map((one) => one.piece)).toContain(piece)
    expect(ledger(worker).some((event) => event.type === 'work_taken_back')).toBe(false)
    // ⚑ Both doors it names take it: a question keeps it open, and a reply hands it back.
    const asked = await callOn(workerTools, 'ask_question', {
      who_answers: 'the-parent',
      piece: label,
      question: 'which way?',
    })
    expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
    expect(openPiecesOf(worker).map((one) => one.piece)).toContain(piece)
    const replied = await callOn(workerTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
  })

  it('🔴 a take-back of a piece its caller holds that has ended says how, when and by whom — answered, taken back, closed', async () => {
    const { pm, worker, pmTools, workerTools, label } = await aPmAndItsWorker('the piece')
    await bringIdentityIntoBeing('helper')
    await bringIdentityIntoBeing('reviewer')
    const back = await aGive(pmTools, 'helper', 'the piece taken back')
    const closed = await aGive(pmTools, 'reviewer', 'the piece closed')
    // ⚑ Each ends one way: answered by its holder, taken back and closed by the pm that gave them.
    const replied = await callOn(workerTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'done',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    const tookBack = await callOn(pmTools, 'withdraw_task', { piece: back.label })
    expect(tookBack.outcome, JSON.stringify(tookBack)).toBe('ok')
    const close = await callOn(pmTools, 'update_work', { piece: closed.label, close: true })
    expect(close.outcome, JSON.stringify(close)).toBe('ok')
    const thePm = host.whatToCallTheConversation(pm)
    for (const [holder, named, state, how] of [
      [worker, label, 'answered', 'you answered it at '],
      [back.agent, back.label, 'withdrawn', `it was taken back by ${thePm} at `],
      [closed.agent, closed.label, 'closed', `it was closed by ${thePm} at `],
    ] as const) {
      const row = store.piecesOwnedBy(holder).find((one) => one.label === named)
      expect(row?.state, named).toBe(state)
      const at = row?.endedAt
      if (typeof at !== 'number') throw new Error(`${named} has no moment it ended`)
      // ⚑ Who ended it is named, except the holder's own reply.
      const by = state === 'answered' ? {} : { called: thePm }
      const tools = holder === worker ? workerTools : agentToolsFor(host, holder)
      const refused = await callWithWords(tools, 'withdraw_task', { piece: named })
      expect(refused.structured, named).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-piece-you-gave',
        permanence: 'permanent',
        reason: aTakeBackOfAPieceYouHoldThatEnded({
          is: 'ended',
          label: named,
          state,
          at,
          ...by,
          readAt: at,
        }),
        detail: { piece: named, label: named, state, at, ...by },
      })
      expect(refused.text, named).toContain(
        `refused (not-a-piece-you-gave): stop work on that piece; no further reply is owed. ` +
          `${named} is a piece you hold, not one you gave, and it has already ended: ${how}`,
      )
      expect(refused.text, named).not.toContain('or to nothing at all')
      if (state === 'answered') expect(refused.structured.detail).not.toHaveProperty('called')
    }
    // ⚑ …and one taken back while its give still waited behind the holder's turn: the row that
    // ended it names nobody, so neither does the sentence.
    const waited = await aGive(pmTools, 'worker', 'the piece that never reached it')
    expect(waited.agent).toBe(worker)
    const tookItBack = await callOn(pmTools, 'withdraw_task', { piece: waited.label })
    expect(tookItBack.outcome, JSON.stringify(tookItBack)).toBe('ok')
    const row = store.piecesOwnedBy(worker).find((one) => one.label === waited.label)
    expect(row?.state).toBe('withdrawn')
    expect(row?.endedBy).toBeNull()
    const at = row?.endedAt
    if (typeof at !== 'number') throw new Error(`${waited.label} has no moment it ended`)
    const refused = await callWithWords(workerTools, 'withdraw_task', { piece: waited.label })
    expect(refused.structured).toMatchObject({
      rail: 'not-a-piece-you-gave',
      reason: aTakeBackOfAPieceYouHoldThatEnded({
        is: 'ended',
        label: waited.label,
        state: 'withdrawn',
        at,
        readAt: at,
      }),
      detail: { piece: waited.label, label: waited.label, state: 'withdrawn', at },
    })
    expect(refused.structured.detail).not.toHaveProperty('called')
    expect(refused.text).toContain('and it has already ended: it was taken back at ')
  })

  it('🔴 a take-back of the caller’s own root, or of work it took on for a person, says what it is — open, then answered', async () => {
    const { pm, pmTools } = await aPmAndItsWorker('the piece')
    const root = store.rootOf(pm)?.label
    if (root === undefined) throw new Error('a conversation a person opened owns a root')
    const ofTheRoot = await callWithWords(pmTools, 'withdraw_task', { piece: root })
    expect(ofTheRoot.structured).toMatchObject({
      outcome: 'refused',
      rail: 'not-a-piece-you-gave',
      permanence: 'permanent',
      reason: aTakeBackOfYourOwnWork(root),
      detail: { piece: root, label: root },
    })
    expect(ofTheRoot.text).toContain(`${root} is this conversation’s own work, from a person`)
    expect(ofTheRoot.text).not.toContain('or to nothing at all')
    // ⚑ The finding's own case: work the pm took on for its person — open, and then answered.
    await host.send(pm, 'Please take on the trip plan.', window)
    const taken = await callOn(pmTools, 'take_on_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      title: 'Plan the trip',
      brief: 'plan the trip',
    })
    expect(taken.outcome, JSON.stringify(taken)).toBe('ok')
    const label = taken.label as string
    const open = await callWithWords(pmTools, 'withdraw_task', { piece: label })
    expect(open.structured).toMatchObject({
      rail: 'not-a-piece-you-gave',
      reason: aTakeBackOfAPieceYouHold(label),
      detail: { piece: label, label },
    })
    const replied = await callOn(pmTools, 'reply_to_parent', {
      piece: label,
      outcome: 'done',
      summary: 'planned',
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    const at = store.piecesOwnedBy(pm).find((one) => one.label === label)?.endedAt
    if (typeof at !== 'number') throw new Error(`${label} has no moment it ended`)
    const ended = await callWithWords(pmTools, 'withdraw_task', { piece: label })
    expect(ended.structured).toMatchObject({
      rail: 'not-a-piece-you-gave',
      reason: aTakeBackOfAPieceYouHoldThatEnded({
        is: 'ended',
        label,
        state: 'answered',
        at,
        readAt: at,
      }),
      detail: { piece: label, label, state: 'answered', at },
    })
    expect(ended.text).toContain(
      `${label} is a piece you hold, not one you gave, and it has already ended: you answered it at `,
    )
    expect(ended.text).not.toContain('or to nothing at all')
  })

  it('⛔ a take-back of a name its caller neither holds nor gave keeps the word’s own sentence — a made-up label, another’s piece, a predecessor’s', async () => {
    const { worker, pmTools, workerTools, label } = await aPmAndItsWorker('the piece')
    await bringIdentityIntoBeing('helper')
    const other = await aGive(pmTools, 'helper', 'the other piece')
    const theGuess = refuseTool('not-a-piece-you-gave').reason
    expect(theGuess).toContain('or to nothing at all')
    for (const spelled of ['W99.99', other.label]) {
      const refused = await callWithWords(workerTools, 'withdraw_task', { piece: spelled })
      expect(refused.structured, spelled).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-piece-you-gave',
        reason: theGuess,
      })
      expect(refused.structured.detail, spelled).toEqual({ piece: spelled })
    }
    // ⛔ A conversation standing in another's place holds none of what that one held.
    await stop(worker)
    issued.forgetAll()
    const woken = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'carry on',
      kind: 'follow-up',
      piece: label,
    })
    expect(woken.outcome, JSON.stringify(woken)).toBe('ok')
    const next = woken.went_to as string
    expect(typeof next).toBe('string')
    expect(next).not.toBe(worker)
    const fromNext = await callWithWords(agentToolsFor(host, next), 'withdraw_task', {
      piece: label,
    })
    expect(fromNext.structured).toMatchObject({ rail: 'not-a-piece-you-gave', reason: theGuess })
    expect(fromNext.structured.detail).toEqual({ piece: label })
    // ⚑ The control: the pm, which gave the other piece, takes it back.
    const tookBack = await callOn(pmTools, 'withdraw_task', { piece: other.label })
    expect(tookBack.outcome, JSON.stringify(tookBack)).toBe('ok')
  })

  it('an ask that names no piece while a second piece still waits is about the one that has reached the asker', async () => {
    const { worker, pmTools, workerTools, piece, label } = await aPmAndItsWorker('first piece')
    const second = await aGive(pmTools, 'worker', 'second piece')
    expect(second.agent).toBe(worker)
    // The premise: the worker holds two open pieces, and the second's give is held behind the
    // turn it is in, so only the first has reached it (D-022 · R4).
    expect(openPiecesOf(worker)).toHaveLength(2)
    expect(store.piecesOwnedBy(worker).find((one) => one.piece === second.piece)?.state).toBe(
      'waiting',
    )

    const askedBefore = askedIn(worker).length
    const admitted = await callOn(workerTools, 'ask_question', {
      question: 'which?',
      who_answers: 'the-parent',
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(admitted.went_to).toBe('the-parent')
    const asked = askedIn(worker)
    expect(asked).toHaveLength(askedBefore + 1)
    expect(asked.at(-1)?.piece).toBe(piece)
    expect(asked.at(-1)?.label).toBe(label)
  })

  it('an ask that names no piece while two have reached the asker is told to name one, and naming one is admitted', async () => {
    const { worker, pmTools, workerTools, label } = await aPmAndItsWorker('first piece')
    const second = await aGive(pmTools, 'worker', 'second piece')
    expect(second.agent).toBe(worker)
    // The premise: the worker holds two open pieces.
    expect(openPiecesOf(worker)).toHaveLength(2)
    // ⚑ **D-022 · R4 — and both have reached it**: its turn ends, so the second give's brief goes
    // out as the next one. The control above is the same two pieces before that.
    await letTheTurnFinish(worker)
    await waitFor(
      () =>
        wordsIn(worker).some(
          (one) => one.type === 'user_turn' && one.text.includes('second piece'),
        ),
      'the second brief to reach the worker',
    )
    expect(store.piecesOwnedBy(worker).find((one) => one.piece === second.piece)?.state).not.toBe(
      'waiting',
    )
    expect(openPiecesOf(worker)).toHaveLength(2)

    const askedBefore = askedIn(worker).length
    const routedBefore = routedIn(worker).length
    const refused = await callOn(workerTools, 'ask_question', {
      question: 'which?',
      who_answers: 'the-parent',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('name-the-piece-you-ask-about')
    expect(refused.permanence).toBe('permanent')
    expect(refused.remedy).toBeNull()
    const held = (refused.detail as { held?: string[] }).held
    expect([...(held ?? [])].sort()).toEqual([label, second.label].sort())
    // Nothing was asked, and nothing routed. The routings are counted, not looked for: the worker's
    // own permission card has one.
    expect(askedIn(worker)).toHaveLength(askedBefore)
    expect(routedIn(worker)).toHaveLength(routedBefore)

    // The same call naming the second piece is admitted, and the question carries it.
    const named = await callOn(workerTools, 'ask_question', {
      question: 'which?',
      who_answers: 'the-parent',
      piece: second.label,
    })
    expect(named.outcome, JSON.stringify(named)).toBe('ok')
    expect(named.went_to).toBe('the-parent')
    const asked = askedIn(worker)
    expect(asked).toHaveLength(askedBefore + 1)
    expect(asked.at(-1)?.piece).toBe(second.piece)
    expect(asked.at(-1)?.label).toBe(second.label)
    expect(routedIn(worker)).toHaveLength(routedBefore + 1)
  })

  it('an ask that names no piece while none is held is told there is no piece, and a fresh piece is then inferred', async () => {
    const { worker, pmTools, workerTools } = await workAlreadyAnswered()
    // The premise: the worker replied and went idle, so it holds nothing open.
    expect(openPiecesOf(worker)).toEqual([])

    const askedBefore = askedIn(worker).length
    const refused = await callOn(workerTools, 'ask_question', {
      question: 'anything?',
      who_answers: 'the-parent',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('no-piece-to-ask-about')
    expect(refused.rail).not.toBe('name-the-piece-you-ask-about')
    expect(refused.permanence).toBe('permanent')
    expect(refused.remedy).toBeNull()
    expect((refused.detail as { held?: unknown } | undefined)?.held).toBeUndefined()
    expect(askedIn(worker)).toHaveLength(askedBefore)

    // The pm gives it a fresh piece: it holds exactly one, and the same unnamed ask infers it.
    const fresh = await aGive(pmTools, 'worker', 'a fresh piece')
    expect(fresh.agent).toBe(worker)
    expect(openPiecesOf(worker).map((one) => one.piece)).toEqual([fresh.piece])
    const admitted = await callOn(workerTools, 'ask_question', {
      question: 'anything?',
      who_answers: 'the-parent',
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(admitted.went_to).toBe('the-parent')
    const asked = askedIn(worker)
    expect(asked).toHaveLength(askedBefore + 1)
    expect(asked.at(-1)?.piece).toBe(fresh.piece)
  })

  it("a question for the giver of a conversation's own root goes to a person, and one for the giver of a given piece goes to that giver", async () => {
    const { pm, worker, pmTools, workerTools, piece } = await aPmAndItsWorker('the piece')
    const rootPiece = store.rootOf(pm)
    if (rootPiece === null) throw new Error('the pm has no root')

    // The pm holds only its root, so an unnamed ask is about that. Its giver is a person.
    const fromPm = await callWithWords(pmTools, 'ask_question', {
      question: 'which city?',
      who_answers: 'the-parent',
    })
    expect(fromPm.structured.outcome, JSON.stringify(fromPm.structured)).toBe('ok')
    expect(fromPm.structured.went_to).toBe('a-person')
    expect(fromPm.structured.went_to).not.toBe('the-parent')
    expect(fromPm.text).toContain('this conversation’s own work is a person’s')
    expect(fromPm.text).not.toContain('reply_to_parent is what does that')
    const askedByPm = askedIn(pm).find((one) => one.prompt === 'which city?')
    expect(askedByPm?.piece).toBe(rootPiece.piece)
    expect(askedByPm?.label).toBe(rootPiece.label)
    const routedPm = routedIn(pm).find((one) => one.requestId === askedByPm?.requestId)
    expect(routedPm?.to).toBe('a-person')
    // A root has no giver, so no parent is on the routing at all.
    expect(routedPm !== undefined && Object.hasOwn(routedPm, 'parent')).toBe(false)

    // The worker holds one piece, given by the pm: its question goes to the pm.
    const fromWorker = await callWithWords(workerTools, 'ask_question', {
      question: 'which city?',
      who_answers: 'the-parent',
    })
    expect(fromWorker.structured.outcome, JSON.stringify(fromWorker.structured)).toBe('ok')
    expect(fromWorker.structured.went_to).toBe('the-parent')
    expect(fromWorker.text).toContain('reply_to_parent is what does that')
    expect(fromWorker.text).not.toContain('is a person’s')
    const askedByWorker = askedIn(worker).find((one) => one.prompt === 'which city?')
    expect(askedByWorker?.piece).toBe(piece)
    const routedWorker = routedIn(worker).find((one) => one.requestId === askedByWorker?.requestId)
    expect(routedWorker?.to).toBe('the-parent')
    expect(routedWorker?.parent).toBe(pm)
  })
})
