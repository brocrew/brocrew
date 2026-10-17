import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { giverStallReceipts, isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { MAX_RESOURCES_PER_REPLY } from '../src/shared/documents'
import { stillHeld } from '../src/shared/mailbox'
import { pieceLine } from '../src/shared/piece-called'
import { REQUEST_IS_OPEN, REQUEST_STATES } from '../src/shared/questions'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  theMessagesOf,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # D-016c · the giver's verbs — `update_work` briefs, closes and hands files; `give_work` hands inputs
 *
 * The giver of a piece could give it, take it back and ask about it. It could not say a piece was
 * WRONG (a new brief), say it was no longer WANTED without saying it was wrong to have begun it (a
 * close), or hand the piece the files it works from. This file pins the three verbs and the words
 * they leave behind, over a real `RuntimeHost` and a real ledger, on the Fake provider only:
 *
 *  - **§1 · a brief** — an idle owner hears the giver's words at once, a busy one has them held with
 *    the piece named; the fold keeps the newest brief, and only the giver may write one.
 *  - **§2 · a close** — the piece ends `closed`, never `withdrawn`; its owner is told, its questions
 *    end as `work-closed`, a held brief goes back once the close is written, and an ended piece
 *    takes no second close and no brief (only a title).
 *  - **§3 · files** — what the giver keeps for a piece are its INPUTS and the owner is told; what the
 *    owner keeps are what it MADE and nobody is; `give_work`'s `inputs` are kept before anything is
 *    started, and one that cannot be read refuses the whole give.
 *  - **§4 · the push taken back** — a parent holding *"…is not being worked on"* is not handed it
 *    once its own close or its own SENT brief made it false, and a title, or a brief that is only
 *    held, does not. The take-back writes no receipt of its own: the push's receipt stands.
 *
 * ⚑ A negative is paired with a positive from the same reader, and a presence is asserted before an
 * order or a text.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const shaOf = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

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

/** Every row type `update_work` and the tells around it can write, on any ledger. */
const ROWS_A_VERB_WRITES = [
  'work_rebriefed',
  'work_closed',
  'work_retitled',
  'work_status_set',
  'work_taken_back',
  'work_replied',
  'message_queued',
  'message_unqueued',
  'user_turn',
] as const

const THE_GIVES_BRIEF = 'read the first table'
const THE_NEW_BRIEF = 'use the second table'

type Refused = { outcome: string; rail: string; detail?: { problems?: string[] } }

describe('D-016c · the giver briefs, closes and hands files to a piece it gave', () => {
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
  let gate: ResumeGate
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d016c-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d016c-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_160_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      resourcesRoot: () => resourcesRoot(userData),
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The rig
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  /** An identity a give can name: opened by a person, then closed. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callFull = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => (await callFull(caller, name, args)).structured

  const cardsOn = (id: string): number =>
    events(id).filter((event) => event.type === 'permission_request').length

  const turnsOn = (id: string): number => events(id).filter((event) => event.type === 'turn').length

  const isIdle = (id: string): boolean => {
    const last = events(id)
      .filter((event) => event.type === 'status')
      .at(-1) as { state?: string } | undefined
    return last?.state === 'idle'
  }

  /** The person answers the last card of a parked turn, and the turn ends. */
  const letTheTurnEnd = async (id: string): Promise<void> => {
    const card = events(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1) as { id: string } | undefined
    if (card === undefined) throw new Error(`${id} is not parked`)
    await host.respondPermission(id, card.id, { outcome: 'allow' }, window)
    await letItSettle()
  }

  /** What the PROVIDER was handed: the Fake echoes each send as an assistant message. */
  const saidToProvider = (id: string): string[] =>
    events(id)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  /**
   * What a conversation READ: every message it was handed, oldest first.
   *
   * 🔴 **D-027 moved where a message sits on the ledger**: what was held goes out as ONE turn, and a
   * turn of two or more carries each message as a `part` — its top level is the words joined and
   * names no notice, no piece and no sender. ⚑ So this reads every turn through `theMessagesOf`, as
   * the product's own readers do, and one entry here is still one message a conversation read.
   */
  const read = (
    id: string,
  ): { text: string; piece?: string; label?: string; appNotice?: string }[] =>
    events(id).flatMap((event) =>
      event.type === 'user_turn'
        ? theMessagesOf(event).map((message) => ({
            text: message.text,
            ...(message.piece === undefined ? {} : { piece: message.piece }),
            ...(message.label === undefined ? {} : { label: message.label }),
            ...(message.appNotice === undefined ? {} : { appNotice: message.appNotice }),
          }))
        : [],
    )
  /** What is HELD for a conversation, in the order it was queued. */
  const held = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'message_queued' ? [event.text] : []))
  const unqueued = (id: string): { reason: string; text: string; detail?: string }[] =>
    events(id).flatMap((event) =>
      event.type === 'message_unqueued'
        ? [
            {
              reason: event.reason,
              text: event.text,
              ...(event.detail === undefined ? {} : { detail: event.detail }),
            },
          ]
        : [],
    )
  const rowsOf = <T extends TranscriptEvent['type']>(
    id: string,
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] =>
    events(id).filter(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )

  /** How many rows of each kind a verb can write are on these ledgers, together. */
  const tally = (...ids: string[]): Record<string, number> =>
    Object.fromEntries(
      ROWS_A_VERB_WRITES.map((type) => [
        type,
        ids.reduce((total, id) => total + events(id).filter((one) => one.type === type).length, 0),
      ]),
    )

  const pieceOf = (owner: string, piece: string) => {
    const found = store.piecesOwnedBy(owner).find((one) => one.piece === piece)
    if (found === undefined) throw new Error(`${owner} owns no piece ${piece}`)
    return found
  }

  /** A give, answered `ok`. `under` names the giver's own piece. */
  const aGive = async (
    giver: string,
    profile: string,
    title: string,
    brief: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ agent: string; piece: string; label: string; answer: Record<string, unknown> }> => {
    const answer = await callOn(giver, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief,
      ...extra,
    })
    expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
    return {
      agent: answer.agent as string,
      piece: answer.piece as string,
      label: answer.label as string,
      answer,
    }
  }

  /** A PM a person opened, and a worker it gave one piece, whose first turn parks on a card. */
  const aPmAndItsWorker = async (
    suffix = '',
    title = 'the first piece',
  ): Promise<{ pm: string; worker: string; piece: string; label: string; title: string }> => {
    await bringIdentityIntoBeing(`worker${suffix}`)
    const pm = await personOpens(`pm${suffix}`)
    const given = await aGive(pm, `worker${suffix}`, title, THE_GIVES_BRIEF)
    host.claimSession(given.agent, window)
    await waitFor(() => cardsOn(given.agent) > 0, 'the worker to park on its first turn')
    return { pm, worker: given.agent, piece: given.piece, label: given.label, title }
  }

  /** The same, with the worker's first turn let end: it holds the piece and is idle. */
  const anIdleWorker = async (suffix = '') => {
    const made = await aPmAndItsWorker(suffix)
    await letTheTurnEnd(made.worker)
    await waitFor(() => isIdle(made.worker), 'the worker to go idle')
    return made
  }

  const wrote = (name: string, content: Buffer | string): string => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  }

  /** What is kept, by hash directory. Dot-names are temporary files, which are not kept anything. */
  const keptHashes = (): string[] => {
    try {
      return readdirSync(resourcesRoot(userData))
        .filter((name) => !name.startsWith('.'))
        .sort()
    } catch {
      return []
    }
  }

  const refusedWith = (answer: Record<string, unknown>, rail: string): Refused => {
    expect(answer.outcome, JSON.stringify(answer)).toBe('refused')
    expect(answer.rail, JSON.stringify(answer)).toBe(rail)
    return answer as unknown as Refused
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · a brief
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a new brief', () => {
    it("a new brief reaches an idle owner as its giver's words, is kept as the piece's brief, and a worker cannot write one", async () => {
      const { pm, worker, piece, label, title } = await anIdleWorker()
      expect(pieceOf(worker, piece).brief).toBe(THE_GIVES_BRIEF)
      const queuedBefore = rowsOf(worker, 'message_queued').length

      const briefed = await callOn(pm, 'update_work', { piece: label, brief: THE_NEW_BRIEF })
      expect(briefed.outcome, JSON.stringify(briefed)).toBe('ok')
      expect(briefed.rebriefed).toBe(true)
      // ⚑ D-022 · R3: the giver hears the delivery in the shared vocabulary, never a boolean `told`.
      expect(briefed.delivery).toBe('sent')
      expect(briefed).not.toHaveProperty('told')

      // ⚑ The ledger: one row, the new words as said, by the giver.
      expect(rowsOf(worker, 'work_rebriefed')).toEqual([
        expect.objectContaining({ piece, brief: THE_NEW_BRIEF, by: pm }),
      ])
      // ⚑ The fold: the newest brief stands, not the give's.
      expect(pieceOf(worker, piece).brief).toBe(THE_NEW_BRIEF)

      // ⚑ The owner READ the giver's bare words, on the piece, and nothing was held for it.
      const turns = read(worker)
      expect(turns.at(-1)).toMatchObject({ text: THE_NEW_BRIEF, piece, label })
      expect(rowsOf(worker, 'message_queued')).toHaveLength(queuedBefore)

      // ⚑ The PROVIDER was handed the words framed by who sent them and which piece they are about.
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('sends you the new brief of')),
        'the provider to be handed the new brief',
      )
      const heard = saidToProvider(worker).filter((said) =>
        said.includes('sends you the new brief of'),
      )
      expect(heard).toHaveLength(1)
      expect(heard[0]).toContain(pieceLine(label, title))
      expect(heard[0]).toContain(THE_NEW_BRIEF)
      expect(heard[0]).not.toContain(THE_GIVES_BRIEF)

      // ⚑ The paired positive, from the same reader: the OWNER says the same words and is refused.
      const before = tally(worker, pm)
      const refused = refusedWith(
        await callOn(worker, 'update_work', { piece: label, brief: 'x' }),
        'the-giver-briefs-and-closes-a-piece',
      )
      expect(refused.rail).toBe('the-giver-briefs-and-closes-a-piece')
      await letItSettle()
      expect(tally(worker, pm)).toEqual(before)
      expect(pieceOf(worker, piece).brief).toBe(THE_NEW_BRIEF)
    })

    it('a new brief for an owner mid-turn is held with the piece named, and the provider hears it only after the turn ends', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      expect(isIdle(worker)).toBe(false)

      const briefed = await callOn(pm, 'update_work', { piece: label, brief: THE_NEW_BRIEF })
      expect(briefed.outcome, JSON.stringify(briefed)).toBe('ok')
      expect(briefed.rebriefed).toBe(true)
      // ⚑ The fold already reads the new brief: the piece is re-briefed as of the call.
      expect(pieceOf(worker, piece).brief).toBe(THE_NEW_BRIEF)

      // ⚑ Held: one queued row carries the mark, the piece and its label; the provider has not heard it.
      const queued = rowsOf(worker, 'message_queued').filter((one) => one.rebrief === true)
      expect(queued).toHaveLength(1)
      const [theHeld] = queued
      if (theHeld === undefined) throw new Error('the new brief was not held')
      expect(theHeld).toMatchObject({ piece, label, text: THE_NEW_BRIEF })
      expect(stillHeld(store.events(worker)).map((one) => one.messageId)).toContain(
        theHeld.messageId,
      )
      await letItSettle()
      expect(
        saidToProvider(worker).filter((said) => said.includes('sends you the new brief of')),
      ).toEqual([])

      // ⚑ The turn ends: the provider hears it once, and the held row is closed as sent.
      await letTheTurnEnd(worker)
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('sends you the new brief of')),
        'the held brief to reach the provider',
      )
      const heard = saidToProvider(worker).filter((said) =>
        said.includes('sends you the new brief of'),
      )
      expect(heard).toHaveLength(1)
      expect(heard[0]).toContain(THE_NEW_BRIEF)
      expect(stillHeld(store.events(worker)).map((one) => one.messageId)).not.toContain(
        theHeld.messageId,
      )
      const ending = events(worker).find(
        (event) => event.type === 'message_unqueued' && event.messageId === theHeld.messageId,
      )
      expect(ending).toMatchObject({ reason: 'sent' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · a close
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a close', () => {
    it('closing an open piece ends it as closed and tells its owner, and nothing can end or brief it again', async () => {
      const { pm, worker, piece, label, title } = await aPmAndItsWorker()
      // ⚑ The owner gives a child under this piece, so the open-pieces sentence has something to name.
      await bringIdentityIntoBeing('grandchild')
      const child = await aGive(worker, 'grandchild', 'a smaller piece', 'do the small part', {
        piece: label,
      })
      await letTheTurnEnd(worker)
      await waitFor(() => isIdle(worker), 'the worker to go idle')
      expect(TASK_IS_OPEN[pieceOf(worker, piece).state]).toBe(true)

      const closed = await callOn(pm, 'update_work', { piece: label, close: true })
      expect(closed.outcome, JSON.stringify(closed)).toBe('ok')
      expect(closed).toMatchObject({
        state: 'closed',
        tookBackTheMessage: false,
        endedQuestions: 0,
        delivery: 'sent',
      })
      expect(closed).not.toHaveProperty('told')

      // ⚑ One row, by the giver; the fold says closed, not withdrawn, and closed is an ending.
      expect(rowsOf(worker, 'work_closed')).toEqual([expect.objectContaining({ piece, by: pm })])
      const folded = pieceOf(worker, piece)
      expect(folded.state).toBe('closed')
      expect(folded.state).not.toBe('withdrawn')
      expect(TASK_IS_OPEN[folded.state]).toBe(false)

      // ⚑ The owner heard it, in the app's own words, naming what stays its own to settle.
      await waitFor(
        () => read(worker).some((turn) => turn.appNotice === 'a-piece-closed'),
        'the owner to be told the piece was closed',
      )
      const notice = read(worker).find((turn) => turn.appNotice === 'a-piece-closed')
      const who = host.whatToCallTheConversation(pm)
      expect(notice?.text).toContain(
        `${who} closed ${pieceLine(label, title)}: its reply is no longer owed. Stop working on it and do not reply_to_parent about it.`,
      )
      expect(notice?.text).toContain(
        `Its open pieces ${child.label} are still yours: take each back with withdraw_task, or close it with update_work, if it is no longer needed.`,
      )

      // ⚑ A reply owed no more is not taken: the owner's reply is refused and writes no answer.
      const replied = await callOn(worker, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'all done',
      })
      expect(replied.outcome, JSON.stringify(replied)).not.toBe('ok')
      expect(rowsOf(worker, 'work_replied')).toEqual([])

      // ⚑ Nothing can take it back, close it again or brief it: each is refused for the piece having
      // ended, and writes no row and tells nobody.
      await letItSettle()
      const before = tally(worker, pm)
      refusedWith(
        await callOn(pm, 'withdraw_task', { piece: label }),
        'that-piece-was-already-closed',
      )
      for (const args of [
        { piece: label, close: true },
        { piece: label, brief: THE_NEW_BRIEF },
      ]) {
        const refused = refusedWith(await callOn(pm, 'update_work', args), 'that-piece-has-ended')
        expect(refused, JSON.stringify(args)).toMatchObject({
          detail: { piece, label, state: 'closed' },
        })
      }
      await letItSettle()
      expect(tally(worker, pm)).toEqual(before)
      expect(pieceOf(worker, piece).state).toBe('closed')

      // ⚑ The paired positive: a title alone is still taken on a closed piece, and tells nobody.
      const renamed = await callOn(pm, 'update_work', { piece: label, title: 'renamed' })
      expect(renamed.outcome, JSON.stringify(renamed)).toBe('ok')
      await letItSettle()
      expect(tally(worker, pm)).toEqual({ ...before, work_retitled: before.work_retitled! + 1 })
      expect(pieceOf(worker, piece).title).toBe('renamed')
    })

    it('closing a piece whose brief is still held takes the brief back and the piece is closed, not withdrawn', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      const HELD_BRIEF = 'held work text'
      const second = await aGive(pm, 'worker', 'the held piece', HELD_BRIEF)
      // ⚑ D-022 · R3: a give held behind the owner's turn answers `held` (`queued` is `message_agent`'s).
      expect(second.answer.delivery).toBe('held')
      const waiting = pieceOf(worker, second.piece)
      expect(waiting.state).toBe('waiting')
      const messageId = waiting.messageId
      if (messageId === null || messageId === undefined) throw new Error('the give was not held')
      expect(stillHeld(store.events(worker)).map((one) => one.messageId)).toContain(messageId)

      const closed = await callOn(pm, 'update_work', { piece: second.label, close: true })
      expect(closed.outcome, JSON.stringify(closed)).toBe('ok')
      expect(closed).toMatchObject({ state: 'closed', tookBackTheMessage: true })
      expect(pieceOf(worker, second.piece).state).toBe('closed')
      expect(pieceOf(worker, second.piece).state).not.toBe('withdrawn')
      expect(stillHeld(store.events(worker)).map((one) => one.messageId)).not.toContain(messageId)

      // ⚑ The order on the ledger: the close is written FIRST, then the held message is taken back.
      const trail = events(worker)
      const closedAt = trail.findIndex(
        (event) => event.type === 'work_closed' && event.piece === second.piece,
      )
      const takenBackAt = trail.findIndex(
        (event) =>
          event.type === 'message_unqueued' &&
          event.messageId === messageId &&
          event.reason === 'cancelled',
      )
      expect(closedAt).toBeGreaterThanOrEqual(0)
      expect(takenBackAt).toBeGreaterThanOrEqual(0)
      expect(closedAt).toBeLessThan(takenBackAt)

      // ⚑ The paired positive: the first piece is untouched and open, and closing it takes back nothing.
      expect(TASK_IS_OPEN[pieceOf(worker, piece).state]).toBe(true)
      const first = await callOn(pm, 'update_work', { piece: label, close: true })
      expect(first.outcome, JSON.stringify(first)).toBe('ok')
      expect(first).toMatchObject({ state: 'closed', tookBackTheMessage: false })

      // ⚑ The turn ends and what was held for the worker is flushed: the first piece's close reaches
      // it (the positive, through the very flush the held give would have gone with), and the held
      // work never does. 🔴 D-027: the flush hands everything held as ONE turn, so the close is a
      // part of it (both closes are held by now) — read per message, and still never the held work.
      await letTheTurnEnd(worker)
      await waitFor(
        () =>
          read(worker).some(
            (turn) => turn.appNotice === 'a-piece-closed' && turn.text.includes(label),
          ),
        'the flush to hand the worker the close of the first piece',
      )
      expect(saidToProvider(worker).some((said) => said.includes(THE_GIVES_BRIEF))).toBe(true)
      expect(
        saidToProvider(worker).some((said) => said.includes('its reply is no longer owed')),
      ).toBe(true)
      expect(saidToProvider(worker).filter((said) => said.includes(HELD_BRIEF))).toEqual([])
    })

    it('closing a piece ends the questions its owner asked about it, and a title does not', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      const openRequestOf = (): { requestId: string; state: string } => {
        const row = store
          .routedRequestsOf(worker)
          .filter((one) => one.went.is === 'the-parent')
          .at(-1)
        if (row === undefined) throw new Error('the worker asked nothing')
        return row
      }
      const stateOfRequest = (requestId: string): string | undefined =>
        store.routedRequestsOf(worker).find((one) => one.requestId === requestId)?.state

      const asked = await callOn(worker, 'ask_question', {
        who_answers: 'the-parent',
        piece: label,
        question: 'which schema?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      const request = openRequestOf()
      expect(REQUEST_IS_OPEN[request.state as (typeof REQUEST_STATES)[number]]).toBe(true)

      // ⚑ A title ends nothing: the question is still open and the answer names no ended question.
      const renamed = await callOn(pm, 'update_work', { piece: label, title: 'renamed' })
      expect(renamed.outcome, JSON.stringify(renamed)).toBe('ok')
      expect(renamed.endedQuestions).toBeUndefined()
      const stillOpen = stateOfRequest(request.requestId)
      expect(REQUEST_IS_OPEN[stillOpen as (typeof REQUEST_STATES)[number]]).toBe(true)

      // ⚑ A close ends it, as the WORK closing and not the work being withdrawn.
      const closed = await callOn(pm, 'update_work', { piece: label, close: true })
      expect(closed.outcome, JSON.stringify(closed)).toBe('ok')
      expect(closed.endedQuestions).toBe(1)
      expect(stateOfRequest(request.requestId)).toBe('work-closed')
      expect(stateOfRequest(request.requestId)).not.toBe('work-withdrawn')
      expect(pieceOf(worker, piece).state).toBe('closed')

      // ⚑ The worker's own parked card is not the question's business: it is still undecided.
      const cards = events(worker).filter((event) => event.type === 'permission_request')
      const decided = events(worker).filter((event) => event.type === 'user_decision')
      expect(cards.length).toBeGreaterThan(0)
      expect(decided).toEqual([])
    })

    it('update_work refuses a contradictory or malformed brief, close or file list and writes nothing', async () => {
      const { pm, worker, label } = await anIdleWorker()
      const solo = await personOpens('solo')
      const soloRoot = store.rootOf(solo)
      if (soloRoot === null) throw new Error('the person’s conversation owns no root')

      const problemsOf = (answer: Record<string, unknown>): string => {
        const refused = refusedWith(answer, 'malformed-request')
        return (refused.detail?.problems ?? []).join(' | ')
      }
      const a = wrote('a.md', 'alpha\n')
      const tooMany = Array.from({ length: MAX_RESOURCES_PER_REPLY + 1 }, (_, i) => `f${i}.md`)
      const cases: { args: Record<string, unknown>; says: string }[] = [
        {
          args: { piece: label, close: true, brief: 'x' },
          says: 'a piece you close is given no new brief',
        },
        {
          args: { piece: label, close: true, definition_of_done: 'A new condition.' },
          says: "close and definition_of_done can't go together: a closed piece takes no new done condition.",
        },
        {
          args: { piece: label, close: true, resources: [a] },
          says: 'files are kept for a piece that goes on',
        },
        { args: { brief: 'x' }, says: 'piece is required to give a new brief or to close' },
        { args: { close: true }, says: 'piece is required to give a new brief or to close' },
        { args: { piece: label, brief: '   ' }, says: 'must say something' },
        { args: { piece: label, close: 'yes' }, says: 'must be true or false, or absent' },
        { args: { piece: label, resources: 'a.md' }, says: 'must be a list of paths' },
        {
          args: { piece: label, resources: tooMany },
          says: `may name at most ${MAX_RESOURCES_PER_REPLY} files, and it named ${MAX_RESOURCES_PER_REPLY + 1}`,
        },
        {
          args: { piece: label },
          says: 'say title, status, brief, definition_of_done, close, resources, or several',
        },
      ]

      const before = tally(pm, worker, solo)
      const briefBefore = store.piecesOwnedBy(worker).map((one) => one.brief)
      for (const one of cases) {
        expect(
          problemsOf(await callOn(pm, 'update_work', one.args)),
          JSON.stringify(one.args),
        ).toContain(one.says)
      }
      // ⚑ A root's owner may not give its own work a new brief or close it: both are refused. (Its
      // files are kept since D-023, `fe1cee33` — the positive below.)
      for (const args of [
        { piece: soloRoot.label, brief: 'x' },
        { piece: soloRoot.label, close: true },
      ]) {
        refusedWith(await callOn(solo, 'update_work', args), 'that-is-your-own-work')
      }
      await letItSettle()
      expect(tally(pm, worker, solo)).toEqual(before)
      expect(store.piecesOwnedBy(worker).map((one) => one.brief)).toEqual(briefBefore)
      expect(keptHashes()).toEqual([])

      // ⚑ The paired positives: the same door, asked rightly, is taken.
      const titled = await callOn(solo, 'update_work', { piece: soloRoot.label, title: 'my work' })
      expect(titled.outcome, JSON.stringify(titled)).toBe('ok')
      const briefed = await callOn(pm, 'update_work', { piece: label, brief: THE_NEW_BRIEF })
      expect(briefed.outcome, JSON.stringify(briefed)).toBe('ok')
      expect(briefed.rebriefed).toBe(true)
      // ⚑ D-023 (`fe1cee33`): files on a conversation's own root ARE kept, as what it made — the
      // same door that refused its brief and its close above.
      const rootFiles = await callOn(solo, 'update_work', { piece: soloRoot.label, resources: [a] })
      expect(rootFiles.outcome, JSON.stringify(rootFiles)).toBe('ok')
      expect(
        (rootFiles.resources as ReadonlyArray<{ role: string }>).map((one) => one.role),
      ).toEqual(['made'])
      // …and W1's record lists them, as a piece's are (D-023 R1).
      const record = await callOn(solo, 'list_tasks', { piece: soloRoot.label })
      expect(JSON.stringify(record), 'the root record lists no files').toContain('"name":"a.md"')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · files
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · files', () => {
    it("files the giver keeps for a piece are its inputs and the owner is told, while the owner's own are what it made and nobody is told", async () => {
      const { pm, worker, piece, label, title } = await anIdleWorker()
      const inputText = 'the giver’s table\n'
      const madeText = 'the owner’s table\n'
      const a = wrote('a.md', inputText)
      const b = wrote('b.md', madeText)

      // ⚑ The giver's file is an INPUT, and the owner is told what it can read.
      const handed = await callOn(pm, 'update_work', { piece: label, resources: [a] })
      expect(handed.outcome, JSON.stringify(handed)).toBe('ok')
      expect(handed.delivery).toBe('sent')
      expect(handed).not.toHaveProperty('told')
      const kept = handed.resources as { resource: string; name: string }[]
      expect(kept).toHaveLength(1)
      expect(kept[0]?.name).toBe('a.md')
      expect(store.resourcesOf(piece)).toEqual([
        expect.objectContaining({ name: 'a.md', role: 'input', sha256: shaOf(inputText) }),
      ])
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('added files to')),
        'the owner to be told of the new inputs',
      )
      const told = saidToProvider(worker).filter((said) => said.includes('added files to'))
      expect(told).toHaveLength(1)
      expect(told[0]).toContain(
        `${host.whatToCallTheConversation(pm)} added files to ${pieceLine(label, title)}. Its new inputs: ${kept[0]?.resource} (a.md). Read one with read_document.`,
      )
      // ⚑ The owner reads the input back, byte for byte.
      const inputId = kept[0]?.resource as string
      const readBack = await callFull(worker, 'read_document', { resource: inputId })
      expect(readBack.structured).toMatchObject({
        outcome: 'ok',
        role: 'input',
        sha256: shaOf(inputText),
      })
      expect(readBack.text).toContain('the giver’s table')

      // ⚑ The owner's own file is what it MADE, and nobody is told: not the giver, not itself.
      await letItSettle()
      const before = tally(pm, worker)
      const madeAnswer = await callOn(worker, 'update_work', { piece: label, resources: [b] })
      expect(madeAnswer.outcome, JSON.stringify(madeAnswer)).toBe('ok')
      // The answer carries no delivery at all: nobody was sent anything.
      expect(madeAnswer).not.toHaveProperty('delivery')
      expect(madeAnswer).not.toHaveProperty('told')
      expect(store.resourcesOf(piece).map((one) => [one.name, one.role])).toEqual([
        ['a.md', 'input'],
        ['b.md', 'made'],
      ])
      await letItSettle()
      expect(tally(pm, worker)).toEqual(before)

      // ⚑ A file that cannot be read refuses the whole call, with the resource refusal, and writes
      // nothing: not even the title said in the same breath.
      const hashes = keptHashes()
      const rows = store.resourcesOf(piece).length
      const refused = await callOn(pm, 'update_work', {
        piece: label,
        title: 'should not stick',
        resources: [b, join(root, 'missing.md')],
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(typeof refused.rail).toBe('string')
      expect(typeof refused.reason).toBe('string')
      await letItSettle()
      expect(keptHashes()).toEqual(hashes)
      expect(store.resourcesOf(piece)).toHaveLength(rows)
      expect(pieceOf(worker, piece).title).toBe(title)
      expect(tally(pm, worker)).toEqual(before)
    })

    it("give_work inputs are kept as the piece's inputs, and one that cannot be read refuses the whole give", async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      const aText = 'the table to migrate\n'
      const a = wrote('a.md', aText)

      const given = await aGive(pm, 'worker', 'with inputs', THE_GIVES_BRIEF, { inputs: [a] })
      const worker = given.agent
      host.claimSession(worker, window)
      const inputs = given.answer.inputs as { resource: string; name: string }[]
      expect(inputs).toHaveLength(1)
      expect(inputs[0]?.name).toBe('a.md')
      expect(store.resourcesOf(given.piece)).toEqual([
        expect.objectContaining({ name: 'a.md', role: 'input', sha256: shaOf(aText) }),
      ])
      await waitFor(() => saidToProvider(worker).length > 0, 'the worker’s first turn')
      expect(saidToProvider(worker)[0]).toContain(`Its inputs: ${inputs[0]?.resource} (a.md)`)

      // ⚑ Its own file is what it made: a later brief names the INPUTS and never the made file.
      const c = wrote('c.md', 'the worker’s own notes\n')
      await waitFor(() => cardsOn(worker) > 0, 'the worker to park')
      const kept = await callOn(worker, 'update_work', { piece: given.label, resources: [c] })
      expect(kept.outcome, JSON.stringify(kept)).toBe('ok')
      expect(store.resourcesOf(given.piece).map((one) => [one.name, one.role])).toEqual([
        ['a.md', 'input'],
        ['c.md', 'made'],
      ])
      await letTheTurnEnd(worker)
      await waitFor(() => isIdle(worker), 'the worker to go idle')
      const briefed = await callOn(pm, 'update_work', { piece: given.label, brief: THE_NEW_BRIEF })
      expect(briefed.outcome, JSON.stringify(briefed)).toBe('ok')
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('sends you the new brief of')),
        'the worker to be handed the new brief',
      )
      const rebrief = saidToProvider(worker).find((said) =>
        said.includes('sends you the new brief of'),
      )
      expect(rebrief).toContain(`(a.md)`)
      expect(rebrief).not.toContain('c.md')

      // ⚑ One input that cannot be read refuses the whole give: no piece, no conversation, no file.
      const b = wrote('b.md', 'a table that would be kept\n')
      const sessions = counter
      const spawned = handles.length
      const pieces = store.piecesOwnedBy(worker).length
      const hashes = keptHashes()
      const refused = await callOn(pm, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'never begun',
        brief: 'never sent',
        inputs: [b, join(root, 'missing.md')],
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(typeof refused.rail).toBe('string')
      expect(typeof refused.reason).toBe('string')
      await letItSettle()
      expect(counter).toBe(sessions)
      expect(handles.length).toBe(spawned)
      expect(store.piecesOwnedBy(worker)).toHaveLength(pieces)
      expect(keptHashes()).toEqual(hashes)
      expect(saidToProvider(worker).some((said) => said.includes('never sent'))).toBe(false)

      // ⚑ The paired positive: a give with no inputs is taken, says no inputs and keeps no file.
      const plain = await aGive(pm, 'worker', 'without inputs', 'plain work')
      expect(plain.answer.inputs).toBeUndefined()
      expect(store.resourcesOf(plain.piece)).toEqual([])
      expect(keptHashes()).toEqual(hashes)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the push taken back
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the push a giver holds', () => {
    const TAKEN_BACK = 'taken back by this app before it was read, because it was no longer true: '

    /**
     * ⚑ A parent MID-TURN when its child's turn ends with the piece open, so *"…is not being worked
     * on"* is HELD for it (`what-a-waker-reads-after-its-own-act`'s rig).
     */
    const aBusyParentHoldingThePush = async (suffix: string) => {
      const made = await aPmAndItsWorker(suffix)
      await host.send(made.pm, 'keep an eye on the migration', window)
      await waitFor(() => cardsOn(made.pm) > 0, 'the parent to park mid-turn')
      await letTheTurnEnd(made.worker)
      await waitFor(
        () => held(made.pm).some((text) => isGiverStallNotice(text)),
        'the push to be held for the busy parent',
      )
      return made
    }
    const pushesRead = (pm: string): string[] =>
      read(pm)
        .map((turn) => turn.text)
        .filter((text) => isGiverStallNotice(text))
    const pushStillHeld = (pm: string): boolean =>
      stillHeld(store.events(pm)).some((one) => isGiverStallNotice(one.text))

    it("a close, and a brief that was sent, take back the giver's held is-not-being-worked-on push, and a title or a held brief does not", async () => {
      // ⚑ (a) A close: the work is closed, so it is no longer true that it waits for someone.
      const closing = await aBusyParentHoldingThePush('-close')
      expect(pushStillHeld(closing.pm)).toBe(true)
      const closed = await callOn(closing.pm, 'update_work', { piece: closing.label, close: true })
      expect(closed.outcome, JSON.stringify(closed)).toBe('ok')
      expect(unqueued(closing.pm)).toMatchObject([
        {
          reason: 'retracted',
          text: expect.stringContaining(`${closing.label} still needs attention:`),
          detail: `${TAKEN_BACK}this conversation closed that work`,
        },
      ])
      expect(pushStillHeld(closing.pm)).toBe(false)
      await letTheTurnEnd(closing.pm)
      await waitFor(
        () => read(closing.pm).some((turn) => turn.text === 'keep an eye on the migration'),
        'the parent to have read its own message',
      )
      expect(pushesRead(closing.pm)).toEqual([])

      // ⚑ (b) A brief that was SENT: the owner is at work on new words, so the push is no longer true.
      const briefing = await aBusyParentHoldingThePush('-brief')
      expect(pushStillHeld(briefing.pm)).toBe(true)
      const sent = await callOn(briefing.pm, 'update_work', {
        piece: briefing.label,
        brief: THE_NEW_BRIEF,
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      const holder = host.whatToCallTheConversation(briefing.worker)
      expect(unqueued(briefing.pm)).toMatchObject([
        {
          reason: 'retracted',
          detail: `${TAKEN_BACK}this conversation gave ${holder} a new brief for that work`,
        },
      ])
      // ⚑ No receipt is written beside the take-back: the push's own stands as the telling, so the
      // giver still counts as told about the piece and nothing is owed to it again.
      expect(giverStallReceipts(store, briefing.pm)).toEqual([
        expect.objectContaining({ piece: briefing.piece, step: 'giver', outcome: 'delivered' }),
      ])
      await letTheTurnEnd(briefing.pm)
      expect(pushesRead(briefing.pm)).toEqual([])

      // ⚑ (c) Controls: a title makes nothing false, so the push is still held, and it is read.
      const titling = await aBusyParentHoldingThePush('-title')
      const renamed = await callOn(titling.pm, 'update_work', {
        piece: titling.label,
        title: 'renamed',
      })
      expect(renamed.outcome, JSON.stringify(renamed)).toBe('ok')
      await letItSettle()
      expect(unqueued(titling.pm)).toEqual([])
      expect(pushStillHeld(titling.pm)).toBe(true)
      await letTheTurnEnd(titling.pm)
      await waitFor(() => pushesRead(titling.pm).length > 0, 'the push to be read')
      expect(pushesRead(titling.pm)).toHaveLength(1)

      // ⚑ (c') A brief that is only HELD (its owner is busy) makes nothing false either.
      const holding = await aBusyParentHoldingThePush('-held')
      await host.send(holding.worker, 'go on with it', window)
      await waitFor(() => !isIdle(holding.worker), 'the worker to take a turn again')
      // ⚑ The premise, from the same reader: the person's words did not take the push back.
      expect(pushStillHeld(holding.pm)).toBe(true)
      expect(unqueued(holding.pm)).toEqual([])
      const turns = turnsOn(holding.worker)
      const heldBrief = await callOn(holding.pm, 'update_work', {
        piece: holding.label,
        brief: THE_NEW_BRIEF,
      })
      expect(heldBrief.outcome, JSON.stringify(heldBrief)).toBe('ok')
      expect(rowsOf(holding.worker, 'message_queued').some((one) => one.rebrief === true)).toBe(
        true,
      )
      expect(turnsOn(holding.worker)).toBe(turns)
      await letItSettle()
      expect(unqueued(holding.pm).filter((one) => one.reason === 'retracted')).toEqual([])
      expect(pushStillHeld(holding.pm)).toBe(true)
      await letTheTurnEnd(holding.pm)
      await waitFor(() => unqueued(holding.pm).length > 0, 'the held push to be settled')
      // The person's turn raised an approval card, a valid conversation-wide wait.
      expect(unqueued(holding.pm).map((one) => one.reason)).toEqual(['retracted'])
      expect(store.reconciliationReceipts(holding.worker, holding.piece).at(-1)?.step).toBe(
        'resolved',
      )
      expect(pushesRead(holding.pm)).toEqual([])
    })
  })
})
