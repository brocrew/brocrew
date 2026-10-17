import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
  UserInputResponse,
} from '@brobot2/runtime'
import { CHANNEL_REFUSALS, CHANNEL_REFUSAL_SENTENCES } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { TOOL_NAMES, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  QUESTION_RAILS,
  questionPermanenceOf,
  questionRetryableOf,
  refuseQuestion,
} from '../src/main/runtime/question-rails'
import { MESSAGE_RAILS } from '../src/main/runtime/message-rails'
import { REPLY_RAILS } from '../src/main/runtime/reply-rails'
import { SPAWN_RAILS } from '../src/main/runtime/spawn-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { MAILBOX_KINDS, theMessagesOf } from '../src/shared/runtime-ipc'
import { CAPABILITY_FIELDS } from '../src/shared/capabilities'
import { mailboxOf, stillHeld } from '../src/shared/mailbox'
import { REQUEST_IS_OPEN, REQUEST_STATES, permissionShaped } from '../src/shared/questions'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { APPROVALS_ARE_THE_PERSONS } from './lib/the-core'
import { composeProfileBundle } from '../src/main/runtime/factory-text'

/**
 * 🔴 **394 · a question finds a person, and a permission never travels** — Slice 4 S4, HO-007
 * criteria 9, 10, 13 and 14.
 *
 * ## ⛔ The distinction the whole file is written around
 *
 * **Knowledge escalates. Authority does not.** A question is knowledge and may travel to whoever can
 * answer; a permission is authority, is always a person's, and never travels. ⚠️ **A parent agent
 * answering a permission on a person's behalf is the failure this slice is shaped to prevent.**
 *
 * ## 🔴 Why criterion 10 is NOT tested by a filter
 *
 * ⛔ **The obvious implementation drops anything permission-shaped at the channel boundary — and a
 * filter justified by *"we never see permissions here"* blinds the instrument that would show you
 * one.** ⚑ So the app records a routing for **both** destinations, and §4 asks the ledger the
 * question a filter would have made unaskable. The control there plants TWO, because a fold that
 * returned the first would pass a control that planted one (standing rule 12).
 *
 * ## ⚠️ Where the two providers are measured, and it is not here
 *
 * ⛔ **The both-provider demonstration is in `packages/runtime/test/claude-runtime.test.ts` and
 * `codex-runtime.test.ts`**, where each adapter can be driven from the wire — `394` §7: *"not one
 * plus an argument that the other is the same."* ⚑ This file is the app: the mailbox, the routing,
 * the rails and the restart, over the real host with the real store.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is
 * the provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
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

/**
 * `373`'s double, with the handles kept too.
 *
 * ⛔ **A test has to BE the provider here**, because the thing under test is what the app does when a
 * provider asks its user something — and no fake can raise that on the app's behalf without a handle
 * to raise it from. ⚑ Its registry is shared so a restart finds the refs the first launch issued.
 */
class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    this.handles.push(handle)
    return handle
  }
}

