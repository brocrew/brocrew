import { personOpener } from './helpers/person-opens-session'
import { callOn } from './helpers/call-tool'
import type { QuestionAskedEvent, RequestRoutedEvent } from '../src/shared/question-contracts'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { recordHistoricallyMovedNote, seedHistoricalSuccessor } from './lib/historical-replacement'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import { describeConversation } from '../src/main/runtime/conversation-address'
import { agentToolsFor, refuseTool, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import { agentName } from '../src/shared/runtime-ipc'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'
import { RecordingSink, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'

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
 * 2. `message_agent` names the piece it is about. A message about work the sender gave the
 *    recipient records a follow-up. A message about its own work or a piece it gave elsewhere
 *    records a note. A piece it can name stays on the receipt and in the recipient's words,
 *    including once the piece has ended and when the message goes after a restart. An unknown
 *    or inaccessible piece is refused without sending anything.
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

/** `FakeRuntime` with the toolset each launch was handed captured, so a test can act as that agent. */
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
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

  const personOpens = personOpener(() => ({ host, root, window }), 'ask')

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
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
    to: string,
    under?: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title,
      to,
      ...(to === 'new' ? { conversation_title: title } : {}),
      ...(under === undefined ? {} : { under }),
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
    const given = await aGive(pmTools, 'worker', title, 'new')
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

  const restartWithHistoricalWorker = async (
    worker: string,
    pm: string,
    moved?: string,
  ): Promise<{ next: string; tools: AgentToolset }> => {
    await host.closeAll()
    const next = seedHistoricalSuccessor(store, worker, `sess_${++counter}`, tick(), {
      sessions: issued,
      home: syntheticProviderHome(() => userData)('claude', 'worker'),
    })
    if (moved !== undefined) recordHistoricallyMovedNote(store, worker, next, moved, tick())
    store = createSessionStore(db, tick)
    host = buildHost()
    claimed.clear()
    await host.resumeSession(pm, window)
    return { next, tools: agentToolsFor(host, pm) }
  }

  const followHistoricalWorker = async (worker: string, pm: string, label: string) => {
    const { next, tools } = await restartWithHistoricalWorker(worker, pm)
    const woken = await callOn(tools, 'message_agent', {
      agent: worker,
      text: 'carry on',
      piece: label,
    })
    expect(woken, JSON.stringify(woken)).toMatchObject({ outcome: 'ok', went_to: next })
    await waitFor(
      () => wordsIn(next).some((one) => one.text.includes('carry on')),
      'the follow-up to reach the conversation that took its place',
    )
    return { next, tools }
  }

  it('a piece taken back from a conversation that was replaced is not told to the one that took its place', async () => {
    const { pm, worker, pmTools, label } = await aPmAndItsWorker('the piece')

    // The paired positive first: a stopped owner that was NOT replaced has the notice held for its
    // next input, and its answer says so. ⛔ The boolean it replaced is gone, not false.
    await bringIdentityIntoBeing('helper')
    const second = await aGive(pmTools, 'helper', 'second piece', 'new')
    const helper = second.agent
    expect(helper).not.toBe(worker)
    await stop(helper)
    const backFromHelper = await callWithWords(pmTools, 'withdraw_task', { piece: second.label })
    expect(backFromHelper.structured.outcome, JSON.stringify(backFromHelper.structured)).toBe('ok')
    expect(backFromHelper.structured.delivery).toBe('held')
    expect(backFromHelper.structured).not.toHaveProperty('told')
    expect(backFromHelper.text).toContain('will be told with its next input.')
    expect(backFromHelper.text).not.toContain('could not be told')
    const helperWasTold = await theNoticeIn(helper)
    expect(helperWasTold).toContain(second.label)

    const { next, tools } = await followHistoricalWorker(worker, pm, label)
    const before = store.piecesOwnedBy(worker)[0]
    expect(before?.state).toBe('stalled')
    expect(before?.stalledBecause).toBe('could_not_be_reopened')
    expect(takeBackNoticesIn(next)).toEqual([])

    const back = await callWithWords(tools, 'withdraw_task', { piece: label })
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
    const first = await aGive(workerTools, 'grandchild', 'first child', 'new', label)
    const second = await aGive(workerTools, 'grandchild', 'second child', first.label, label)
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
    const rebriefed = await callOn(pmTools, 'update_work', {
      piece: label,
      brief: 'the held rebrief',
    })
    expect(rebriefed).toMatchObject({ outcome: 'ok', delivery: 'held' })
    const back = await callOn(pmTools, 'withdraw_task', { piece: label })
    expect(back).toMatchObject({ outcome: 'ok', tookBackTheMessage: true, delivery: 'held' })
    const told = await theNoticeIn(worker)

    // Read off a real notice: it names the piece and carries the stop, so its missing clause is an absence.
    expect(told).toContain('took back')
    expect(told).toContain(label)
    expect(told).toContain('Stop working on it and do not reply_to_parent about it.')
    expect(told).not.toContain('Its open pieces')
    expect(told).not.toContain('are still yours')
    expect(store.messagesWaitingIn(worker)).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('the held rebrief') }),
    )
  })

  it('derives a note for the sender’s root and a follow-up for work it gave the recipient', async () => {
    const { pm, worker, pmTools, piece, label } = await aPmAndItsWorker('the piece')
    const rootPiece = store.rootOf(pm)
    expect(rootPiece?.givenBy).toBeNull()
    if (rootPiece === null) throw new Error('the pm has no root')

    const receiptsBefore = sentBy(pm).length
    const note = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'about my own work',
      piece: rootPiece.label,
    })
    const rootAddress = { piece: rootPiece.piece, label: rootPiece.label }
    expect(note).toMatchObject({ outcome: 'ok', kind: 'note', ...rootAddress })
    expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'note', ...rootAddress })

    const followed = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'about the piece I gave',
      piece: label,
    })
    expect(followed).toMatchObject({ outcome: 'ok', kind: 'follow-up', piece, label })
    expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'follow-up', piece, label })
    const addressedByTask = await callOn(pmTools, 'message_agent', {
      agent: label,
      text: 'just a note to this conversation',
    })
    expect(addressedByTask).toMatchObject({ outcome: 'ok', agent: worker, kind: 'note' })
    expect(addressedByTask).not.toHaveProperty('piece')
    expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'note', to: worker })
    expect(sentBy(pm).at(-1)).not.toHaveProperty('piece')
    expect(sentBy(pm)).toHaveLength(receiptsBefore + 3)
  })

  it('a message names the piece it is about in its answer and on its receipt, and an unknown task is refused', async () => {
    const { pm, worker, pmTools, piece, label } = await aPmAndItsWorker('the piece')
    const stranger = await personOpens('stranger')
    const strangerRoot = store.rootOf(stranger)
    if (strangerRoot === null) throw new Error('the stranger has no root')

    const wordsBefore = wordsIn(worker).length
    const receiptsBefore = sentBy(pm).length
    const refused = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'fyi',
      piece: 'W99.99',
    })
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'no-piece-by-that-name',
      permanence: 'permanent',
      remedy: null,
      detail: { piece: 'W99.99' },
    })
    expect(wordsIn(worker)).toHaveLength(wordsBefore)
    expect(sentBy(pm)).toHaveLength(receiptsBefore)

    const task = { piece: strangerRoot.piece, label: strangerRoot.label }
    const note = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'about the stranger’s task',
      piece: task.label,
    })
    expect(note).toMatchObject({ outcome: 'ok', kind: 'note', ...task })
    expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'note', ...task })

    // The message about work the pm gave keeps the same piece in both records.
    const admitted = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'fyi',
      piece: label,
    })
    expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
    expect(['sent', 'queued']).toContain(admitted.delivery)
    expect(admitted.kind).toBe('follow-up')
    expect(admitted.piece).toBe(piece)
    expect(admitted.label).toBe(label)
    const receipt = sentBy(pm).at(-1) as { kind?: string; piece?: string; label?: string }
    expect(sentBy(pm)).toHaveLength(receiptsBefore + 2)
    expect(receipt.kind).toBe('follow-up')
    expect(receipt.piece).toBe(piece)
    expect(receipt.label).toBe(label)
  })

  it('🔴 a message names recorded work that ended and refuses unknown work', async () => {
    const { pm, worker, pmTools, workerTools, piece, label } = await aPmAndItsWorker('the piece')
    /** A message from `tools` to `to`, naming `named`. */
    const aMessage = (tools: AgentToolset, to: string, named: string, text: string) =>
      callOn(tools, 'message_agent', { agent: to, text, piece: named })
    /** It was admitted, naming the piece, and its sender wrote a receipt naming it too. */
    const admitted = (
      answer: Record<string, unknown>,
      sender: string,
      receipts: number,
      kind: 'note' | 'follow-up' = 'note',
    ): void => {
      expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
      expect(['sent', 'queued']).toContain(answer.delivery)
      expect(answer.kind).toBe(kind)
      expect(answer.piece).toBe(piece)
      expect(answer.label).toBe(label)
      expect(sentBy(sender)).toHaveLength(receipts + 1)
      expect(sentBy(sender).at(-1)).toMatchObject({ kind, piece, label })
    }

    // ⚑ Held, and open: the worker's note to its giver, naming the piece it holds, is admitted.
    let receipts = sentBy(worker).length
    admitted(await aMessage(workerTools, pm, label, 'about the open piece'), worker, receipts)

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

    // The holder can still name the answered task shown in list_tasks.
    receipts = sentBy(worker).length
    admitted(await aMessage(workerTools, pm, label, 'one more thing about it'), worker, receipts)
    await waitFor(
      () => wordsIn(pm).some((one) => one.text.includes('one more thing about it')),
      'the note to reach the giver',
    )
    // ⛔ A note changes nothing about the piece it names: it is still answered.
    expect(store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe('answered')

    receipts = sentBy(pm).length
    admitted(
      await aMessage(pmTools, worker, label, 'thanks for the piece'),
      pm,
      receipts,
      'follow-up',
    )

    // Another conversation’s answered task remains addressable.
    await bringIdentityIntoBeing('helper')
    const other = await aGive(pmTools, 'helper', 'the other piece', 'new')
    expect(other.agent).not.toBe(worker)
    const otherReplied = await callOn(agentToolsFor(host, other.agent), 'reply_to_parent', {
      piece: other.label,
      outcome: 'done',
      summary: 'done',
    })
    expect(otherReplied.outcome, JSON.stringify(otherReplied)).toBe('ok')
    const receiptsBefore = sentBy(worker).length
    const task = { piece: other.piece, label: other.label }
    const noted = await aMessage(workerTools, pm, task.label, 'about somebody else’s piece')
    expect(noted).toMatchObject({ outcome: 'ok', kind: 'note', ...task })
    expect(sentBy(worker).at(-1)).toMatchObject({ kind: 'note', ...task })

    const refused = await aMessage(workerTools, pm, 'W99.99', 'about an unknown piece')
    expect(refused).toMatchObject({
      outcome: 'refused',
      rail: 'no-piece-by-that-name',
      permanence: 'permanent',
      detail: { piece: 'W99.99' },
    })
    expect(sentBy(worker)).toHaveLength(receiptsBefore + 1)
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

  it('a replacement can name a prior task without becoming its holder', async () => {
    const { pm, worker, piece, label } = await aPmAndItsWorker('the piece')
    const { next, tools } = await followHistoricalWorker(worker, pm, label)
    // ⛔ The piece is the replaced worker's, and stays its own: the one in its place holds none of it.
    expect(store.piecesOwnedBy(next)).toEqual([])
    const note = await callOn(agentToolsFor(host, next), 'message_agent', {
      agent: pm,
      text: 'about the piece the conversation before me held',
      piece: label,
    })
    expect(note).toMatchObject({ outcome: 'ok', kind: 'note', piece, label })
    expect(store.piecesOwnedBy(next)).toEqual([])
    // ⚑ The control: its giver names it to the one in its place — a piece it gave.
    const given = await callOn(tools, 'message_agent', {
      agent: next,
      text: 'about the piece I gave',
      piece: label,
    })
    expect(given).toMatchObject({ outcome: 'ok', kind: 'follow-up', piece, label })
  })

  it('records a note about a task the sender gave elsewhere and a follow-up to its actual holder', async () => {
    const { pm, worker, pmTools, workerTools } = await aPmAndItsWorker('the piece')
    await bringIdentityIntoBeing('helper')
    const other = await aGive(pmTools, 'helper', 'the other piece', 'new')
    expect(other.agent).not.toBe(worker)
    const task = { piece: other.piece, label: other.label }

    const noted = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'and the tests',
      piece: other.label,
    })
    expect(noted).toMatchObject({ outcome: 'ok', kind: 'note', agent: worker, ...task })
    expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'note', to: worker, ...task })

    const followed = await callOn(pmTools, 'message_agent', {
      agent: other.label,
      text: 'and the tests',
      piece: other.label,
    })
    expect(followed).toMatchObject({
      outcome: 'ok',
      kind: 'follow-up',
      agent: other.agent,
      ...task,
    })
    expect(sentBy(pm).at(-1)).toMatchObject({ kind: 'follow-up', to: other.agent, ...task })

    const receiptsBefore = sentBy(pm).length
    const unplaced = await callOn(pmTools, 'message_agent', {
      agent: worker,
      text: 'about a name',
      piece: 'W99.99',
    })
    expect(unplaced).toMatchObject({
      outcome: 'refused',
      rail: 'no-piece-by-that-name',
      detail: { piece: 'W99.99' },
    })
    expect(wordsIn(worker).some((word) => word.text.includes('about a name'))).toBe(false)
    expect(sentBy(pm)).toHaveLength(receiptsBefore)

    const fromWorker = await callOn(workerTools, 'message_agent', {
      agent: pm,
      text: 'about the helper’s work',
      piece: other.label,
    })
    expect(fromWorker).toMatchObject({ outcome: 'ok', kind: 'note', ...task })
    expect(sentBy(worker).at(-1)).toMatchObject({ kind: 'note', to: pm, ...task })
  })

  it('names the answered task in a follow-up header and omits the task from a plain note', async () => {
    const made = await workAlreadyAnswered()
    const followed = await callOn(made.pmTools, 'message_agent', {
      agent: made.worker,
      text: 'thanks, one more thing',
      piece: made.label,
    })
    expect(followed).toMatchObject({ outcome: 'ok', kind: 'follow-up' })
    const turn = await theTurnCarrying(made.worker, 'thanks, one more thing')
    const line = turn.split('\n')[0] ?? ''
    expect(line).toContain(`From ${nameOf('pm')} (conversation `)
    const destination = describeConversation(store, made.worker, false).line
    expect(line).toContain(
      `, about task ${made.label} · read the brief and report (answered), in your ${destination}.`,
    )
    expect(turn).toContain('This conversation gave you work that is now closed.')
    expect(turn).toContain('A person is at that conversation.')
    await letTheTurnFinish(made.worker)
    const plain = await callOn(made.pmTools, 'message_agent', {
      agent: made.worker,
      text: 'and nothing else',
    })
    expect(plain.outcome, JSON.stringify(plain)).toBe('ok')
    const plainTurn = await theTurnCarrying(made.worker, 'and nothing else')
    const plainLine = plainTurn.split('\n')[0] ?? ''
    expect(plainLine).toContain(`From ${nameOf('pm')} (conversation `)
    expect(plainLine).not.toContain('about task')
    expect(plainLine).toContain(`), in your ${destination}.`)
    expect(plainTurn).toContain('This conversation gave you work that is now closed.')
    expect(plainTurn).toContain('A person is at that conversation.')
  })

  it('🔴 a helper’s note to its giver about the piece it holds says which, open and once answered', async () => {
    const { pm, workerTools, label } = await aPmAndItsWorker('the piece')
    // ⚑ A person opened the pm, so its window answers the pm's cards without taking it over.
    claimed.add(pm)
    const theFirstLine = (turn: string): string => turn.split('\n')[0] ?? ''

    const open = await callOn(workerTools, 'message_agent', {
      agent: pm,
      text: 'halfway there',
      piece: label,
    })
    expect(open.outcome, JSON.stringify(open)).toBe('ok')
    const first = await theTurnCarrying(pm, 'halfway there')
    const destination = describeConversation(store, pm, false).line
    expect(theFirstLine(first)).toBe(
      `From ${nameOf('worker')} (conversation ${label} · the piece), about task ${label} · the piece, in your ${destination}.`,
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
      agent: pm,
      text: 'one file I forgot',
      piece: label,
    })
    expect(after.outcome, JSON.stringify(after)).toBe('ok')
    const second = await theTurnCarrying(pm, 'one file I forgot')
    expect(theFirstLine(second)).toBe(
      `From ${nameOf('worker')} (conversation ${label} · the piece), about task ${label} · the piece (answered), in your ${destination}.`,
    )
  })

  const holdAMessage = async (
    tools: AgentToolset,
    worker: string,
    label: string,
  ): Promise<void> => {
    const held = await callOn(tools, 'message_agent', {
      agent: worker,
      text: 'noted for later',
      piece: label,
    })
    expect(held, JSON.stringify(held)).toMatchObject({ delivery: 'queued', kind: 'follow-up' })
  }

  it('a held follow-up still names the task when a restart sends it', async () => {
    const { pmTools, worker, piece, label } = await aPmAndItsWorker('the piece')
    await holdAMessage(pmTools, worker, label)
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
    expect(turn).toContain(`about task ${label} · the piece, in your conversation `)
    expect(turn).toContain(`This conversation gave you ${label}.`)
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

  it('a held follow-up moved to the replacement conversation keeps its task in the row and words', async () => {
    const { pm, pmTools, worker, piece, label } = await aPmAndItsWorker('the piece')
    await holdAMessage(pmTools, worker, label)
    const { next } = await restartWithHistoricalWorker(worker, pm, 'noted for later')
    expect(
      store.messagesWaitingIn(next).find((one) => one.text === 'noted for later'),
    ).toMatchObject({ about: piece })
    await host.resumeSession(next, window)
    const turn = await theTurnCarrying(next, 'noted for later')
    expect(turn).toContain(`about task ${label} · the piece`)
  })

  it('a missing session leaves a held follow-up recorded and says why its wake ran nothing', async () => {
    const { pmTools, worker, piece, label } = await aPmAndItsWorker('the piece')
    await holdAMessage(pmTools, worker, label)
    const idsOfRecordedConversations = () =>
      store
        .recorded()
        .map(({ sessionId }) => sessionId)
        .sort()
    const before = idsOfRecordedConversations()
    const message =
      'This conversation could not wake: its provider session file is missing. Nothing ran.'
    issued.forgetAll()
    await stop(worker)
    await waitFor(
      () => ledger(worker).some((row) => row.type === 'error' && row.message === message),
      'the missing session wake failure',
    )
    expect(ledger(worker)).toContainEqual({ type: 'error', message, fatal: false })
    expect(store.messagesWaitingIn(worker)).toContainEqual(
      expect.objectContaining({ text: 'noted for later', about: piece }),
    )
    expect(store.replacements()).toEqual([])
    expect(idsOfRecordedConversations()).toEqual(before)
  })

  it('only the message naming a task carries the task header when two held messages share a turn', async () => {
    const { pmTools, worker, label } = await aPmAndItsWorker('the piece')
    // ⚑ Both held behind the brief's card, so they go out together, as one turn.
    for (const args of [
      { agent: worker, text: 'first, about the piece', piece: label },
      { agent: worker, text: 'second, about nothing' },
    ]) {
      const held = await callOn(pmTools, 'message_agent', args)
      expect(held.delivery, JSON.stringify(held)).toBe('queued')
    }
    await letTheTurnFinish(worker)
    const turn = await theTurnCarrying(worker, 'second, about nothing')
    // ⚑ One turn, each message under its own sender line: the first's says what it is about, ahead
    // of its words, and nothing between the first's words and the second's does.
    const about = `about task ${label} · the piece, in your conversation `
    const first = turn.indexOf('first, about the piece')
    const second = turn.indexOf('second, about nothing')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
    expect(turn.indexOf(about)).toBeGreaterThan(-1)
    expect(turn.indexOf(about)).toBeLessThan(first)
    expect(turn.split(about)).toHaveLength(2)
    expect(turn.slice(first, second)).not.toContain('about task')
  })

  it('lets a holder withdraw its own open piece with its reason', async () => {
    const { pm, worker, workerTools, piece, label } = await aPmAndItsWorker('the piece')
    const reason = 'The input this work depended on is gone.'
    const result = await callOn(workerTools, 'withdraw_task', { piece: label, reason })
    expect(result).toMatchObject({ outcome: 'ok', state: 'withdrawn' })
    expect(ledger(worker)).toContainEqual(
      expect.objectContaining({ type: 'work_taken_back', piece, by: worker }),
    )
    await letTheTurnFinish(worker)
    const actor = host.whatToCallTheConversation(worker)
    const notice = await theNoticeIn(worker)
    expect(notice).toContain(`${actor} took back`)
    expect(notice).toContain(`Reason: ${reason}`)
    const giveNotice = () =>
      wordsIn(pm).filter((row) => row.appNotice === 'a-piece-it-gave-taken-back')
    await waitFor(() => giveNotice().length > 0, 'the giver to be told')
    expect(giveNotice()).toHaveLength(1)
    expect(giveNotice()[0]?.text).toContain(`${actor} took back`)
    expect(giveNotice()[0]?.text).toContain(`Reason: ${reason}`)
  })

  it('🔴 a take-back of a piece its caller holds that has ended says how, when and by whom — answered, taken back, closed', async () => {
    const { pm, worker, pmTools, workerTools, label } = await aPmAndItsWorker('the piece')
    await bringIdentityIntoBeing('helper')
    await bringIdentityIntoBeing('reviewer')
    const back = await aGive(pmTools, 'helper', 'the piece taken back', 'new')
    const closed = await aGive(pmTools, 'reviewer', 'the piece closed', 'new')
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
    for (const [holder, named, state, rail] of [
      [worker, label, 'answered', 'that-piece-was-already-answered'],
      [back.agent, back.label, 'withdrawn', 'that-piece-was-already-taken-back'],
      [closed.agent, closed.label, 'closed', 'that-piece-was-already-closed'],
    ] as const) {
      const row = store.piecesOwnedBy(holder).find((one) => one.label === named)
      expect(row?.state, named).toBe(state)
      const at = row?.endedAt
      if (typeof at !== 'number') throw new Error(`${named} has no moment it ended`)
      const tools = holder === worker ? workerTools : agentToolsFor(host, holder)
      const refused = await callWithWords(tools, 'withdraw_task', { piece: named })
      expect(refused.structured, named).toMatchObject({
        outcome: 'refused',
        rail,
        permanence: 'permanent',
        detail: { piece: named, label: named, state, at },
      })
      expect(refused.text).toContain(`has ended (${state === 'answered' ? 'done' : state})`)
      if (state === 'answered') {
        expect(refused.structured.detail).not.toHaveProperty('called')
        expect(refused.structured.detail).toHaveProperty('endedByYou', true)
        expect(refused.text).toContain(`You answered ${named} at `)
      } else {
        expect(refused.structured.detail).toHaveProperty('called', thePm)
        expect(refused.text).toContain(`by ${thePm} at `)
      }
    }
    // ⚑ …and one taken back while its give still waited behind the holder's turn: the row that
    // ended it names nobody, so neither does the sentence.
    const waited = await aGive(pmTools, 'worker', 'the piece that never reached it', label)
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
      rail: 'that-piece-was-already-taken-back',
      detail: { piece: waited.label, label: waited.label, state: 'withdrawn', at },
    })
    expect(refused.structured.detail).not.toHaveProperty('called')
    expect(refused.text).toContain(
      `task ${waited.label} · the piece that never reached it has ended (withdrawn)`,
    )
    expect(refused.text).toContain(`${waited.label} was taken back at `)
  })

  it('keeps the root open and lets another conversation withdraw a person-given child', async () => {
    const { pm, pmTools, worker, workerTools } = await aPmAndItsWorker('the piece')
    const root = store.rootOf(pm)?.label
    if (root === undefined) throw new Error('a conversation a person opened owns a root')
    const refused = await callWithWords(pmTools, 'withdraw_task', { piece: root })
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      rail: 'that-is-your-own-work',
      detail: { piece: root, label: root },
    })
    expect(refused.text).toContain('this conversation’s own work, from a person')
    await host.send(pm, 'Please take on the trip plan.', window)
    const taken = await callOn(pmTools, 'take_on_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      title: 'Plan the trip',
      brief: 'plan the trip',
    })
    expect(taken.outcome, JSON.stringify(taken)).toBe('ok')
    const label = taken.label as string
    const reason = 'The trip has been cancelled.'
    expect(await callOn(workerTools, 'withdraw_task', { piece: label, reason })).toMatchObject({
      outcome: 'ok',
      state: 'withdrawn',
    })
    expect(store.rootOf(pm)?.label).toBe(root)
    expect(store.piecesOwnedBy(pm).find((one) => one.label === label)).toMatchObject({
      state: 'withdrawn',
      endedBy: worker,
    })
    claimed.add(pm)
    await letTheTurnFinish(pm)
    const notice = await theNoticeIn(pm)
    expect(notice).toContain(`${host.whatToCallTheConversation(worker)} took back`)
    expect(notice).toContain(`Reason: ${reason}`)
  })

  it('refuses an unknown name and never redirects an ending notice to a successor', async () => {
    const { pm, worker, workerTools, label } = await aPmAndItsWorker('the piece')
    const refused = await callWithWords(workerTools, 'withdraw_task', { piece: 'W99.99' })
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      rail: 'no-piece-by-that-name',
      reason: refuseTool('no-piece-by-that-name').reason,
      detail: { piece: 'W99.99' },
    })
    const { next, tools } = await followHistoricalWorker(worker, pm, label)
    const fromNext = await callWithWords(agentToolsFor(host, next), 'withdraw_task', {
      piece: label,
    })
    expect(fromNext.structured).toMatchObject({ outcome: 'ok', delivery: 'not-delivered' })
    expect(takeBackNoticesIn(next)).toHaveLength(0)
    expect(store.piecesOwnedBy(worker).find((one) => one.label === label)?.state).toBe('withdrawn')
    const other = await aGive(tools, 'worker', 'a new piece', 'new')
    const tookBack = await callOn(tools, 'withdraw_task', { piece: other.label })
    expect(tookBack.outcome, JSON.stringify(tookBack)).toBe('ok')
  })

  it('an ask that names no piece while a second piece still waits is about the one that has reached the asker', async () => {
    const { worker, pmTools, workerTools, piece, label } = await aPmAndItsWorker('first piece')
    const second = await aGive(pmTools, 'worker', 'second piece', label)
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
    const second = await aGive(pmTools, 'worker', 'second piece', label)
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
    const { worker, pmTools, workerTools, label } = await workAlreadyAnswered()
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
    const fresh = await aGive(pmTools, 'worker', 'a fresh piece', label)
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

  it('refuses a root parent ask and records explicit person and actual giver asks', async () => {
    const { pm, worker, pmTools, workerTools, piece } = await aPmAndItsWorker('the piece')
    const rootPiece = store.rootOf(pm)
    if (rootPiece === null) throw new Error('the pm has no root')

    const routedBefore = routedIn(pm)
    const noGiver = await callWithWords(pmTools, 'ask_question', {
      question: 'which city?',
      who_answers: 'the-parent',
    })
    expect(noGiver.structured).toMatchObject({
      outcome: 'refused',
      rail: 'no-conversation-gave-this-work',
    })
    expect(noGiver.structured).not.toHaveProperty('question')
    expect(noGiver.structured).not.toHaveProperty('receipt')
    expect(noGiver.text).toBe(
      'Not sent: no conversation gave you this work. If you meant to ask the person, use who_answers: a-person.',
    )
    expect(askedIn(pm)).toEqual([])
    expect(routedIn(pm)).toEqual(routedBefore)

    const fromPm = await callWithWords(pmTools, 'ask_question', {
      question: 'which city?',
      who_answers: 'a-person',
    })
    expect(fromPm.structured.outcome, JSON.stringify(fromPm.structured)).toBe('ok')
    expect(fromPm.structured.went_to).toBe('a-person')
    expect(fromPm.text).toBe(
      `Question ${fromPm.structured.question} recorded for the person. The answer arrives as a message.`,
    )
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
    expect(fromWorker.structured.receipt).toMatchObject({
      recorded: { kind: 'question', id: fromWorker.structured.question },
      recipient: { id: pm },
    })
    expect(fromWorker.text).toContain(`Question ${fromWorker.structured.question} `)
    expect(fromWorker.text).toContain('The answer arrives as a message.')
    const askedByWorker = askedIn(worker).find((one) => one.prompt === 'which city?')
    expect(askedByWorker?.piece).toBe(piece)
    const routedWorker = routedIn(worker).find((one) => one.requestId === askedByWorker?.requestId)
    expect(routedWorker?.to).toBe('the-parent')
    expect(routedWorker?.parent).toBe(pm)
  })
})
