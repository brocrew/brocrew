import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import {
  applyEvent,
  createTranscript,
  type QueuedItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import {
  theMessagesOf,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # D-022 · a giver's correction reaches the owner, and the verbs say what really happened
 *
 * A giver that gave a piece to a busy owner has it HELD, and BroBot's test after the reset (F029)
 * corrected the brief while it was held: the answer said *told*, the held give then went out with
 * the OLD brief, and the correction was dropped. This file pins the four things that came of it, over
 * a real `RuntimeHost` and a real ledger on the Fake provider, and the two renderer readers of the
 * row that names the message:
 *
 *  - **§1 · R1, a new brief of a piece whose give still waits RIDES that give** — the row names the
 *    held message, nothing else is queued, and the give goes out once with the newest brief; a piece
 *    whose give has been handed over is briefed by a message of its own, and two of those keep their
 *    own words and their order — ⚑ D-027 · in ONE turn, each its own part.
 *  - **§2 · R2, a reply given while a new brief is held** says it answers the brief before it.
 *  - **§3 · R3, the verbs' answers are true** — a close, a take back and a file handed over say
 *    `sent` to a free owner and `held` behind a running turn, and a held stop adds the way out.
 *  - **§4 · R4, a piece whose give still waits is not one its owner gives from, updates or asks about
 *    unnamed** — and of several that have reached it, the one its turn drives is chosen.
 *  - **§5 · the renderer**: the held card takes the new words when the row names its message, and
 *    the raw event line says which give a new brief rides.
 *
 * ⚑ A negative is paired with a positive from the same reader, and a presence is asserted before an
 * order or a text.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** ⛔ None of these is a substring of another, or of a sentence the app frames them in. */
const FIRST_BRIEF = 'read the first table'
const SECOND_GIVE_BRIEF = 'copy the second column over'
const THIRD_GIVE_BRIEF = 'sum the third total'
const CORRECTION = 'use the newer schema instead'
const B1 = 'fix one: rename the ledger'
const B2 = 'fix two: drop the archive'

/**
 * What the provider is handed a new brief inside of, when it is a message of its own. ⚑ D-027 · a
 * message, no longer a turn: held, it goes with whatever else is held, each under its own frame.
 */
const A_NEW_BRIEF_TURN = 'sends you the new brief of'

type Refused = { outcome: string; rail: string; detail?: { held?: string[] } }

describe('D-022 · a giver’s correction reaches the owner, and the verbs say what happened', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d022-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d022-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_220_000
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
   * What a conversation READ: every message it was handed, oldest first. ⚑ **D-027 · read per
   * message** ({@link theMessagesOf}): a turn that delivered several carries each as a part, and its
   * own `text` is their words joined — so a turn read whole would find neither piece nor label.
   */
  const read = (id: string): { text: string; piece?: string; label?: string }[] =>
    events(id).flatMap((event) =>
      event.type === 'user_turn'
        ? theMessagesOf(event).map((one) => ({
            text: one.text,
            ...(one.piece === undefined ? {} : { piece: one.piece }),
            ...(one.label === undefined ? {} : { label: one.label }),
          }))
        : [],
    )

  const rowsOf = <T extends TranscriptEvent['type']>(
    id: string,
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] =>
    events(id).filter(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )

  const pieceOf = (owner: string, piece: string) => {
    const found = store.piecesOwnedBy(owner).find((one) => one.piece === piece)
    if (found === undefined) throw new Error(`${owner} owns no piece ${piece}`)
    return found
  }

  /** A give, answered `ok`. */
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
    const given = await aGive(pm, `worker${suffix}`, title, FIRST_BRIEF)
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

  /** The same, then busy on a turn of its own that asks nobody anything. */
  const aBusyWorker = async (suffix = '') => {
    const made = await anIdleWorker(suffix)
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no worker was started')
    handle.simulateThinking({ text: 'reading the code', redacted: false })
    await waitFor(() => !isIdle(made.worker), 'the worker to be working')
    return made
  }

  /**
   * ⚑ **The rig every R1 case starts from**: the worker is parked on its first piece's card, and
   * the PM gives it a SECOND piece, which is therefore HELD behind that turn — the same agent, and
   * the answer says `held`, not `queued`.
   */
  const aWorkerWithAHeldSecondGive = async (suffix = '', brief = SECOND_GIVE_BRIEF) => {
    const made = await aPmAndItsWorker(suffix)
    const second = await aGive(made.pm, `worker${suffix}`, 'the second piece', brief)
    expect(second.agent).toBe(made.worker)
    expect(second.answer.delivery, JSON.stringify(second.answer)).toBe('held')
    const message = rowsOf(made.worker, 'message_queued').find((one) => one.piece === second.piece)
    if (message?.messageId === undefined) throw new Error('the second give was not held')
    return { ...made, second, giveMessageId: message.messageId }
  }

  const wrote = (name: string, content: Buffer | string): string => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  }

  const refusedWith = (answer: Record<string, unknown>, rail: string): Refused => {
    expect(answer.outcome, JSON.stringify(answer)).toBe('refused')
    expect(answer.rail, JSON.stringify(answer)).toBe(rail)
    return answer as unknown as Refused
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · R1 — a new brief of a piece whose give still waits
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a new brief', () => {
    it('R1 · a new brief of a piece whose give still waits rides that give: the row names the held message, nothing else is queued, and the give goes out once with the newest brief', async () => {
      const { pm, worker, second, giveMessageId } = await aWorkerWithAHeldSecondGive()
      const queuedBefore = rowsOf(worker, 'message_queued').length
      expect(pieceOf(worker, second.piece).state).toBe('waiting')
      expect(pieceOf(worker, second.piece).brief).toBe(SECOND_GIVE_BRIEF)

      const corrected = await callFull(pm, 'update_work', {
        piece: second.label,
        brief: CORRECTION,
      })
      expect(corrected.structured.outcome, JSON.stringify(corrected.structured)).toBe('ok')
      expect(corrected.structured.rebriefed).toBe(true)
      // ⚑ The answer is the give's: held, in the vocabulary of the piece verbs, and no `told`.
      expect(corrected.structured.delivery).toBe('held')
      expect(corrected.structured).not.toHaveProperty('told')
      expect(corrected.text).toContain(`the give of ${second.label} is still held`)
      expect(corrected.text).toContain('in place of the first')
      expect(corrected.text).not.toContain('has been told.')

      // ⚑ The ledger: one row, the new words as said, by the giver, naming the message it rides.
      expect(rowsOf(worker, 'work_rebriefed')).toEqual([
        {
          type: 'work_rebriefed',
          piece: second.piece,
          brief: CORRECTION,
          by: pm,
          messageId: giveMessageId,
        },
      ])
      // ⚑ Nothing of its own was queued, and none of what is queued is marked a new brief.
      expect(rowsOf(worker, 'message_queued')).toHaveLength(queuedBefore)
      expect(rowsOf(worker, 'message_queued').filter((one) => one.rebrief === true)).toEqual([])
      // ⚑ The fold reads the newest brief, and the piece still waits for its give.
      expect(pieceOf(worker, second.piece).brief).toBe(CORRECTION)
      expect(pieceOf(worker, second.piece).state).toBe('waiting')

      // ⛔ The owner is busy: neither the correction nor the give has reached it or the provider.
      await letItSettle()
      expect(saidToProvider(worker).some((said) => said.includes(CORRECTION))).toBe(false)
      expect(read(worker).filter((turn) => turn.piece === second.piece)).toEqual([])

      // ⚑ The turn ends: the give goes out ONCE, as the turn, with the newest brief and no other.
      await letTheTurnEnd(worker)
      await waitFor(
        () => read(worker).some((turn) => turn.piece === second.piece),
        'the held give to be handed over',
      )
      expect(read(worker).filter((turn) => turn.piece === second.piece)).toEqual([
        expect.objectContaining({ text: CORRECTION, piece: second.piece, label: second.label }),
      ])
      expect(read(worker).some((turn) => turn.text.includes(A_NEW_BRIEF_TURN))).toBe(false)
      expect(saidToProvider(worker).filter((said) => said.includes(CORRECTION))).toHaveLength(1)
      expect(saidToProvider(worker).some((said) => said.includes(SECOND_GIVE_BRIEF))).toBe(false)
      const ending = events(worker).find(
        (event) => event.type === 'message_unqueued' && event.messageId === giveMessageId,
      )
      expect(ending).toMatchObject({ reason: 'sent' })
    })

    it('R1 · a new brief of a piece whose give has reached its owner is its own held message and names no message', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      // ⚑ The premise: the first piece's give was handed over as the running turn, so nothing of it waits.
      expect(read(worker).some((turn) => turn.piece === piece)).toBe(true)
      const queuedBefore = rowsOf(worker, 'message_queued').length

      const briefed = await callFull(pm, 'update_work', { piece: label, brief: B1 })
      expect(briefed.structured.outcome, JSON.stringify(briefed.structured)).toBe('ok')
      expect(briefed.structured.delivery).toBe('held')
      // ⚑ Its owner's turn is stopped on a person's card, so the answer says what the brief waits for.
      expect(briefed.text).toContain(
        'the new brief is held. Its turn is stopped until a person answers its request to use Bash',
      )
      expect(briefed.text).not.toContain('as its own turn')
      expect(briefed.text).not.toContain('in place of the first')
      expect(briefed.text).not.toContain('interrupt_agent')

      // ⚑ The row names no message, and exactly one message of its own was queued, marked a new brief.
      const rows = rowsOf(worker, 'work_rebriefed')
      expect(rows).toEqual([{ type: 'work_rebriefed', piece, brief: B1, by: pm }])
      expect(rows[0]).not.toHaveProperty('messageId')
      const queued = rowsOf(worker, 'message_queued')
      expect(queued).toHaveLength(queuedBefore + 1)
      expect(queued.filter((one) => one.rebrief === true)).toEqual([
        expect.objectContaining({ piece, label, text: B1 }),
      ])

      // ⚑ The turn ends: the provider hears it framed as the giver's new brief of the piece.
      await letTheTurnEnd(worker)
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes(A_NEW_BRIEF_TURN)),
        'the held new brief to reach the provider',
      )
      const heard = saidToProvider(worker).filter((said) => said.includes(A_NEW_BRIEF_TURN))
      expect(heard).toHaveLength(1)
      expect(heard[0]).toContain(B1)
    })

    it('R1 · two new briefs held for one piece go out in order, each with its own words', async () => {
      const { pm, worker, piece, label } = await aPmAndItsWorker()
      for (const brief of [B1, B2]) {
        const briefed = await callOn(pm, 'update_work', { piece: label, brief })
        expect(briefed.outcome, JSON.stringify(briefed)).toBe('ok')
        expect(briefed.delivery).toBe('held')
      }
      // ⚑ Two messages of their own, both marked, and the fold reads the newest.
      expect(rowsOf(worker, 'message_queued').filter((one) => one.rebrief === true)).toHaveLength(2)
      expect(pieceOf(worker, piece).brief).toBe(B2)
      await letItSettle()
      expect(saidToProvider(worker).some((said) => said.includes(B1))).toBe(false)

      // ⚑ **D-027 · the turn ends: BOTH go, in ONE turn, the first first** — this read *"the first
      // brief is handed over … and not the second. Its turn ends: the second follows"*. ⛔ Each
      // still carries its OWN words: the first is never replaced by the fold's newest.
      await letTheTurnEnd(worker)
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes(B1)),
        'the new briefs to reach the provider',
      )
      const carrying = saidToProvider(worker).filter(
        (said) => said.includes(B1) || said.includes(B2),
      )
      expect(carrying).toHaveLength(1)
      const [both = ''] = carrying
      expect(both.indexOf(B1)).toBeGreaterThan(-1)
      expect(both.indexOf(B1)).toBeLessThan(both.indexOf(B2))
      // ⚑ Each framed as the giver's new brief of the piece, on its own.
      expect(both.split(A_NEW_BRIEF_TURN)).toHaveLength(3)

      // ⚑ The ledger: ONE turn, a part for each, in order, each naming the piece.
      const together = rowsOf(worker, 'user_turn').filter((turn) =>
        theMessagesOf(turn).some((one) => one.text === B1 || one.text === B2),
      )
      expect(together).toHaveLength(1)
      expect(together[0]?.parts?.map((one) => [one.text, one.piece, one.label])).toEqual([
        [B1, piece, label],
        [B2, piece, label],
      ])
      const turns = read(worker)
        .map((turn) => turn.text)
        .filter((text) => text === B1 || text === B2)
      expect(turns).toEqual([B1, B2])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · R2 — a reply given while a new brief is held
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a reply', () => {
    it('R2 · a reply given while a new brief of the piece is held says it answers the brief before it, and a reply with none held says nothing of the kind', async () => {
      const summary = 'the tables are done'
      const answeredText = async (suffix: string, withANewBrief: boolean): Promise<string> => {
        const { pm, worker, piece, label } = await aPmAndItsWorker(suffix)
        if (withANewBrief) {
          const briefed = await callOn(pm, 'update_work', { piece: label, brief: CORRECTION })
          expect(briefed.outcome, JSON.stringify(briefed)).toBe('ok')
          expect(briefed.delivery).toBe('held')
        }
        const replied = await callOn(worker, 'reply_to_parent', {
          piece: label,
          outcome: 'done',
          summary,
        })
        expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
        expect(pieceOf(worker, piece).state).toBe('answered')
        await waitFor(
          () => read(pm).some((turn) => turn.text.includes('was answered by')),
          `the giver to read the answer (${suffix})`,
        )
        const text = read(pm).find((turn) => turn.text.includes('was answered by'))?.text
        if (text === undefined) throw new Error('the giver read no answer')
        return text
      }

      // Rig e: the correction is held when the owner answers.
      const withHeld = await answeredText('e', true)
      expect(withHeld).toContain(summary)
      expect(withHeld).toContain(
        'This answers the brief before your new one, which had not reached',
      )
      expect(withHeld).toContain('when it answered')

      // Rig f, the paired positive: the same reply with no new brief held says nothing of the kind.
      const withNone = await answeredText('f', false)
      expect(withNone).toContain(summary)
      expect(withNone).toContain('was answered by')
      expect(withNone).not.toContain('This answers the brief before your new one')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · R3 — the verbs say what happened
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · what the verbs answer', () => {
    it('R3 · a close, a take-back and a file handed over say sent to a free owner and held behind a running turn, and a held stop adds that interrupt_agent asks the turn to stop', async () => {
      // ⚑ **D-027 moved the way out's words** — this read *"interrupt_agent asks that turn to stop
      // now"*: what is held goes when the owner is FREE, which a person's command held ahead makes
      // later than this turn's end, so the turn a stop is asked of is named as the one running now.
      const STOP = /interrupt_agent asks the turn (\S+) is running now to stop\.$/
      /** ⛔ The way out names the SAME owner the answer says is not told yet. */
      const namesTheOwnerItHolds = (text: string): void => {
        const owner = /(\S+) is not told yet/.exec(text)?.[1]
        expect(owner).toBeDefined()
        expect(STOP.exec(text)?.[1]).toBe(owner)
      }

      // (a) A close, its owner FREE: told, and it says so.
      const free = await anIdleWorker('a')
      const closedFree = await callFull(free.pm, 'update_work', { piece: free.label, close: true })
      expect(closedFree.structured.outcome, JSON.stringify(closedFree.structured)).toBe('ok')
      expect(closedFree.structured.delivery).toBe('sent')
      expect(closedFree.structured).not.toHaveProperty('told')
      expect(closedFree.text).toContain('has been told.')
      expect(closedFree.text).not.toContain('is not told yet')

      // (b) A close, its owner BUSY: held, and the way out is named.
      const busy = await aBusyWorker('b')
      const closedBusy = await callFull(busy.pm, 'update_work', { piece: busy.label, close: true })
      expect(closedBusy.structured.outcome, JSON.stringify(closedBusy.structured)).toBe('ok')
      expect(closedBusy.structured.delivery).toBe('held')
      expect(closedBusy.structured).not.toHaveProperty('told')
      expect(closedBusy.text).toContain('is not told yet')
      expect(closedBusy.text).toMatch(STOP)
      namesTheOwnerItHolds(closedBusy.text)
      expect(closedBusy.text).not.toContain('has been told.')

      // (c) A take back, its owner BUSY: the same word and the same way out.
      const taking = await aBusyWorker('c')
      const taken = await callFull(taking.pm, 'withdraw_task', { piece: taking.label })
      expect(taken.structured.outcome, JSON.stringify(taken.structured)).toBe('ok')
      expect(taken.structured.delivery).toBe('held')
      expect(taken.structured).not.toHaveProperty('told')
      expect(taken.text).toContain('is not told yet')
      expect(taken.text).toMatch(STOP)
      namesTheOwnerItHolds(taken.text)

      // (d) A file handed over, its owner BUSY: held, and NO stop is asked for — files wait.
      const handing = await aBusyWorker('d')
      const path = wrote('inputs.md', 'the giver’s table\n')
      const handed = await callFull(handing.pm, 'update_work', {
        piece: handing.label,
        resources: [path],
      })
      expect(handed.structured.outcome, JSON.stringify(handed.structured)).toBe('ok')
      expect(handed.structured.delivery).toBe('held')
      expect(handed.structured).not.toHaveProperty('told')
      expect(handed.text).toContain('is not told yet: it is held until')
      expect(handed.text).not.toContain('interrupt_agent')

      // (e) A take back, its owner's turn stopped on a person's card: held, and the person's answer
      // is what it waits for — no stop is offered, since none can be asked of that turn.
      const parked = await aPmAndItsWorker('e')
      const takenParked = await callFull(parked.pm, 'withdraw_task', { piece: parked.label })
      expect(takenParked.structured.delivery).toBe('held')
      expect(takenParked.text).toContain(
        'is not told yet: it is held. Its turn is stopped until a person answers',
      )
      expect(takenParked.text).not.toContain('interrupt_agent')

      // (f) A new brief, its owner BUSY on a turn of its own: held until it is free.
      const rebriefing = await aBusyWorker('f')
      const rebriefed = await callFull(rebriefing.pm, 'update_work', {
        piece: rebriefing.label,
        brief: B1,
      })
      expect(rebriefed.structured.delivery).toBe('held')
      expect(rebriefed.text).toMatch(
        /is not told yet: the new brief is held until \S+ is free, then goes out with whatever else is held for it/,
      )
      expect(rebriefed.text).not.toContain('interrupt_agent')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · R4 — a piece whose give still waits has not reached its owner
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · which piece is meant', () => {
    it('R4 · a piece whose give still waits is not one the owner gives from, updates or asks about unnamed, and naming it still resolves', async () => {
      const { pm, worker, piece: first, label: firstLabel } = await anIdleWorker()
      // ⚑ The running turn is the person's own message: it drives no piece at all.
      await host.send(worker, 'look around', window)
      await waitFor(() => cardsOn(worker) >= 2, 'the worker to park on the person’s message')
      const second = await aGive(pm, 'worker', 'the second piece', SECOND_GIVE_BRIEF)
      expect(second.agent).toBe(worker)
      expect(second.answer.delivery, JSON.stringify(second.answer)).toBe('held')
      expect(pieceOf(worker, second.piece).state).toBe('waiting')
      await bringIdentityIntoBeing('helper')

      // ⚑ Unnamed, the give hangs under the one piece that has reached the owner — not the held one.
      const unnamed = await callOn(worker, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'a smaller piece',
        brief: 'do the small part',
      })
      expect(unnamed.outcome, JSON.stringify(unnamed)).toBe('ok')
      expect(store.workById(unnamed.piece as string)?.parent).toBe(first)

      // ⚑ The paired positive: naming the held piece still resolves, and hangs under IT.
      const named = await callOn(worker, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'another smaller piece',
        brief: 'do the other small part',
        piece: second.label,
      })
      expect(named.outcome, JSON.stringify(named)).toBe('ok')
      expect(store.workById(named.piece as string)?.parent).toBe(second.piece)

      // ⚑ Unnamed, a status line lands on the piece that reached it.
      const status = await callOn(worker, 'update_work', { status: 'halfway' })
      expect(status.outcome, JSON.stringify(status)).toBe('ok')
      expect(status.label).toBe(firstLabel)
      expect(rowsOf(worker, 'work_status_set')).toEqual([
        expect.objectContaining({ piece: first, line: 'halfway', by: worker }),
      ])

      // ⚑ Unnamed, a question to the parent is about that piece too.
      const asked = await callOn(worker, 'ask_question', {
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      expect(asked.went_to).toBe('the-parent')
      expect(rowsOf(worker, 'question_asked')).toEqual([
        expect.objectContaining({ piece: first, prompt: 'which schema?' }),
      ])
    })

    it('R4 · of two pieces that have reached the giver an unnamed give hangs under the one its turn drives, and a turn that drives none is refused naming only the pieces that reached it', async () => {
      const { pm, worker, label: firstLabel } = await aPmAndItsWorker()
      const second = await aGive(pm, 'worker', 'the second piece', SECOND_GIVE_BRIEF)
      expect(second.answer.delivery, JSON.stringify(second.answer)).toBe('held')
      await bringIdentityIntoBeing('helper')

      // ⚑ Turn 2 is the second piece's own give: it has now reached the owner, and the turn drives it.
      await letTheTurnEnd(worker)
      await waitFor(
        () => read(worker).some((turn) => turn.piece === second.piece) && cardsOn(worker) >= 2,
        'the second piece’s turn to park',
      )
      const driven = await callOn(worker, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'a smaller piece',
        brief: 'do the small part',
      })
      expect(driven.outcome, JSON.stringify(driven)).toBe('ok')
      expect(store.workById(driven.piece as string)?.parent).toBe(second.piece)
      expect(driven.label).toBe(`${second.label}.1`)

      // ⚑ Turn 3 is the person's own message: it drives nothing, and a third piece is held behind it.
      await letTheTurnEnd(worker)
      await host.send(worker, 'and now?', window)
      await waitFor(() => cardsOn(worker) >= 3, 'the worker to park on the person’s message')
      const third = await aGive(pm, 'worker', 'the third piece', THIRD_GIVE_BRIEF)
      expect(third.answer.delivery, JSON.stringify(third.answer)).toBe('held')

      const refused = refusedWith(
        await callOn(worker, 'give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'helper',
          title: 'never begun',
          brief: 'never sent',
        }),
        'name-the-piece-you-give-from',
      )
      // ⚑ It names the two that have reached the owner, and not the held third.
      expect([...(refused.detail?.held ?? [])].sort()).toEqual([firstLabel, second.label].sort())
      expect(refused.detail?.held).not.toContain(third.label)

      // ⚑ The paired positive: naming the held third piece is taken, and hangs under it.
      const named = await callOn(worker, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'helper',
        title: 'under the third',
        brief: 'do the third part',
        piece: third.label,
      })
      expect(named.outcome, JSON.stringify(named)).toBe('ok')
      expect(store.workById(named.piece as string)?.parent).toBe(third.piece)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the renderer
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the held card and the raw line', () => {
    const OLD_WORDS = 'the words the give was queued with'
    const NEW_WORDS = 'the words of the newest brief'

    const queuedItems = (state: TranscriptState): QueuedItem[] =>
      state.items.filter((item): item is QueuedItem => item.kind === 'queued')

    /** A transcript holding one give, waiting, under the id `m1`. */
    const aHeldGive = (): TranscriptState => {
      const state = createTranscript()
      applyEvent(state, { type: 'message_queued', text: OLD_WORDS, messageId: 'm1' })
      return state
    }

    it('R1 · a work_rebriefed that names the held give rewrites the held card, and one that names none, an unknown message or a card already ended leaves it', () => {
      // ⚑ The premise, from the same reader: one card, waiting, with the old words.
      const state = aHeldGive()
      expect(queuedItems(state)).toEqual([
        expect.objectContaining({ text: OLD_WORDS, messageId: 'm1', outcome: null }),
      ])

      // ⚑ The row names the held give: the card reads the newest brief.
      applyEvent(state, {
        type: 'work_rebriefed',
        piece: 'work_1',
        brief: NEW_WORDS,
        by: 'sess_parent',
        messageId: 'm1',
      })
      expect(queuedItems(state)).toHaveLength(1)
      expect(queuedItems(state)[0]?.text).toBe(NEW_WORDS)

      // ⛔ …and each of these leaves the words alone.
      const leaves = (name: string, prepare: (into: TranscriptState) => void): void => {
        const other = aHeldGive()
        prepare(other)
        expect(queuedItems(other), name).toEqual([
          expect.objectContaining({ text: OLD_WORDS, messageId: 'm1' }),
        ])
      }
      leaves('a row that names no message', (into) =>
        applyEvent(into, {
          type: 'work_rebriefed',
          piece: 'work_1',
          brief: NEW_WORDS,
          by: 'sess_parent',
        }),
      )
      leaves('a row that names a message this card is not', (into) =>
        applyEvent(into, {
          type: 'work_rebriefed',
          piece: 'work_1',
          brief: NEW_WORDS,
          by: 'sess_parent',
          messageId: 'm_other',
        }),
      )
      leaves('a card that has already ended', (into) => {
        applyEvent(into, {
          type: 'message_unqueued',
          messageId: 'm1',
          reason: 'cancelled',
          text: OLD_WORDS,
        })
        applyEvent(into, {
          type: 'work_rebriefed',
          piece: 'work_1',
          brief: NEW_WORDS,
          by: 'sess_parent',
          messageId: 'm1',
        })
      })
    })

    it('R1 · the raw event line says which held give a new brief rides, and says nothing when it rides none', () => {
      const riding = describeEvent({
        type: 'work_rebriefed',
        piece: 'work_1',
        brief: NEW_WORDS,
        by: 'sess_parent',
        messageId: 'm1',
      })
      const alone = describeEvent({
        type: 'work_rebriefed',
        piece: 'work_1',
        brief: NEW_WORDS,
        by: 'sess_parent',
      })
      // ⚑ Both are the same row: the piece and the words are on each, so the difference is the ride.
      expect(riding).toContain('work_1')
      expect(alone).toContain('work_1')
      expect(riding).toContain(' · rides m1')
      expect(alone).not.toContain('rides')
    })
  })
})