describe('394 · a question finds a person, and a permission never travels', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  /**
   * `393`'s counter: pairs must not read each other's conversations, and `341`'s
   * `profile-already-live` — parent-keyed since `428` — refuses ONE parent a second live
   * conversation of an identity, so every pair gets its own.
   */
  let pairs: number
  const tick = (): number => clock++

  /**
   * ⛔ **`over` exists for the crash test and nothing else** (`354`'s §3, and its paragraph).
   * `live-hosts.ts` identifies a ledger by OBJECT, so a second host sharing this one's store would
   * find every session in `workRunningElsewhere` and exclude it from the startup repair — which is
   * an exclusion, not a crash. A crash leaves nothing alive.
   */
  const buildHost = (over: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handed, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-question-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-question-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
    pairs = 0
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

  /** ⛔ Built the way a launch builds it, against the CURRENT host — `393`'s rule, and §5 needs it. */
  const toolsOf = (sessionId: string): AgentToolset => agentToolsFor(host, sessionId)

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const entries = (sessionId: string) => store.events(sessionId)

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  /** Answer the open card so the turn runs to its own terminal (`379`'s helper). */
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  /**
   * `393`'s helper: a PM in a window with one child of its own, started through the real door —
   * ⚑ **D-016 · a give, whose brief is the child's first turn**: in the PM's `ask` that turn parks
   * on a permission card, so the child is busy on its own card from the start.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerHandle: FakeSessionHandle
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile)
    // ⚠️ **Already the window's** — `personOpens` created it there, so `letTheTurnFinish` must not
    // try to claim it a second time.
    claimed.add(pm)
    const pmTools = toolsOf(pm)
    // ⛔ No grant is set for the give (D-014: any agent may give work to any agent).
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'start on it',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return { pm, worker: given.agent as string, pmTools, workerHandle: latestHandle() }
  }

  /**
   * ⚑ **Raise a question on the child, exactly as its provider would**, and wait for the app to have
   * decided where it goes.
   */
  const childAsks = async (
    child: string,
    handle: FakeSessionHandle,
    prompt = 'which branch?',
    options: readonly string[] = ['main', 'dev'],
    extra: { secret?: boolean } = {},
  ): Promise<{ id: string; answered: Promise<UserInputResponse> }> => {
    const raised = handle.simulateUserInput(prompt, options, false, extra)
    // ⚑ **Two waits, and the first is a paired positive.** Without it a routing that never happened
    // and a request that never reached the ledger would fail identically, and only one of those is
    // a defect in the thing under test.
    await waitFor(
      () => ledger(child).some((event) => event.type === 'user_input_request'),
      `the request ${raised.id} to reach ${child}'s ledger`,
    )
    await waitFor(
      () =>
        ledger(child).some(
          (event) => event.type === 'request_routed' && event.requestId === raised.id,
        ),
      `the routing of ${raised.id}`,
    )
    return raised
  }

  const routingOf = (child: string, requestId: string) => {
    const row = ledger(child).find(
      (event) => event.type === 'request_routed' && event.requestId === requestId,
    )
    if (row === undefined || row.type !== 'request_routed') {
      throw new Error(`no routing was recorded for ${requestId}`)
    }
    return row
  }

  const answer = async (
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => callOn(toolsOf(sessionId), 'answer_question', args)

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the mailbox — a question that cannot be dropped (and, since D-010, nothing is refused a slot)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the mailbox', () => {
    it('🔴 D-010 · a second message into the WORK slot is HELD beside the first — and so is a routed question', async () => {
      // ⛔ **Criterion 13 refused the second until D-010**, and `394` §5.1 widened the mailbox for a
      // routed question alone. ⚑ D-010 retired the refusal: every message is held, in order.
      // ⚑ **D-016 · the turn is opened by the give's BRIEF** — the child's first turn, parked on its
      // own card. ⚑ The mailbox is the subject here and it is untouched: what this caller sends
      // next is held in it, one message behind the other.
      const { pm, worker, pmTools, workerHandle } = await aPmAndItsWorker()
      await cardOn(worker)

      // ⚠️ The worker is busy on its own card, so what this caller sends is held.
      const first = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'then this',
        kind: 'note',
      })
      expect(first).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      expect(first).not.toHaveProperty('message')
      const held = stillHeld(entries(worker)).at(-1)?.messageId
      if (held === undefined) throw new Error('the first message was not held')

      // 🔴 **Held too, behind the first and under a name of its own** (D-010).
      const second = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'and this',
        kind: 'note',
      })
      expect(second).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      const both = stillHeld(entries(worker)).map((one) => one.messageId)
      expect(both).toHaveLength(2)
      expect(both[0]).toBe(held)

      // 🔴 **One fact over: the SAME busy conversation takes a question.** It is not refused, it
      // does not replace the work, and the mailbox now holds both.
      const spawnedProfile = `sidecar-${String(pairs)}`
      await bringIdentityIntoBeing(spawnedProfile)
      const child = await personOpens(spawnedProfile)
      const childHandle = latestHandle()
      // ⚠️ **The routing needs a parent, and this one is a person's conversation** — so the question
      // is raised on the WORKER instead, whose parent is the pm. The sidecar above is only here to
      // keep this test's identities apart from the next one's.
      await host.close(child, window)
      void childHandle

      const asked = await childAsks(worker, workerHandle)
      expect(routingOf(worker, asked.id)).toMatchObject({ to: 'the-parent', parent: pm })
      // ⚠️ **The PM is idle here, so the question goes STRAIGHT OUT rather than waiting** — which is
      // `queueMessage`'s own answer to *"what if the target is not busy"*, unchanged and reused. ⛔
      // The mailbox is for the busy case, and the next test is where it is measured.
      await waitFor(
        () =>
          ledger(pm).some((event) => event.type === 'user_turn' && event.text.includes(asked.id)),
        'the routed question to reach the parent’s transcript',
      )
      void held
    })

    it('⛔ order is a fact, and the ledger says it — work first, the question behind it', async () => {
      // ⚑ **`394` §5.3: *say what happens to a question that arrives while an earlier one is
      // unanswered, and make it a property somebody can read.*** ⛔ The answer is that it takes the
      // next slot: the mailbox is a queue, and `mailboxOf` derives that order from the ledger so it
      // is readable rather than assumed.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      // Make the PARENT busy, so nothing flushes while the mailbox fills.
      await host.send(pm, 'think about it', window)
      await cardOn(pm)
      const queued = await host.queueMessage(pm, 'a person’s words, held', window)
      expect(queued.outcome).toBe('queued')

      const first = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])
      const second = await childAsks(worker, workerHandle, 'which region?', ['eu', 'us'])
      await waitFor(
        () => stillHeld(entries(pm)).filter((one) => one.kind === 'question').length === 2,
        'both questions to reach the parent’s mailbox',
      )

      const waiting = stillHeld(entries(pm))
      expect(waiting.map((one) => one.kind)).toEqual(['work', 'question', 'question'])
      // ⛔ **And the SECOND question did not wait for the first to be answered.** Both are held at
      // once, and they are answered BY ID in whatever order the parent chooses — which is the
      // property, said as an assertion rather than as prose.
      expect(waiting.slice(1).map((one) => one.text.includes(first.id))).toEqual([true, false])
      expect(waiting[2]?.text).toContain(second.id)
      expect(waiting.every((one) => one.ending === null)).toBe(true)

      // 🔴 **And DELIVERY is that order too, which is the half a held list cannot show.** ⚑ **D-027
      // moved how it goes, not the order**: the flush took the head, one per turn boundary, and
      // now takes everything held, oldest first, as ONE turn — the person's words first, then the
      // questions in the order they arrived, each its own part of that turn.
      // ⚑ **So ONE answer drains the whole mailbox** — this read *"one turn per slot, so the card
      // has to be answered once per message"*.
      await letTheTurnFinish(pm)
      await waitFor(() => stillHeld(entries(pm)).length === 0, 'the whole mailbox to go')
      const turns = ledger(pm).flatMap((event) => (event.type === 'user_turn' ? [event] : []))
      // ⛔ **Read per MESSAGE, never off a turn's joined text** — a turn of several joins its parts'
      // words, so a text read would find all three in one row and call it `work`.
      const whose = (text: string): string | null =>
        text.includes('a person’s words, held')
          ? 'work'
          : text.includes(first.id)
            ? 'first'
            : text.includes(second.id)
              ? 'second'
              : null
      const arrived = turns.flatMap((turn) => theMessagesOf(turn).map((one) => one.text))
      expect(arrived.map((text) => text.includes('a person’s words, held'))).toContain(true)
      const order = arrived.map(whose).flatMap((one) => (one === null ? [] : [one]))
      expect(order).toEqual(['work', 'first', 'second'])
      // ⚑ **…and all three in the SAME turn** — one row carries them, its parts in that order.
      const carrying = turns.filter((turn) =>
        theMessagesOf(turn).some((one) => whose(one.text) !== null),
      )
      expect(carrying).toHaveLength(1)
      expect(carrying[0]?.parts?.map((one) => whose(one.text))).toEqual(['work', 'first', 'second'])
    })

    it('⚠️ EVERY slot is handed on when the conversation stops — not just the head', async () => {
      // 🔴 **`394` §5.2's hazard, answered rather than inherited**: *"a mailbox with more slots has
      // more ways to end in silence."* ⛔ A teardown that handed on the head and returned would
      // leave every message behind it with a beginning and no ending — the exact state `354`
      // measured a CRASH producing, written deliberately by a clean stop.
      //
      // ⚑ **D-017 · R3 — a Close is a STOP, and a stop ends nothing**: what the mailbox held is
      // handed on to the next start, which the stop makes at once, and sent there in order. ⚠️ So
      // the ending every slot gets is `sent`, and the hazard is a slot that never gets one.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await host.send(pm, 'think about it', window)
      await cardOn(pm)
      await host.queueMessage(pm, 'a person’s words, held', window)
      const asked = await childAsks(worker, workerHandle)
      await waitFor(() => stillHeld(entries(pm)).length === 2, 'two slots held')
      const cardsBefore = ledger(pm).filter((event) => event.type === 'permission_request').length

      await host.close(pm, window)

      // ⛔ **Neither is abandoned at the stop** — asserted over the whole list rather than over
      // `box[0]`, because reading the first would pass on exactly the defect this is about.
      expect(mailboxOf(entries(pm)).map((one) => one.ending)).not.toContain('abandoned')

      // 🔴 **Both go at the start the stop made.** ⚑ **D-027 moved how**: the start puts both back
      // in the mailbox, and its flush takes everything held, oldest first, as ONE turn (a person's
      // words and a question — neither goes alone) — this read *"one turn per slot, so each new
      // card is answered in turn"*. The double parks that one turn on a card, so ONE new card is
      // answered (never the one the stop left behind); ⚠️ the loop stays only as a bound.
      let answered = cardsBefore
      for (let round = 0; round < 5 && stillHeld(entries(pm)).length > 0; round++) {
        await waitFor(
          () =>
            ledger(pm).filter((event) => event.type === 'permission_request').length > answered ||
            stillHeld(entries(pm)).length === 0,
          'the next turn the restarted conversation parks on',
        )
        const cards = ledger(pm).filter((event) => event.type === 'permission_request')
        if (cards.length <= answered) break
        answered = cards.length
        const card = cards.at(-1)
        if (card === undefined || card.type !== 'permission_request') break
        await host.respondPermission(pm, card.id, { outcome: 'allow' }, window)
      }
      await waitFor(() => stillHeld(entries(pm)).length === 0, 'the whole mailbox to go')
      const box = mailboxOf(entries(pm))
      expect(box).toHaveLength(2)
      expect(box.map((one) => one.ending)).toEqual(['sent', 'sent'])
      // ⚑ **…and both in the SAME turn** (D-027) — one row carries them, read per MESSAGE through
      // `theMessagesOf`, its parts in the order they were held: the person's words, then the question.
      const whose = (text: string): string | null =>
        text.includes('a person’s words, held')
          ? 'work'
          : text.includes(asked.id)
            ? 'question'
            : null
      const carrying = ledger(pm).flatMap((event) =>
        event.type === 'user_turn' && theMessagesOf(event).some((one) => whose(one.text) !== null)
          ? [event]
          : [],
      )
      expect(carrying).toHaveLength(1)
      expect(carrying[0]?.parts?.map((one) => whose(one.text))).toEqual(['work', 'question'])
    })

    it('🔴 a crash leaves BOTH with no ending, and the next launch writes both', async () => {
      // ⚑ **`354`'s measurement, at the width `394` gave it.** A ledger holding `message_queued`
      // with no ending is byte-identical whether the app is alive and holding the message or died
      // holding it — so the difference has to be WRITTEN by the launch that finds it, and
      // `SessionStore.settleStrandedMessages` already selected every unended message per session
      // rather than one. ⚠️ **This is the assertion that says so**: it was never exercised with two.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await host.send(pm, 'think about it', window)
      await cardOn(pm)
      await host.queueMessage(pm, 'a person’s words, held', window)
      await childAsks(worker, workerHandle)
      await waitFor(() => stillHeld(entries(pm)).length === 2, 'two slots held')

      // ⛔ **A crash, which is a host that never runs its finalizer** — the store is reopened
      // underneath it, exactly as `354`'s own §3 does.
      const atTheCrash = mailboxOf(entries(pm))
      expect(atTheCrash.map((one) => one.ending)).toEqual([null, null])
      const next = buildHost(createSessionStore(db, tick))
      try {
        const box = mailboxOf(entries(pm))
        expect(box.map((one) => one.ending)).toEqual(['abandoned', 'abandoned'])
        for (const settled of ledger(pm).filter((event) => event.type === 'message_unqueued')) {
          expect(settled).toMatchObject({
            reason: 'abandoned',
            detail: 'the app stopped while this message was still waiting to be sent',
          })
        }
      } finally {
        void next
      }
    })

    it('⚑ the kinds are a closed vocabulary, and the ledger records the kind on each', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      await host.send(pm, 'think about it', window)
      await cardOn(pm)
      await host.queueMessage(pm, 'a person’s words, held', window)
      await childAsks(worker, workerHandle)
      await waitFor(() => stillHeld(entries(pm)).length === 2, 'two slots held')
      // ⛔ **Written even for `work`** — so `mailboxOf` reads what a live host said rather than
      // inferring it from a gap that also means *a row written before `394`*.
      const queuedRows = ledger(pm).filter((event) => event.type === 'message_queued')
      expect(queuedRows.map((row) => row.type === 'message_queued' && row.kind)).toEqual([
        'work',
        'question',
      ])
      // 🔴 **THREE kinds since `400`**, and the third is why the census is a list rather than a
      // count: `notice` is the app telling a parent that work it gave out stopped being driven
      // (HO-018 §2.1). ⛔ It shares `question`'s exemption from the singleton and needs it for its own
      // reason — a notice that is refused leaves the parent never told, which is criterion 4 failing
      // silently exactly when the parent is busiest.
      expect([...MAILBOX_KINDS]).toEqual(['work', 'question', 'notice'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the routing — a question finds its parent; a permission finds a person
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · where a request goes', () => {
    it('🔴 criterion 9 · a child’s question reaches its parent, and the parent can answer it', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])

      // ⛔ **Rendered in BOTH transcripts** — criterion 9's own wording. The child's ledger holds the
      // card it raised; the parent's holds the words, as an ordinary turn, because a routed question
      // reaches it through `queueMessage` like everything else.
      expect(ledger(worker).some((event) => event.type === 'user_input_request')).toBe(true)
      const words = ledger(pm).find(
        (event) => event.type === 'user_turn' && event.text.includes(asked.id),
      )
      expect(words, 'the parent’s transcript holds the question').toBeDefined()
      // ⚑ **The options are listed verbatim**, because both providers validate an answer against
      // the labels the model wrote — a parent that cannot see them exactly cannot answer at all.
      expect(words?.type === 'user_turn' && words.text).toContain('main')
      expect(words?.type === 'user_turn' && words.text).toContain('dev')
      // ⚑ **And it names the child that asked** — by the piece it owns, as every sentence names
      // another conversation (D-016 · commit 7 · R3), where it used to print the id.
      expect(words?.type === 'user_turn' && words.text).toContain(
        `${host.nameByItsWork(worker)} is waiting on an answer`,
      )

      // 🔴 **And the parent answers it, and the child goes on.** `answered` is the promise the fake's
      // own provider side is blocked on — so this is the child continuing, not a row being written.
      const done = await answer(pm, {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(done, JSON.stringify(done)).toMatchObject({ outcome: 'ok', agent: worker })
      await expect(asked.answered).resolves.toMatchObject({
        kind: 'answer',
        answers: { q0: ['main'] },
      })
      // ⛔ **One ending, written by the same row a person's answer writes**, so the fold that closes
      // a routed request needs no second ending to learn.
      const request = store.routedRequestsOf(worker).find((one) => one.requestId === asked.id)
      expect(request).toMatchObject({
        state: 'answered',
        went: { is: 'the-parent', to: 'the-parent' },
      })
      expect(REQUEST_IS_OPEN[request?.state ?? 'open']).toBe(false)
    })

    it('⛔ criterion 10 · a permission does NOT travel, and the row says which shape it was', async () => {
      const { pm, worker } = await aPmAndItsWorker()
      // ⚑ **A real card from a real turn** — the fake parks every turn on one, which is what a
      // provider does when a tool needs approving. ⚑ **D-016** — the brief's own turn.
      const card = await cardOn(worker)

      const routed = routingOf(worker, card)
      expect(routed).toMatchObject({
        to: 'a-person',
        because: 'a-permission-decision',
        parent: pm,
      })
      // 🔴 **Nothing was delivered to the parent about it.** The paired positive is §2's first test:
      // a question in the same relationship DOES reach the parent's transcript, so what this
      // measures is the classification rather than a routing that never works.
      expect(
        ledger(pm).some((event) => event.type === 'user_turn' && event.text.includes(card)),
      ).toBe(false)
      // ⛔ **And nothing was dropped**: the card is on the child's ledger exactly as it always was,
      // and a person can still answer it.
      expect(ledger(worker).some((event) => event.type === 'permission_request')).toBe(true)
      await letTheTurnFinish(worker)
      expect(store.routedRequestsOf(worker).find((one) => one.requestId === card)).toMatchObject({
        state: 'decided',
      })
    })

    it('⚠️ a conversation with no parent has no channel — its request is a PERSON’s, and the row says so', async () => {
      // ⛔ **Still no channel.** A session nobody spawned has nowhere for a question to travel to,
      // so nothing travels and the card is where it always was.
      //
      // ⚑ **D-017 · R19 — but it is written down**: the request is a person's, and a row saying so
      // is what lets the host's reads over every conversation list it whichever window is open, or
      // none. ⚠️ It names no parent (there is none) and no `because` (an ordinary question was not
      // refused anything — it is a person's because there is nobody else).
      const alone = await personOpens('lonely')
      const handle = latestHandle()
      const raised = handle.simulateUserInput('which branch?', ['main'])
      await waitFor(
        () => ledger(alone).some((event) => event.type === 'request_routed'),
        'the routing of the card on a conversation with no parent',
      )
      const routed = ledger(alone).filter((event) => event.type === 'request_routed')
      expect(routed).toHaveLength(1)
      expect(routed[0]).toMatchObject({ requestId: raised.id, to: 'a-person' })
      expect(routed[0]).not.toHaveProperty('parent')
      expect(routed[0]).not.toHaveProperty('because')
      expect(store.routedRequestsOf(alone)).toMatchObject([
        {
          requestId: raised.id,
          parent: null,
          state: 'open',
          went: { is: 'the-person-the-asker-named', to: 'a-person' },
        },
      ])
      // 🔴 **And nothing was dropped**: the card is on this conversation's ledger, as it always was.
      expect(
        ledger(alone).some(
          (event) => event.type === 'user_input_request' && event.id === raised.id,
        ),
      ).toBe(true)
    })

    it('⚑ the routing row is written even when NOTHING is watching', async () => {
      // 🔴 **A ledger write, above the sink gate.** `recordMemoryNotes` states the rule — *"if it
      // only happened while a window was open, closing one would punch holes in the ledger"* — and
      // an unattended child is the ORDINARY case for a routed question, so this row would otherwise
      // be missing from exactly the conversations it is about.
      const { worker, workerHandle } = await aPmAndItsWorker()
      // ⚠️ A spawned child has no window of its own; this is that state, said out loud.
      const asked = await childAsks(worker, workerHandle)
      expect(routingOf(worker, asked.id)).toMatchObject({ to: 'the-parent' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the rails — each refusal paired with the identical call one fact over
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the rails at the answer door', () => {
    it('🔴 an id nothing routed to you is refused — and the same call with a real one lands', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)

      const refused = await answer(pm, {
        question: 'ui_nobody_elses',
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      // 🔴 **`permanent` since `424`** (HO-023 §2.1, `422` row 10). ⛔ The old word said a guessed
      // id would eventually land: request handles are minted by a provider for the request it
      // raised, and one that was never routed to this family cannot be routed to it afterwards.
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'no-question-by-that-name',
        permanence: 'permanent',
        retryable: false,
      })
      // ⚑ **ONE FACT OVER**: the same caller, the same shape of call, a real id — allowed.
      expect(
        await answer(pm, { question: asked.id, answers: [{ part: 'q0', answer: ['main'] }] }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('⛔ a request routed to somebody ELSE’S family is the same absence, not a second answer', async () => {
      // 🔴 **Entitlement before existence, made structural.** `questionsRoutedTo` is asked of nothing
      // but the caller, so *"not yours"* and *"no such request"* cannot be told apart from outside —
      // which is what stops a caller walking ids to learn which conversations are waiting on what.
      const mine = await aPmAndItsWorker()
      const theirs = await aPmAndItsWorker()
      const asked = await childAsks(theirs.worker, theirs.workerHandle)

      const refused = await answer(mine.pm, {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(refused).toMatchObject({ outcome: 'refused', rail: 'no-question-by-that-name' })
      // ⚠️ **And the sentence is the SAME one a nonexistent id gets** — asserted, because two
      // sentences would be the enumerator this rail exists to prevent.
      const nowhere = await answer(mine.pm, {
        question: 'ui_nothing',
        answers: [{ part: 'q0', answer: ['x'] }],
      })
      expect(refused.reason).toBe(nowhere.reason)
      // ⛔ **The paired positive**: the family it BELONGS to can answer it, so what was measured is
      // the scope rather than a request nobody could ever answer.
      expect(
        await answer(theirs.pm, {
          question: asked.id,
          answers: [{ part: 'q0', answer: ['main'] }],
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('🔴 criterion 10 · a PERMISSION in your own family is refused BY NAME, permanently', async () => {
      // ⛔ **The rail this whole dispatch is shaped around, and it is REACHABLE.** The scope contains
      // the permission on purpose: had the routing only recorded questions, this call would meet
      // *"there is nothing here"* — which is false, and is the filter `394` §2 forbids.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      // ⚑ **D-016** — the card the brief's own turn parks on.
      const card = await cardOn(worker)
      const asked = await childAsks(worker, workerHandle)

      const refused = await answer(pm, {
        question: card,
        answers: [{ part: 'q0', answer: ['allow'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'a-person-answers-this-one',
        permanence: 'permanent',
        retryable: false,
        detail: { because: 'a-permission-decision' },
      })
      // ⚑ **ONE FACT OVER, in the same conversation at the same moment**: a QUESTION from the same
      // child is answered. ⛔ Without this the refusal above would also pass against a door that
      // refused everything.
      expect(
        await answer(pm, { question: asked.id, answers: [{ part: 'q0', answer: ['main'] }] }),
      ).toMatchObject({ outcome: 'ok' })
      // ⚠️ **And the permission is STILL a person's to answer** — nothing was consumed by the
      // refusal, which is what makes it a refusal rather than a decision.
      await letTheTurnFinish(worker)

      // 🔴 **The ORDER of the two questions, tested where the readings diverge.** The card has now
      // ENDED, so a door that asked *is it over?* before *is it mine to answer?* would answer
      // `question-has-already-ended` — a sentence about a card this caller may not touch, which is
      // `340`'s finding. ⛔ Asked in the right order it is still the permission rail, forever.
      expect(
        await answer(pm, { question: card, answers: [{ part: 'q0', answer: ['allow'] }] }),
      ).toMatchObject({ rail: 'a-person-answers-this-one' })
    })

    it('⛔ a question already answered names the ENDING rather than saying the id was wrong', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const first = await childAsks(worker, workerHandle)
      const second = await childAsks(worker, workerHandle, 'which region?', ['eu', 'us'])
      expect(
        await answer(pm, { question: first.id, answers: [{ part: 'q0', answer: ['main'] }] }),
      ).toMatchObject({ outcome: 'ok' })

      const refused = await answer(pm, {
        question: first.id,
        answers: [{ part: 'q0', answer: ['dev'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'question-has-already-ended',
        permanence: 'permanent',
        detail: { state: 'answered' },
      })
      // ⚑ **ONE FACT OVER**: the other question, raised in the same breath, is still open.
      expect(
        await answer(pm, { question: second.id, answers: [{ part: 'q0', answer: ['eu'] }] }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('⚠️ an answer the provider cannot take is refused, and the request is still waiting', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])

      const refused = await answer(pm, {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['a branch nobody offered'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'that-answer-cannot-be-sent',
        permanence: 'while-this-holds',
        retryable: true,
        // 🔴 **425 · the act, as a word the ledger can carry** (HO-023 §2.2). ⚑ A missing part, a
        // value the request cannot use and an option nobody offered are ONE rail, and one act clears
        // all three — which is what the refusal below and the admitted call under it measure in the
        // same breath. ⚠️ **The word does NOT name choices**: `answerToForward` reaches this rail for
        // a question with no options at all, and a remedy naming choices would instruct an
        // impossible act on the free-form arm.
        remedy: 'answer-every-part-the-request-asks-for',
      })
      // ⛔ **The request is STILL OPEN**, which is the half of the sentence a caller acts on — and
      // the paired positive is that the identical call with an offered label lands.
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === asked.id),
      ).toMatchObject({ state: 'open' })
      expect(
        await answer(pm, { question: asked.id, answers: [{ part: 'q0', answer: ['dev'] }] }),
      ).toMatchObject({ outcome: 'ok' })
      await expect(asked.answered).resolves.toMatchObject({ answers: { q0: ['dev'] } })
    })

    it('⛔ a malformed call is refused before the door is bothered, and a good one is not', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      for (const args of [
        { question: '', answers: [{ part: 'q0', answer: ['main'] }] },
        { question: asked.id, answers: 'main' },
        { question: asked.id, answers: [{ answer: ['main'] }] },
        { question: asked.id, answers: [{ part: 'q0', answer: 'main' }] },
      ]) {
        expect(await answer(pm, args), JSON.stringify(args)).toMatchObject({
          outcome: 'refused',
          rail: 'malformed-request',
        })
      }
      expect(
        await answer(pm, { question: asked.id, answers: [{ part: 'q0', answer: ['main'] }] }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('🔴 a person does not come through this door, and `respondUserInput` is untouched', async () => {
      // ⛔ **`340` §2 made `requireToAnswer` the one door {@link THE_APP_ITSELF} is turned away
      // from**, and `394` did not widen it: the answer door is a SECOND door with its own gate.
      // ⚠️ A window asking `answerQuestion` is not speaking as an agent, and nobody routes anything
      // to a person — so there is no such request, which is the ordinary answer rather than an
      // exemption.
      const { worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      const refused = await host.answerQuestion(
        { questionId: asked.id, answers: [{ part: 'q0', answer: ['main'] }] },
        window,
      )
      expect(refused).toMatchObject({ ok: false, refusal: { rail: 'no-question-by-that-name' } })
      // ⚑ **The paired positive, and it is the point**: the PERSON answers it through the door a
      // person has always used, and that door still works on a routed question.
      host.claimSession(worker, window)
      claimed.add(worker)
      const ack = await host.respondUserInput(
        worker,
        asked.id,
        { kind: 'answer', answers: { q0: 'main' } },
        window,
      )
      expect(ack).toMatchObject({ outcome: 'taken' })
      await expect(asked.answered).resolves.toMatchObject({ kind: 'answer' })
    })

    it('⚑ every rail is a real sentence, `retryable` is DERIVED, and this census has no collision', () => {
      for (const rail of QUESTION_RAILS) {
        const payload = refuseQuestion(rail)
        expect(payload.reason.length, rail).toBeGreaterThan(40)
        expect(payload.permanence, rail).toBe(questionPermanenceOf(rail))
        expect(payload.retryable, rail).toBe(questionRetryableOf(rail))
        // ⛔ **A refusal states a fact about THIS call and never describes the system** (HO-015 §2).
        expect(payload.reason, rail).not.toMatch(/routing|channel|provider|permission_request/)
      }
      // ⛔ **No two entries in the compared roster share a NAME** — `374`'s rule, so `rail` says
      // which rule stopped a call whichever door built the payload.
      const every = [
        ...SPAWN_RAILS,
        ...MESSAGE_RAILS,
        ...REPLY_RAILS,
        ...QUESTION_RAILS,
        ...CHANNEL_REFUSALS,
      ]
      expect(new Set(every).size).toBe(every.length)
      // ⚠️ **And no SENTENCE is shared between the two audiences of one fact.** The channel's
      // sentences are for a reader of a ledger; the rails' are for a model, and a string that had to
      // be right for both would end up right for neither.
      const railSentences = QUESTION_RAILS.map((rail) => refuseQuestion(rail).reason)
      const channelSentences = CHANNEL_REFUSALS.map((one) => CHANNEL_REFUSAL_SENTENCES[one])
      expect(new Set([...railSentences, ...channelSentences]).size).toBe(
        railSentences.length + channelSentences.length,
      )
      // ⚑ Non-vacuity: both really are prose.
      expect([...railSentences, ...channelSentences].every((one) => one.includes(' '))).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · criterion 10 as a NAMED-SET assertion, with the control that plants two
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · has anything permission-shaped ever arrived here?', () => {
    it('🔴 the ledger answers it — and the control plants TWO, of two different shapes', async () => {
      // ⛔ **This is the question a filter would have made unaskable.** Had the app dropped
      // permission-shaped requests at the boundary, `permissionShaped` would be permanently `[]` —
      // honestly, and wrongly — and the census that would catch a provider starting to send them
      // would report zero forever. ⚑ Because nothing is dropped, an empty answer means *none
      // arrived* and a non-empty one names each shape that did.
      const { worker, workerHandle } = await aPmAndItsWorker()
      // ⚑ **D-016** — the card the brief's own turn parks on.
      const card = await cardOn(worker)
      const secret = await childAsks(worker, workerHandle, 'paste the deploy token', [], {
        secret: true,
      })
      const ordinary = await childAsks(worker, workerHandle, 'which branch?', ['main', 'dev'])

      const arrived = store.routedRequestsOf(worker)
      // ⚠️ **Three arrivals, and every one of them is recorded** — the instrument sees the whole
      // channel rather than the half that was let through.
      expect(arrived.map((one) => one.requestId).sort()).toEqual(
        [card, secret.id, ordinary.id].sort(),
      )

      const shaped = permissionShaped(arrived)
      // ⛔ **TWO, and of two DIFFERENT shapes** (standing rule 12). A reader that answered with the
      // first would pass a control that planted one; two also make the answer a NAMED SET rather
      // than a count, so a provider that started sending a third kind would show up as a new word
      // rather than as a bigger number.
      expect(shaped.map((one) => one.went.because).sort()).toEqual([
        'a-permission-decision',
        'a-secret-only-a-person-can-type',
      ])
      expect(shaped.every((one) => one.went.to === 'a-person')).toBe(true)
      // ⚑ **And the ordinary question is NOT among them**, which is what stops this passing against
      // an instrument that reported everything.
      expect(shaped.some((one) => one.requestId === ordinary.id)).toBe(false)
      expect(arrived.find((one) => one.requestId === ordinary.id)).toMatchObject({
        went: { is: 'the-parent', to: 'the-parent' },
      })
      await letTheTurnFinish(worker)
    })

    it('⛔ `because` is present if and only if it went to a person', async () => {
      // ⚠️ **One fact seen twice, and the fold COPIES rather than decides** — so the two can never
      // disagree, and a row that said *the parent* while naming a shape would be a contradiction
      // this assertion refuses to let ship.
      const { worker, workerHandle } = await aPmAndItsWorker()
      await cardOn(worker)
      await childAsks(worker, workerHandle)
      for (const one of store.routedRequestsOf(worker)) {
        expect(one.went.is === 'the-parent', one.requestId).toBe(one.went.to === 'the-parent')
      }
      await letTheTurnFinish(worker)
    })

    it('⚑ the states are a closed list, and only `open` is still somebody’s to answer', () => {
      expect([...REQUEST_STATES]).toEqual([
        'open',
        'answered',
        'rejected',
        'decided',
        'withdrawn',
        'abandoned',
        // ⚑ **396's, and it went in here as a red list rather than as a quiet append** — which is
        // what a pinned enumeration is for. ⛔ It is NOT `abandoned` with a nicer name: `abandoned`
        // says the conversation ended underneath it, this says the conversation is still there and
        // the REQUEST is not.
        'stranded',
        // ⚑ **397's, appended as a red list for the same reason.** ⛔ It is not `stranded` with a
        // nicer name either: `stranded` says the APP stopped, this says somebody stopped the WORK
        // and the app kept running — and it is not `abandoned`, because the conversation is still
        // there and can be asked again.
        'interrupted',
        // ⚑ **591's, appended as a red list for the same reason as the two above it.** ⛔ It is
        // none of them: `stranded` says the APP stopped, `interrupted` says somebody stopped the
        // TURN, and this says the WORK the question was about was taken back — the turn is
        // untouched and the conversation is still there. ⚠️ `HO-082` §2.2 is the ruling that made
        // it an ending at all: a question ends when it is answered or when its work is withdrawn
        // or ended, and NEVER on elapsed time.
        'work-withdrawn',
        // ⚑ **D-016's, appended as a red list for the same reason.** ⛔ It is not `work-withdrawn`:
        // nothing was taken back — the work the question was about was CLOSED by the one that gave
        // it, and the conversation is still there.
        'work-closed',
        // The work it was about was handed back.
        'work-replied',
        // ⚑ **D-009** — the conversation it was addressed to ended without answering it.
        'recipient-ended',
      ])
      expect(REQUEST_STATES.filter((state) => REQUEST_IS_OPEN[state])).toEqual(['open'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · a restart — what survives, and the criterion 14 finding it exposes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · across a real restart', () => {
    it('⛔ the routed requests rebuild from the ledger alone, field for field', async () => {
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      // ⚑ **D-016** — the card the brief's own turn parks on is routed too, to a person.
      const card = await cardOn(worker)
      const asked = await childAsks(worker, workerHandle)
      await host.closeAll()
      const atTheQuit = store.routedRequestsOf(worker)

      host = buildHost()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)

      // ⚑ **Identical, before anything is done to it** — criterion 14's own shape, and the premise
      // the finding below needs rather than the thing it is about.
      expect(store.routedRequestsOf(worker)).toEqual(atTheQuit)
      expect(atTheQuit.map((one) => one.requestId)).toEqual([card, asked.id])
      // ⚠️ **And the quit ENDED it**, because a conversation going away with somebody waiting on it
      // is an ending — the same reading `derivePieces` gives an unfinished piece.
      expect(atTheQuit.find((one) => one.requestId === asked.id)?.state).toBe('abandoned')
    })

    it('🔴 a question a resumed child was waiting on cannot be answered — the criterion 14 finding', async () => {
      // ⛔ **A FINDING, stated rather than fixed in a hurry** — `394` §7 asked for exactly that.
      // A pending provider request lives in the PROVIDER's process; a quit takes it with it, and a
      // resumed conversation is a NEW provider session that was never offered it. ⚑ So the honest
      // answer is a refusal that NAMES the ending, which is `393`'s ruling one subject over.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)
      await host.closeAll()

      host = buildHost()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)

      const refused = await answer(pm, {
        question: asked.id,
        answers: [{ part: 'q0', answer: ['main'] }],
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'question-has-already-ended',
        permanence: 'permanent',
        detail: { state: 'abandoned' },
      })
      // ⚑ **The paired positive over the restarted app**: a question raised AFTER the resume is
      // routed and answered normally, so what the refusal above measured is the quit rather than a
      // door that stopped working.
      const again = await childAsks(worker, latestHandle(), 'which region?', ['eu', 'us'])
      expect(
        await answer(pm, { question: again.id, answers: [{ part: 'q0', answer: ['eu'] }] }),
      ).toMatchObject({ outcome: 'ok' })
    })

    it('🔴 a request id can REPEAT across a resume, and the live one is the one answered', async () => {
      // ⛔ **A defect this dispatch's own §5 found, kept as its own measurement.** A request id is
      // unique per PROVIDER SESSION and a resumed conversation is a NEW provider session — neither
      // adapter draws its id from anything durable — so one ledger can hold the same id twice, once
      // per life. ⚠️ `find` hands back the OLDEST, which is always the closed one, so a live
      // question would be refused by quoting an ending that belongs to a request nobody is waiting
      // on. ⚑ `findLast` is the fix, and this is the state that kills it.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const before = await childAsks(worker, workerHandle)
      await host.closeAll()
      host = buildHost()
      await host.resumeSession(pm, window)
      await host.resumeSession(worker, window)
      const after = await childAsks(worker, latestHandle(), 'which region?', ['eu', 'us'])

      // ⚑ **The premise, asserted rather than assumed**: the two really do share an id, and the
      // ledger really does hold two rows for it.
      expect(after.id).toBe(before.id)
      const both = host.questionsVisibleTo(pm).filter((one) => one.requestId === after.id)
      expect(both.map((one) => one.state)).toEqual(['abandoned', 'open'])

      expect(
        await answer(pm, { question: after.id, answers: [{ part: 'q0', answer: ['eu'] }] }),
      ).toMatchObject({ outcome: 'ok' })
      await expect(after.answered).resolves.toMatchObject({ answers: { q0: ['eu'] } })
    })

    it('🔴 REPAIRED by 396: after a CRASH the launch settles it, and the refusal names the ending', async () => {
      // ⛔ **This test used to assert the DEFECT and `396` turned it red, which is what it was for.**
      //
      // `394` measured the half the ledger cannot see: a crash writes no ending at all, so the fold
      // read `open` while nothing anywhere was waiting — the shape `354` measured for a held message
      // and `379` for a stranded run. ⚑ What `394` could do was refuse to report that `open` to a
      // model as *go ahead*, and it did, under `the-conversation-that-asked-has-gone`.
      //
      // 🔴 **`396` closed it from the other end**: `SessionStore.settleStrandedRequests` runs at host
      // construction — the one moment at which *nothing is running* is a fact — and writes
      // `request_stranded`. ⛔ **Replaced rather than adjusted**: a red test quietly weakened until it
      // passes is how a repair loses its evidence, so what stands here is the opposite claim.
      //
      // ⚠️ **And the rail `394` reached here is NOT orphaned by that** — `396`'s own suite reaches it
      // through the case this sweep must not walk over, a second host while the first still holds
      // the conversation. See `nothing-waits-on-somebody-looking.test.ts` §2.
      const { pm, worker, workerHandle } = await aPmAndItsWorker()
      const asked = await childAsks(worker, workerHandle)

      // ⚑ **The row really does read `open` before the crash** — the premise, asserted rather than
      // assumed, so what the launch below changes is visible rather than inferred.
      expect(
        store.routedRequestsOf(worker).find((one) => one.requestId === asked.id),
      ).toMatchObject({ state: 'open' })

      // ⛔ **A SECOND store object, which is what makes this a crash rather than a second window.**
      // `LiveHost.ledger` is compared by object identity, so this host believes nothing is running —
      // exactly what a fresh process believes, and the reason the sweep is safe there.
      const next = buildHost(createSessionStore(db, tick))
      await next.resumeSession(pm, window)
      const pmTools = agentToolsFor(next, pm)
      const tool = pmTools.tools.find((one) => one.name === 'answer_question')
      const refused = (
        await tool!.call({ question: asked.id, answers: [{ part: 'q0', answer: ['main'] }] })
      ).structured as Record<string, unknown>

      // 🔴 **The launch wrote the difference down.**
      expect(next.questionsVisibleTo(pm).find((one) => one.requestId === asked.id)).toMatchObject({
        state: 'stranded',
      })
      expect(refused).toMatchObject({
        outcome: 'refused',
        rail: 'question-has-already-ended',
        permanence: 'permanent',
        retryable: false,
        detail: { state: 'stranded' },
      })
      // ⛔ **Nothing was sent**, exactly as before: the provider the question belongs to is in the
      // host this one knows nothing about. ⚑ That has not changed — what changed is that the app now
      // SAYS so instead of offering the question and refusing at the last door.
      expect(ledger(worker).some((event) => event.type === 'user_decision')).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the censuses', () => {
    it('⛔ the published inventory gained exactly one name, and it is where the list says', () => {
      // ⚑ **Derived from `TOOL_NAMES` rather than counted** — `347` built the constant so a negative
      // could be measured against a named list, and `380` learned what a pinned count costs.
      //
      // 🔴 **`395` CORRECTED this line, and the correction is the lesson.** It read
      // `expect(TOOL_NAMES.indexOf('answer_question')).toBe(TOOL_NAMES.length - 1)` — *"it is the
      // last"* — which is a pinned count wearing an index's clothes: it says nothing about
      // `answer_question` and everything about whatever happens to be published after it. ⛔ **An
      // anchor on a list's LAST member dies the moment anything appends**, and `395` appended. ⚑ The
      // claim `394` was making is the position, so the position is what is asserted.
      // ⚑ **D-017 commit 3 · 8 → 7**: `end_agent`, published before it, is gone (nothing ends a
      // conversation); `answer_question` itself did not move relative to its neighbours.
      expect(TOOL_NAMES.indexOf('answer_question')).toBe(7)
      const offered = agentToolsFor(host, 'sess_x').tools.map((tool) => tool.name)
      expect(offered).toEqual([...TOOL_NAMES])
    })

    it('🔴 the routing is recorded on EVERY arm — the anti-filter property, from the source', () => {
      // ⛔ **This is criterion 10's design asserted as CODE**, because it is the one property a
      // green test cannot demonstrate on its own: an app that dropped permissions would pass every
      // behavioural assertion in §2 and quietly make §4 unanswerable forever.
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const opens = host_.indexOf('private routeRequest(')
      expect(opens, 'routeRequest was renamed or removed').toBeGreaterThan(0)
      const body = host_.slice(opens, host_.indexOf('\n  }', opens))
      // ⚑ **Three records, one per arm** — and none is a `return` that writes nothing: the refused
      // arm and the parent's, and (⚑ D-017 · R19) a conversation nobody spawned, whose request is a
      // person's with no parent to name (§2's no-parent test is its behaviour).
      expect(body).toContain("to: 'a-person'")
      expect(body).toContain("to: 'the-parent'")
      expect(body.split('this.recordOurs(')).toHaveLength(4)
      expect(body.split("to: 'a-person'")).toHaveLength(3)
      // ⛔ **And the `because` rides the refused arm**, or the fold would have nothing to count.
      expect(body).toContain('because: verdict.because')
      // 🔴 **The ADAPTER's event is what is classified, not the wire's** — and this is the one
      // property no behavioural test in this file can reach, because `runtimeEventSchema` strips an
      // undocumented key before the ledger and the fake cannot emit one through the host. ⛔ Handed
      // `wire` instead, `a-shape-this-app-has-not-been-taught` would be unreachable in production
      // and a field no adapter here knows about would travel.
      expect(host_).toContain('const routed = this.routeRequest(session, event, wire)')
      expect(body).toContain('const verdict = askedOfTheChannel(event)')
    })

    it('⛔ the mailbox kind is chosen at the CALL SITE — `work` unless the routing says `question`', () => {
      // ⚠️ **D-010 retired the gate this census guarded** (criterion 13's one held `work`); what is
      // left is WHICH kind a caller holds, and only the routing asks for the other one.
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      expect(host_).toContain("kind: MailboxKind = 'work',")
      // ⛔ **Exactly ONE call site asks for the other kind**, and it is the routing.
      // ⚠️ **RE-POINTED at 413 and again at the merge onto `412`**: 413 gave the call two trailing
      // arguments and the merge folded them into one named object, so the tail is a line shorter
      // again. The shape that says *this caller asked for a question slot* is unchanged — the
      // argument on its own line.
      const asking = [...host_.matchAll(/^\s*'question',$/gm)]
      expect(asking).toHaveLength(1)
      // ⚑ **D-016 · commit 6 · R4 — re-pointed again**: the facts now carry the piece the question is
      // about when it names one, so the recipient's turn drives that piece. The kind argument, on
      // its own line, is unchanged.
      expect(host_).toContain(
        "        THE_APP_ITSELF,\n        [],\n        'question',\n        { carriedFor: asked, ...about },\n      )",
      )
    })

    it('⚠️ the teardown hands on the WHOLE mailbox, never its head', () => {
      // 🔴 **`394` §5.2's hazard as a source census**, because the behavioural test for it needs two
      // slots and a teardown — and the defect it guards is a one-character one (`[0]`, `.at(0)`,
      // `shift()` and a return).
      //
      // ⚑ **D-017 · R3 — the teardown no longer abandons what it held; it hands it on** to the next
      // start (`abandonQueued` became `handOnWhatItHeld`). ⛔ The hazard is the same one: every slot,
      // taken in one step, and walked whole.
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const opens = host_.indexOf('private handOnWhatItHeld(')
      expect(opens, 'handOnWhatItHeld was renamed or removed').toBeGreaterThan(0)
      const body = host_.slice(opens, host_.indexOf('\n  }', opens))
      expect(body).toContain('session.mailbox.splice(0, session.mailbox.length)')
      expect(body).toContain('for (const queued of held)')
      expect(body).not.toMatch(/mailbox\[0\]|mailbox\.at\(0\)|mailbox\.shift\(\)/)
    })

    it('⛔ the store’s narrow read selects every type the routing fold acts on', () => {
      // ⚠️ **`379`'s census, one subject over, and it is the same drift**: a type folded but not
      // selected reads as *"that event never happened"* — silently, and only on the replayed path,
      // which is the path every restart takes.
      const fold = sourceOf(join(here, '../src/shared'), 'questions.ts')
      const acted = new Set(
        [...fold.matchAll(/event\.type === '([a-z_]+)'/g)].map((match) => match[1]),
      )
      expect([...acted].sort()).toEqual([
        // ⚑ **397's ending, and the same census caught it the same way** — a fold branch on a type
        // this query does not select reads as *that event never happened*, on the replayed path.
        // ⚑ **`398`, and the one member of this list that closes NOTHING.** It stamps
        // `escalatedAt` and leaves the state where it was — so a type folded but not selected here
        // would make *"was a person ever told?"* answer `null` on every replayed path, which is
        // every path after a restart.
        // ⚑ **D-009's two endings, caught the same way** — the asker's withdrawal and the recipient's
        // ending; folded but not selected, each would reopen at the next launch.
        // ⚑ **D-017 · R4's two, caught the same way** — neither closes anything: `launched` says a
        // question this app asked outlives a stop, and `question_asked` says which ones this app
        // asked. Folded but not selected, every such question would read `abandoned` at the next
        // launch.
        'launched',
        'question_asked',
        // A question passed up ends with the piece the one it carried was about.
        'question_ended_with_its_piece',
        'question_recipient_ended',
        'question_withdrawn',
        'request_escalated',
        'request_interrupted',
        'request_resolved',
        'request_routed',
        // ⚑ **396's ending, and this census is exactly what it needed to be added to.** ⛔ A fold
        // branch on a type the store's narrow read does not select reads as *"that event never
        // happened"* on the replayed path — which is every path after a restart, and a stranding is
        // only ever read after one.
        'request_stranded',
        'status',
        'user_decision',
        // ⚑ **D-016 · a close ends them the same way as the take-back below**, and the census caught
        // it the same way: folded but not selected, a question about work its giver closed would
        // come back `open` at the next launch.
        'work_closed',
        // A hand-back ends the questions about its piece, as a close does.
        'work_replied',
        // ⚑ **591's ending, and the census caught it the same way the three above it were
        // caught** — which is the fourth time, and the reason this list is pinned rather than
        // counted. ⛔ A fold branch on a type `selectRoutedRequestEvents` does not select reads as
        // *that event never happened* on the replayed path; for this one that would mean a
        // question about work a parent took back coming back `open` at the next launch, and the
        // queue counting it again. ⚑ **D-016 · it is the take-back's own row now**: nothing writes
        // `request_work_withdrawn`, and `work_taken_back` ends the questions asked about its piece.
        'work_taken_back',
      ])
      // ⛔ **Scoped to the statement BY NAME**: there are two narrow reads in that file now, and a
      // file-level match cannot tell sibling declarations apart.
      const statement = sourceOf(join(mainRoot, 'db'), 'session-store.ts')
      const opens = statement.indexOf('const selectRoutedRequestEvents = db.prepare(')
      expect(opens, 'selectRoutedRequestEvents was renamed or removed').toBeGreaterThan(0)
      const selection = statement.slice(opens, statement.indexOf('  )', opens))
      expect(selection).toContain(
        "AND type IN (${ROUTED_REQUEST_EVENT_TYPES.map((type) => `'${type}'`).join(', ')})",
      )
      const listed =
        statement.match(/export const ROUTED_REQUEST_EVENT_TYPES = \[([\s\S]*?)\] as const/)?.[1] ??
        ''
      for (const type of acted) {
        expect(listed, `\`${type}\` is folded but not selected`).toContain(`'${type}'`)
      }
    })

    it('🔴 the person’s door was not widened — `requireToAnswer` still turns everyone else away', () => {
      // ⛔ **`340` §2's ruling, kept.** The answer door is a SECOND door with its own gate; had
      // `answerQuestion` reached `requireToAnswer` instead, the widening needed to let an agent
      // through would have been a widening for every caller of `respondPermission` too.
      const host_ = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      const opens = host_.indexOf('async answerQuestion(')
      expect(opens, 'answerQuestion was renamed or removed').toBeGreaterThan(0)
      const body = host_.slice(opens, host_.indexOf('\n  }\n', opens))
      expect(body).not.toContain('requireToAnswer')
      expect(body).toContain('sessionSpeakingAs(by)')
      // ⚑ **TWO callers again** — `441` made `decideProposal` the third, a person-only verb by
      // exactly this door's argument, and D-016 deleted it with proposals. ⛔ **The count is not the
      // proof; the ROSTER is** — a third caller that was not one of these two would be a person-only
      // verb nobody ruled on.
      expect(host_.split('this.requireToAnswer(')).toHaveLength(3)
      for (const verb of ['async respondPermission(', 'async respondUserInput(']) {
        expect(host_, `${verb} no longer stands behind requireToAnswer`).toContain(verb)
      }
    })

    it('🔴 the factory text’s permission sentence has a RAIL under it now, and both are pinned', () => {
      // ⛔ **A safety sentence with no test is a comment** (standing rule 5). `370` shipped this
      // clause when nothing enforced it for an AGENT — `mayAnswerAsAHuman` refused a non-person
      // SINK, and no agent had a verb to try — and `394` is the dispatch that gives an agent one.
      // ⚑ So the sentence and the rail that makes it true are asserted together, by name, and
      // neither can drift out silently.
      // ⚑ **The sentence as every agent is handed it**, so the pin below and the census further
      // down are one derivation rather than two strings free to drift apart.
      const sentence = APPROVALS_ARE_THE_PERSONS
      expect(composeProfileBundle({ configured: null })).toContain(sentence)
      // ⚠️ **And the rail is what makes the second half true**, rather than the absence of a verb.
      expect(QUESTION_RAILS).toContain('a-person-answers-this-one')
      expect(questionPermanenceOf('a-person-answers-this-one')).toBe('permanent')
      // ⛔ **The sentence claims no MECHANISM** (HO-015 §2, standing): it says what a person does,
      // not how the app decides, and it names no tool, no rail and no event.
      //
      // 🔴 **CORRECTED in place by `396`, and the correction is the lesson** (142's rule). This was
      // two whole-FILE `not.toContain`s, and *a file-level `contains` cannot tell sibling
      // declarations apart*: `factory-text.ts` already named `reply_to_parent` and `list_tasks` in
      // the worker section when this was written, so *"it names no tool"* was true of the file only
      // by the accident of which tool was picked. ⛔ `396` added a PM line naming `list_questions`
      // and `answer_question` — legitimately, `393`'s precedent exactly — and the assertion went
      // red for a reason that was never the claim.
      //
      // ⚑ **Scoped to the SENTENCE, and derived from the published inventory**, which is stronger
      // than the two names it replaced: a tool added tomorrow is covered without anybody editing
      // this line.
      for (const named of [...TOOL_NAMES, 'request_routed', 'user_decision']) {
        expect(sentence, `the permission sentence names ${named}`).not.toContain(named)
      }
    })

    it('⚑ no capability field is read in the tool layer, and this verb did not change that', () => {
      // ⚠️ **`347`'s standing census, re-asked because `394` added a verb that settles something on
      // another conversation's behalf.** The entitlement is the host's; the tool layer translates.
      const tools = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'agent-tools.ts'))
      expect(tools).toMatch(/host\.answerQuestion\(/)
      // ⚑ **Every field this app has, key and column, derived and never listed by hand** — a list of
      // literals went on naming fields D-014 deleted, and an absence of a name nothing has is not a
      // measurement.
      const names = CAPABILITY_FIELDS.flatMap((field) => [field.key, field.column])
      expect(
        names.length,
        'no capability field was read, so this measures nothing',
      ).toBeGreaterThan(0)
      for (const name of names) expect(tools, name).not.toContain(name)
      // ⛔ **The positive control, one file over**: the host reads a grant by the same spelling, so a
      // search that finds nothing in the tool layer is a search that can find something.
      const hostCode = codeOnly(sourceOf(join(mainRoot, 'runtime'), 'runtime-host.ts'))
      expect(names.some((name) => hostCode.includes(name))).toBe(true)
    })
  })
})
