import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { giverStallReceipts, isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { UNDRIVEN_SENTENCES } from '../src/shared/tasks'
import { theMessagesOf } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('what a waker reads after its own act', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  const tick = (): number => clock++

  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-703-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-703-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_030_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ `646` §2's restart — a graceful quit, then a new host over a new `SessionStore` object. */
  const relaunch = async (): Promise<void> => {
    await host.closeAll()
    host = buildHost(createSessionStore(db, tick))
  }

  const ledger = (sessionId: string) => store.events(sessionId)
  const events = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).map((entry) => entry.event)

  /** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
  const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const cardsOn = (id: string): number =>
    events(id).filter((event) => event.type === 'permission_request').length

  /** ⚑ Let the turn a conversation is parked in end — the person answers its last card. */
  const letTheTurnEnd = async (id: string): Promise<void> => {
    const card = events(id)
      .filter((event) => event.type === 'permission_request')
      .at(-1) as { id: string } | undefined
    if (card === undefined) throw new Error(`${id} is not parked`)
    await host.respondPermission(id, card.id, { outcome: 'allow' }, window)
    await letItSettle()
  }

  const receipts = (pm: string): unknown[] => giverStallReceipts(store, pm)
  /** ⚑ What is HELD for a conversation, in the order it was queued. */
  const held = (id: string): string[] =>
    events(id).flatMap((event) => (event.type === 'message_queued' ? [event.text] : []))
  /**
   * ⚑ What a conversation has READ — every message of every turn it was handed. 🔴 **D-027** — a
   * turn of several carries each message as a `part`, its own `text` the words joined, so a turn is
   * read message by message through `theMessagesOf`.
   */
  const read = (id: string): string[] =>
    events(id).flatMap((event) =>
      event.type === 'user_turn' ? theMessagesOf(event).map((message) => message.text) : [],
    )
  const unqueued = (pm: string): { reason: string; text: string; detail?: string }[] =>
    events(pm).flatMap((event) =>
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
  /**
   * ⚑ **D-016c — the notice a Close pushes** is the stall on the turn the Close cut: *"…is not being
   * worked on: the turn it was running in was stopped"* ({@link UNDRIVEN_SENTENCES}'
   * `turn_interrupted`). ⛔ A stop moves no piece; the turn's own ending does.
   */
  const saysItStopped = (text: string): boolean =>
    isGiverStallNotice(text) && text.includes(UNDRIVEN_SENTENCES.turn_interrupted)
  /**
   * ⚑ **D-016 · a child given a piece** — `give_work` starts it, and its brief (`go`, or `migrate`)
   * is its first turn; a person's window is put on it. Returns the child, its piece's id and label.
   */
  const giveAChild = async (
    pm: string,
    profile: string,
    brief: string,
  ): Promise<{ child: string; piece: string; label: string }> => {
    const given = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: `The ${profile}`,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const child = given.agent as string
    host.claimSession(child, window)
    return { child, piece: given.piece as string, label: given.label as string }
  }

  /**
   * ⚑ **In ONE app run, a worker parked mid-turn on the work its parent gave it**, with a person's
   * window on it — `what-a-wake-still-says-wrong.test.ts`' rig. ⚑ **D-016** — the turn it parks in
   * is its brief's.
   */
  const aPmAndItsParkedWorker = async (): Promise<{
    pm: string
    worker: string
    piece: string
    label: string
  }> => {
    await host.close(await personOpens('worker'), window)
    const pm = await personOpens('pm')
    const { child: worker, piece, label } = await giveAChild(pm, 'worker', 'migrate')
    await waitFor(() => cardsOn(worker) > 0, 'the worker to park mid-turn')
    return { pm, worker, piece, label }
  }

  /** ⚑ What the WORK reads now, as the fold derives it — the thing a notice describes. */
  const theWork = (
    worker: string,
    piece: string,
  ): { state?: string; stalledBecause?: string | null } => {
    const row = store.piecesOwnedBy(worker).find((one) => one.piece === piece)
    return { state: row?.state, stalledBecause: row?.stalledBecause }
  }
  /** ⚑ A push about undriven work, as the parent READ it (`400`'s notice). */
  const pushesRead = (pm: string): string[] => read(pm).filter((text) => isGiverStallNotice(text))
  const aQuestionTo = (worker: string, label: string): Record<string, unknown> => ({
    agent: worker,
    text: 'and the indexes?',
    kind: 'follow-up',
    piece: label,
  })
  /** ⚑ **703 · why the app took its notice back**, one pattern per closing. */
  const TAKEN_BACK_WITHDRAWN =
    /^taken back by this app before it was read, because it was no longer true: this conversation withdrew that work$/
  const TAKEN_BACK_ANSWERED =
    /^taken back by this app before it was read, because it was no longer true: .+ answered that work$/

  describe.each([
    ['the Fake', false],
    ['Claude', true],
  ] as const)('on %s’s shape', (_shape, silent) => {
    /**
     * ⚑ **A parent MID-TURN when its child's turn ends with the work open**, so *"…is not being
     * worked on"* is HELD for it (`698` §3.2's rig).
     */
    const aBusyParentHoldingThePush = async (): Promise<{
      pm: string
      worker: string
      piece: string
      label: string
    }> => {
      const { pm, worker, piece, label } = await aPmAndItsParkedWorker()
      gate.silentUntilItsFirstTurn = silent
      await host.send(pm, 'keep an eye on the migration', window)
      await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
      await letTheTurnEnd(worker)
      await waitFor(
        () => held(pm).some((text) => isGiverStallNotice(text)),
        'the push to be held for the busy parent',
      )
      return { pm, worker, piece, label }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // §1 · F-A — what the parent's own act, and the work's closing, make false
    // ─────────────────────────────────────────────────────────────────────────────

    const TAKEN_BACK_ASKED =
      /^taken back by this app before it was read, because it was no longer true: this conversation asked .+ about that work$/

    describe('§1 · F-A — the parent asks the holder about its work', () => {
      /**
       * 🔴 **The subject — RED on `main`** (`698` F-A, PM: *"R32's rule applies"*). A busy parent
       * holds *"…is not being worked on"*, asks the holder about that work, and the holder takes the
       * question up. ⛔ `main` then handed the parent the push while the holder was running on the
       * parent's own question. ⚑ Taken back, under `retracted`, and never read.
       *
       * 🔴 **D-005 (F019) · and the fold moves now** — `703`'s review measured that it did not, and
       * named the difference: `list_tasks` said `stalled` / `turn_ended` while the holder answered.
       * ⚑ The holder's turn on the question DRIVES the work, so it reads `working`. The push is still
       * taken back on R32's own reading — *"It is still not being worked on"* about *"a child that
       * was working"* (`673` F-1).
       */
      it('§1.1 the parent asks about the work, the holder takes it up: the push is taken back, never read', async () => {
        const { pm, worker, piece, label } = await aBusyParentHoldingThePush()
        const turns = cardsOn(worker)
        expect((await callOn(pm, 'message_agent', aQuestionTo(worker, label))).outcome).toBe('ok')
        await waitFor(() => cardsOn(worker) > turns, 'the child to take the question up')
        // ⚑ Read AT the brief's moment: the parent's turn ends while the child is still on it.
        await letTheTurnEnd(pm)
        await letItSettle()

        expect(unqueued(pm)).toMatchObject([
          { reason: 'retracted', detail: expect.stringMatching(TAKEN_BACK_ASKED) },
        ])
        expect(isGiverStallNotice(unqueued(pm)[0]?.text ?? '')).toBe(true)
        expect(pushesRead(pm)).toEqual([])
        // 🔴 **D-005 · the measurement beside it: the fold's label moved**, with the turn.
        expect(theWork(worker, piece)).toEqual({ state: 'working', stalledBecause: null })
      })

      /**
       * ⚑ **The control — a message that names NO piece is not about that work**, so the push stays
       * and is read. ⚑ **D-016** — a note: a follow-up must name its piece.
       */
      it('§1.1b a note naming no piece takes nothing back', async () => {
        const { pm, worker, piece } = await aBusyParentHoldingThePush()
        const handle = (
          host as unknown as { slots: Map<string, { session: { handle: FakeSessionHandle } }> }
        ).slots.get(worker)!.session.handle
        const machine = (handle as unknown as { machine: { beginTurn(): void } }).machine
        // This provider keeps working without asking the person anything.
        vi.spyOn(handle, 'send').mockImplementation(async () => {
          machine.beginTurn()
        })
        expect(
          (
            await callOn(pm, 'message_agent', {
              agent: worker,
              text: 'are you around?',
              kind: 'note',
            })
          ).outcome,
        ).toBe('ok')
        await waitFor(() => handle.status() === 'working', 'the holder to work on the note')
        expect(handle.send).toHaveBeenCalled()
        await letTheTurnEnd(pm)
        await waitFor(() => unqueued(pm).length > 0, 'the push to be settled')
        await letItSettle()
        expect(unqueued(pm).map((one) => one.reason)).toEqual(['sent'])
        expect(
          store.reconciliationReceipts(worker, piece).some((one) => one.step === 'resolved'),
        ).toBe(false)
        expect(pushesRead(pm)).toHaveLength(1)
      })

      it('a person wait raised on the note resolves the old incident before its notice is read', async () => {
        const { pm, worker, piece } = await aBusyParentHoldingThePush()
        const turns = cardsOn(worker)
        expect(
          (
            await callOn(pm, 'message_agent', {
              agent: worker,
              text: 'are you around?',
              kind: 'note',
            })
          ).outcome,
        ).toBe('ok')
        await waitFor(() => cardsOn(worker) > turns, 'the note to ask the person for permission')
        await letTheTurnEnd(pm)
        await waitFor(() => unqueued(pm).length > 0, 'the notice to be settled')
        await letItSettle()
        expect(unqueued(pm).map((one) => one.reason)).toEqual(['retracted'])
        expect(store.reconciliationReceipts(worker, piece).at(-1)?.step).toBe('resolved')
        expect(pushesRead(pm)).toEqual([])
      })

      /**
       * ⚑ **The control — a question only HELD takes nothing back** (`703`'s review, round two). A
       * person makes the holder busy, so the parent's question is held: it has reached nobody, and
       * the push is still true.
       */
      it('§1.1d a question only held for the holder takes nothing back', async () => {
        const { pm, worker, label } = await aBusyParentHoldingThePush()
        const turns = cardsOn(worker)
        await host.send(worker, 'look at the logs first', window)
        await waitFor(() => cardsOn(worker) > turns, 'the holder to be busy on the person’s turn')
        expect(await callOn(pm, 'message_agent', aQuestionTo(worker, label))).toMatchObject({
          outcome: 'ok',
          delivery: 'queued',
        })
        await letItSettle()
        expect(unqueued(pm)).toEqual([])
      })
    })

    describe('§1 · F-A — the work closing takes its held notices back', () => {
      /**
       * 🔴 **The subject — RED on `main`** — the parent's own act that DOES make the push false: it
       * withdraws the work, then reads *"…still open… It has not been answered"* about work it
       * closed itself. ⚑ R32's rule: the app takes its own unread notice back, under `retracted`,
       * with the reason on the row.
       */
      it('§1.3 the parent withdraws the work: the push is taken back, never read', async () => {
        const { pm, piece } = await aBusyParentHoldingThePush()
        expect((await callOn(pm, 'withdraw_task', { piece })).outcome).toBe('ok')
        await letItSettle()

        expect(unqueued(pm)).toMatchObject([
          { reason: 'retracted', detail: expect.stringMatching(TAKEN_BACK_WITHDRAWN) },
        ])
        expect(isGiverStallNotice(unqueued(pm)[0]?.text ?? '')).toBe(true)
        await letTheTurnEnd(pm)
        expect(pushesRead(pm)).toEqual([])
      })

      /**
       * 🔴 **The subject — RED on `main`** — the HOLDER's answer makes the push false, with no message
       * from the parent at all: a person drives the child, it replies, and the parent read *"It has
       * not been answered"* and then the answer. ⚑ The push is taken back, and the parent reads only
       * the answer.
       */
      it('§1.4 the holder answers the work: the push is taken back, and the answer is what is read', async () => {
        const { pm, worker, piece } = await aBusyParentHoldingThePush()
        const turns = cardsOn(worker)
        await host.send(worker, 'please finish it', window)
        await waitFor(() => cardsOn(worker) > turns, 'the child to take the person’s message up')
        expect(
          await callOn(worker, 'reply_to_parent', {
            piece,
            outcome: 'done',
            summary: 'the migration is finished',
          }),
        ).toMatchObject({ outcome: 'ok', delivered: 'held' })
        await letItSettle()

        expect(unqueued(pm)).toMatchObject([
          { reason: 'retracted', detail: expect.stringMatching(TAKEN_BACK_ANSWERED) },
        ])
        await letTheTurnEnd(pm)
        await waitFor(
          () => read(pm).some((text) => text.includes('was answered by')),
          'the answer to be read',
        )
        expect(pushesRead(pm)).toEqual([])
      })

      /**
       * 🔴 **Every notice about the work, a stop's too** — RED on `main`. ⚑ A person's Close, then
       * its Reopen, leave the parent holding the stop's notice (D-016c: the stall on the turn the
       * Close cut; the Reopen adds nothing behind it); the holder answers, and it is taken back — it
       * describes work that is open.
       */
      it('§1.5 a stop’s notice is taken back when the work is answered', async () => {
        const { pm, worker, piece } = await aPmAndItsParkedWorker()
        await host.send(pm, 'keep an eye on the migration', window)
        await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
        await host.close(worker, window)
        await waitFor(() => held(pm).some(saysItStopped), 'the stop held')
        gate.silentUntilItsFirstTurn = silent
        await host.resumeSession(worker, window)
        await letItSettle()

        expect(
          await callOn(worker, 'reply_to_parent', {
            piece,
            outcome: 'done',
            summary: 'the migration is finished',
          }),
        ).toMatchObject({ outcome: 'ok', delivered: 'held' })
        await letItSettle()

        expect(unqueued(pm).map((one) => one.reason)).toEqual(['retracted'])
        expect(saysItStopped(unqueued(pm)[0]?.text ?? '')).toBe(true)
        await letTheTurnEnd(pm)
        await waitFor(
          () => read(pm).some((text) => text.includes('was answered by')),
          'the answer to be read',
        )
        expect(pushesRead(pm)).toEqual([])
      })
    })

    describe('§1 · F-A — a flush in flight', () => {
      /**
       * 🔴 **RED on `main` and on `703`'s first draft** (`703`'s review, F-A-5). ⛔ The take-back asked
       * R32's reader, which answers NOTHING while any flush is in flight — but a flush hands over only
       * the head. ⚑ The parent holds two pushes; its turn ends and the first is being handed over;
       * it withdraws the second child's work meanwhile. The push BEHIND the head is taken back; the
       * head is left to the flush.
       *
       * 🔴 **D-027 moved what the head is**: a flush hands over everything held, oldest first, up to
       * the first message that goes alone — a person's command — so two pushes held side by side go
       * out in ONE handover and neither is behind it. ⚑ A person's command held between them is
       * what leaves the second push behind the head now, which is this case's subject kept.
       */
      it('§1.12 while the push ahead is being handed over, the one behind it is still taken back', async () => {
        await host.close(await personOpens('worker'), window)
        await host.close(await personOpens('builder'), window)
        const pm = await personOpens('pm')
        const pmHandle = handles.at(-1)
        if (pmHandle === undefined) throw new Error('the parent has no provider handle')
        const children: { child: string; piece: string; label: string }[] = []
        for (const profile of ['worker', 'builder']) {
          const given = await giveAChild(pm, profile, 'go')
          await waitFor(() => cardsOn(given.child) > 0, `the ${profile} to park mid-turn`)
          children.push(given)
        }
        const [{ child: worker }, { child: builder, piece: builderPiece, label: builderLabel }] =
          children as [(typeof children)[number], (typeof children)[number]]
        await host.send(pm, 'keep an eye on both', window)
        await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
        const pushesHeld = (): number => held(pm).filter((text) => isGiverStallNotice(text)).length
        await letTheTurnEnd(worker)
        await waitFor(() => pushesHeld() === 1, 'the worker’s push held first')
        // ⚑ D-027 · a person's command, held between the two pushes: it goes alone, so the turn the
        // flush hands over ends before it, and the builder's push is still behind.
        expect((await host.queueMessage(pm, '/compact', window)).outcome).toBe('queued')
        await letTheTurnEnd(builder)
        await waitFor(() => pushesHeld() === 2, 'the builder’s push held behind it')

        let release!: () => void
        const theHandover = new Promise<void>((resolve) => {
          release = resolve
        })
        let handingOver = false
        const send = pmHandle.send.bind(pmHandle)
        Object.defineProperty(pmHandle, 'send', {
          value: async (...args: Parameters<FakeSessionHandle['send']>) => {
            const sent = send(...args)
            handingOver = true
            await theHandover
            return sent
          },
          configurable: true,
        })
        try {
          await letTheTurnEnd(pm)
          await waitFor(() => handingOver, 'the flush to be handing the worker’s push over')
          // ⚑ The parent withdraws the builder's work — a fact that queues nothing into its own
          // mailbox, so nothing waits on the flush it is holding open (`703`'s review, round two).
          expect((await callOn(pm, 'withdraw_task', { piece: builderPiece })).outcome).toBe('ok')
          await letItSettle()
          // ⚑ Taken back while the head is still on its way — and only the one behind it, which
          // names the builder's piece by its label (D-016).
          expect(unqueued(pm)).toMatchObject([
            { reason: 'retracted', text: expect.stringContaining(`${builderLabel} `) },
          ])
        } finally {
          release()
        }
        await waitFor(() => unqueued(pm).length === 2, 'the head to be handed over')
        expect(unqueued(pm).map((one) => one.reason)).toEqual(['retracted', 'sent'])
        // ⚑ The head was a turn of ONE — the worker's push alone — and the command was held and has
        // not ended: it waits for that turn's end.
        expect(isGiverStallNotice(unqueued(pm)[1]?.text ?? '')).toBe(true)
        expect(unqueued(pm)[1]?.text).not.toContain(`${builderLabel} `)
        expect(held(pm)).toContain('/compact')
      })
    })

    describe('§1 · F-A — a holder the quit stopped', () => {
      /**
       * 🔴 **RED on `main`** — `withdraw_task` reaches a holder the quit stopped mid-turn (`692`), and
       * its giver, back up after the relaunch, holds a notice that the work is not being worked on
       * about the work it has just withdrawn. ⚑ Taken back the same way. ⚑ **D-016c** — the notice
       * is the stall's, on the turn the quit cut; nothing says the holder is still open.
       * ⚑ **D-016** — and the holder is started once, to be told its piece was taken back.
       */
      it('§1.9 withdrawing its work takes the held notice back, and starts only the holder, to tell it', async () => {
        await host.close(await personOpens('worker'), window)
        await host.close(await personOpens('builder'), window)
        const pm = await personOpens('pm')
        const children: { child: string; piece: string; label: string }[] = []
        for (const profile of ['worker', 'builder']) {
          const given = await giveAChild(pm, profile, 'go')
          await waitFor(() => cardsOn(given.child) > 0, `the ${profile} to park mid-turn`)
          children.push(given)
        }
        await relaunch()
        // ⚑ The parent's own resume is on the shape under test (`703`'s review).
        gate.silentUntilItsFirstTurn = silent
        await host.resumeSession(pm, window)
        await waitFor(() => pushesRead(pm).length === 1, 'the first notice to be read')
        // ⚑ **D-016** — a notice names a piece by its label.
        const heldAbout = children.find(
          (one) => !(pushesRead(pm)[0] ?? '').includes(`${one.label} `),
        )
        if (heldAbout === undefined) throw new Error('no held notice')
        await waitFor(
          () =>
            held(pm).some(
              (text) => saysItStopped(text) && text.includes(`naming ${heldAbout.label}`),
            ),
          'the second notice to be held',
        )
        const started = handles.length

        expect((await callOn(pm, 'withdraw_task', { piece: heldAbout.piece })).outcome).toBe('ok')
        await letItSettle()

        expect(unqueued(pm)).toMatchObject([
          { reason: 'retracted', detail: expect.stringMatching(TAKEN_BACK_WITHDRAWN) },
        ])
        expect(saysItStopped(unqueued(pm)[0]?.text ?? '')).toBe(true)
        expect(unqueued(pm)[0]?.text).toContain(`naming ${heldAbout.label}`)
        // ⚑ **D-016 · re-aimed: the holder is TOLD, so it is started to hear it** (ruling 8). ⛔ This
        // read *"no provider was started to make it"*: the withdrawal was a ledger fact alone. ⚑ Now
        // the take-back writes `work_taken_back` and tells the owner with the `a-piece-taken-back`
        // notice, which starts the one holder it was about — and nothing else.
        expect(handles).toHaveLength(started + 1)
        expect(
          events(heldAbout.child).some(
            (event) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              event.appNotice === 'a-piece-taken-back',
          ),
        ).toBe(true)
      })
    })

    describe('§1 · F-A — what the closing does NOT take back', () => {
      /**
       * ⚑ **The control — another task's notice stays.** Two children, both pushes held; the parent
       * withdraws one child's work, and only that push is taken back.
       */
      it('§1.6 a push about ANOTHER child’s work is still read', async () => {
        await host.close(await personOpens('worker'), window)
        await host.close(await personOpens('builder'), window)
        const pm = await personOpens('pm')
        const children: { child: string; piece: string; label: string }[] = []
        for (const profile of ['worker', 'builder']) {
          const given = await giveAChild(pm, profile, 'go')
          await waitFor(() => cardsOn(given.child) > 0, `the ${profile} to park mid-turn`)
          children.push(given)
        }
        const [withdrawn, kept] = children as [(typeof children)[number], (typeof children)[number]]
        await host.send(pm, 'keep an eye on both', window)
        await waitFor(() => cardsOn(pm) > 0, 'the parent to park mid-turn')
        for (const { child } of children) await letTheTurnEnd(child)
        await waitFor(
          () => held(pm).filter((text) => isGiverStallNotice(text)).length === 2,
          'both pushes held',
        )

        expect((await callOn(pm, 'withdraw_task', { piece: withdrawn.piece })).outcome).toBe('ok')
        await letItSettle()
        expect(unqueued(pm).map((one) => one.reason)).toEqual(['retracted'])
        // ⚑ **D-016** — each notice names its piece by its label.
        expect(unqueued(pm)[0]?.text).toContain(`${withdrawn.label} `)
        await letTheTurnEnd(pm)
        await waitFor(() => pushesRead(pm).length === 1, 'the other push to be read')
        expect(pushesRead(pm)[0]).toContain(`${kept.label} `)
      })

      /** ⚑ **The control — a push already READ is not taken back**: there is nothing unread. */
      it('§1.7 a push the parent has read stays read; nothing is taken back', async () => {
        const { pm, piece } = await aBusyParentHoldingThePush()
        await letTheTurnEnd(pm)
        await waitFor(() => pushesRead(pm).length === 1, 'the push to be read')
        expect((await callOn(pm, 'withdraw_task', { piece })).outcome).toBe('ok')
        await letItSettle()
        expect(unqueued(pm).map((one) => one.reason)).toEqual(['sent'])
      })
    })

    // ─────────────────────────────────────────────────────────────────────────────
    // §3 · F-C — a WAIT after a person's Close
    // ─────────────────────────────────────────────────────────────────────────────

    /** ⚑ A worker that ASKED its parent, its turn over, the question still open. */
    const aWorkerAskingItsParent = async (): Promise<{
      pm: string
      worker: string
      piece: string
    }> => {
      const { pm, worker, piece } = await aPmAndItsParkedWorker()
      expect(
        await callOn(worker, 'ask_question', {
          who_answers: 'the-parent',
          piece,
          question: 'postgres or sqlite?',
          options: ['postgres', 'sqlite'],
        }),
      ).toMatchObject({ outcome: 'ok' })
      await letTheTurnEnd(worker)
      return { pm, worker, piece }
    }
    const theQuestion = (worker: string): string[] =>
      store
        .routedRequestsOf(worker)
        .filter((one) => one.went.to === 'the-parent')
        .map((one) => one.state)

    describe('§3 · F-C — a WAIT after a person’s Close and the parent’s own message', () => {
      /**
       * ⚑ **A PERSON's Close** (D-017 · R3/R4): the question never leaves, so the parent's own
       * message, which starts the conversation again (R1 — `resume_agent` is gone), finds the work
       * WAITING as it was, and nothing it was told needs setting right. ⛔ Until D-017 the Close
       * abandoned the question, the reopen brought it back, and R37 set the WAIT right, opening on
       * nothing the waker read.
       */
      it('§3.2 a person’s Close, then the parent’s message starts it: the question never left, and the parent is told nothing', async () => {
        const { pm, worker } = await aWorkerAskingItsParent()
        await host.close(worker, window)
        await letItSettle()
        expect(theQuestion(worker)).toEqual(['open'])
        gate.silentUntilItsFirstTurn = silent

        // ⚑ **D-016** — a note: it is talk, and a follow-up must name its piece.
        expect(
          (await callOn(pm, 'message_agent', { agent: worker, text: 'go on', kind: 'note' }))
            .outcome,
        ).toBe('ok')
        await letItSettle()
        await letItSettle()

        expect(theQuestion(worker)).toEqual(['open'])
        // ⚑ No receipt: nothing was pushed to the parent — its work waits on its answer, and a stop
        // and a start tell nobody anything (D-016c).
        expect(receipts(pm)).toEqual([])
      })
    })
  })
})
